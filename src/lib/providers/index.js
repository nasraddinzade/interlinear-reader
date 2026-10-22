// Адаптер движка перевода. Один интерфейс:
//   provider.glossSentence(text)            -> { full, tokens }
//   provider.glossBatch(texts, { signal })  -> [{ full, tokens }, ...]
//   provider.translateText(text)            -> string
// Провайдер создаётся для пары языков (язык текста → язык перевода).
// Перевод делает встроенный переводчик браузера (Translator API); ключей и серверов нет.

import { analyze } from '../gloss-local.js';
import { idb } from '../db.js';
import { chromeTranslate } from './chrome.js';

export function isRetryable(err) {
  if (!err) return false;
  if (err.name === 'AbortError') return false;
  if (err.name === 'ChromeTranslatorError') return false;
  return err instanceof TypeError; // временные сбои самого переводчика
}

export const PROVIDERS = [
  {
    id: 'chrome',
    name: 'Встроенный переводчик браузера (Chrome, Edge)',
    note:
      'Translator API браузера: бесплатно, без ключа и лимитов, перевод выполняется на устройстве. ' +
      'Для каждой пары языков один раз скачивается языковой пакет (несколько десятков мегабайт). Работает в Chrome 138+ и Edge; в Firefox и Safari недоступен.',
  },
  {
    id: 'stub',
    name: 'Без перевода (офлайн-заглушка)',
    note: 'Текст показывается как есть, переводы пустые; для английского леммы и части речи всё равно считаются локально.',
  },
];

export function providerInfo(id) {
  return PROVIDERS.find((p) => p.id === id) || PROVIDERS[0];
}

// ---- Переводы отдельных слов и фраз ------------------------------------------
// Запоминаем между запросами и сессиями (store "cache", ключ `${prefix}-word:…`),
// чтобы не переводить одни и те же слова повторно.

const wordMemo = new Map();

async function translateWords(prefix, words, translate) {
  const need = [];
  const keys = words.map((w) => `${prefix}-word:${w}`);
  const rows = await idb.getMany('cache', keys).catch(() => []);
  words.forEach((w, i) => {
    const k = keys[i];
    if (wordMemo.has(k)) return;
    if (rows[i]?.ru !== undefined) wordMemo.set(k, rows[i].ru);
    else need.push(w);
  });
  if (need.length) {
    const ru = await translate(need);
    const toStore = [];
    need.forEach((w, i) => { wordMemo.set(`${prefix}-word:${w}`, ru[i]); toStore.push({ key: `${prefix}-word:${w}`, ru: ru[i], at: Date.now() }); });
    await idb.putMany('cache', toStore).catch(() => {});
  }
  return (w) => wordMemo.get(`${prefix}-word:${w}`) ?? '';
}

const lowerFirst = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

/** Собирает провайдер из функции перевода массива строк для пары языков. */
function mtProvider(name, src, tgt, translate) {
  const glossBatch = async (texts, { signal } = {}) => {
    const analyses = texts.map((s) => analyze(s, src, tgt));
    const fulls = await translate(texts, signal);
    const lookups = [...new Set(analyses.flat().flatMap((t) => t.lookups))];
    const ru = await translateWords(name, lookups, (words) => translate(words, signal));
    return analyses.map((tokens, i) => ({
      full: fulls[i],
      tokens: tokens.map((t) => {
        let ctx;
        let base;
        if (t.rule) {
          ({ ctx, base } = t.rule);
        } else if (t.isName) {
          ctx = ru(t.word) || t.word;
          base = ctx;
        } else {
          ctx = lowerFirst(ru(t.lower));
          const lemmaRu = t.lemma.toLowerCase() !== t.lower ? lowerFirst(ru(t.lemma.toLowerCase())) : '';
          base = lemmaRu && lemmaRu !== ctx ? lemmaRu : ctx;
        }
        return { en: t.en, gap: t.gap, ctx, lemma: t.lemma, base, pos: t.pos };
      }),
    }));
  };
  // Перевод произвольной фразы (выделение в тексте). Кэшируется так же, как слова.
  const translateText = async (text, { signal } = {}) => {
    const ru = await translateWords(name, [text], (words) => translate(words, signal));
    return ru(text);
  };
  return {
    id: 'chrome',
    name,
    src,
    tgt,
    cacheable: true,
    glossBatch,
    glossSentence: async (text, o) => (await glossBatch([text], o))[0],
    translateText,
  };
}

export function stubProvider(src = 'en', tgt = 'ru') {
  const gloss = (text) => ({
    full: '',
    tokens: analyze(text, src, tgt).map((t) => ({ en: t.en, gap: t.gap, ctx: t.rule?.ctx || '', lemma: t.lemma, base: t.rule?.base || '', pos: t.pos })),
  });
  return {
    id: 'stub',
    name: 'stub',
    src,
    tgt,
    cacheable: false,
    glossBatch: async (texts) => texts.map(gloss),
    glossSentence: async (text) => gloss(text),
    translateText: async () => '',
  };
}

/** Создаёт провайдер по настройкам приложения для пары языков. */
export function createProvider(settings, src = 'en', tgt = settings.targetLang || 'ru') {
  if (settings.provider === 'stub') return stubProvider(src, tgt);
  return mtProvider(`chrome:${src}>${tgt}`, src, tgt, (texts, signal) => chromeTranslate(texts, src, tgt, { signal }));
}
