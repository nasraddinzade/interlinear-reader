// Адаптер движка перевода. Один интерфейс:
//   provider.glossSentence(text)            -> { full, tokens }
//   provider.glossBatch(texts, { signal })  -> [{ full, tokens }, ...]
// Провайдер выбирается в настройках; ключ хранится только в localStorage.

import { analyze } from '../gloss-local.js';
import { idb } from '../db.js';

export class ApiError extends Error {
  constructor(message, { status = 0, retryAfter = null, body = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.retryAfter = retryAfter;
    this.body = body;
  }
}

export function isRetryable(err) {
  if (!err) return false;
  if (err.name === 'AbortError') return false;
  if (err instanceof ApiError) return err.status === 0 || err.status === 408 || err.status === 409 || err.status === 429 || err.status >= 500;
  if (err instanceof TypeError) return true; // сетевая ошибка fetch
  return false;
}

export const PROVIDERS = [
  {
    id: 'google',
    name: 'Google Translate (Cloud Translation API)',
    needsKey: true,
    keyUrl: 'https://console.cloud.google.com/apis/credentials',
    note:
      'Официальный Cloud Translation API. Бесплатно 500 000 символов в месяц, дальше 20 $ за миллион; ' +
      'для активации нужен проект Google Cloud с привязанным платёжным аккаунтом (списаний в пределах бесплатной квоты нет). ' +
      'Предложение переводится целиком, слова — по отдельности; леммы и части речи считаются локально.',
    steps: [
      'Откройте console.cloud.google.com, создайте проект и включите в нём «Cloud Translation API» (APIs & Services → Library).',
      'В «APIs & Services → Credentials» нажмите «Create credentials → API key» и скопируйте ключ.',
      'Ограничьте ключ: Application restrictions → Websites → ваш домен (например, https://interlinear-reader.vercel.app/*), API restrictions → Cloud Translation API.',
    ],
  },
  {
    id: 'stub',
    name: 'Без перевода (офлайн-заглушка)',
    needsKey: false,
    note: 'Текст показывается как есть, переводы пустые; леммы и части речи всё равно считаются локально.',
  },
];

export function providerInfo(id) {
  return PROVIDERS.find((p) => p.id === id) || PROVIDERS[0];
}

async function readError(res) {
  let body = null;
  try { body = await res.text(); } catch { /* ignore */ }
  let message = `HTTP ${res.status}`;
  try {
    const j = JSON.parse(body);
    message = j?.error?.message || j?.message || j?.error || message;
    if (typeof message !== 'string') message = JSON.stringify(message);
  } catch { if (body) message += ': ' + body.slice(0, 200); }
  const ra = res.headers.get('retry-after');
  const retryAfter = ra && /^\d+$/.test(ra) ? Number(ra) : null;
  return new ApiError(message, { status: res.status, retryAfter, body });
}

async function postJson(url, headers, body, signal) {
  let res;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new ApiError('Сеть недоступна или сервер не отвечает (' + e.message + ')', { status: 0 });
  }
  if (!res.ok) throw await readError(res);
  return res.json();
}

// ---- Google Cloud Translation API v2 ----------------------------------------

const GOOGLE_ENDPOINT = 'https://translation.googleapis.com/language/translate/v2';
const MAX_SEGMENTS = 100; // лимит API — 128 сегментов на запрос
const MAX_CHARS = 20000;

function chunkSegments(items) {
  const out = [];
  let cur = [];
  let chars = 0;
  for (const s of items) {
    if (cur.length >= MAX_SEGMENTS || chars + s.length > MAX_CHARS) { out.push(cur); cur = []; chars = 0; }
    cur.push(s);
    chars += s.length;
  }
  if (cur.length) out.push(cur);
  return out;
}

/** Переводит массив строк en→ru, сохраняя порядок. */
async function googleTranslate(texts, { key, endpoint, signal }) {
  const result = [];
  for (const part of chunkSegments(texts)) {
    const j = await postJson(
      `${endpoint}?key=${encodeURIComponent(key)}`,
      {},
      { q: part, source: 'en', target: 'ru', format: 'text' },
      signal,
    );
    const tr = j?.data?.translations;
    if (!Array.isArray(tr) || tr.length !== part.length) throw new ApiError('Неожиданный ответ Google Translate', { status: 0 });
    result.push(...tr.map((t) => String(t.translatedText ?? '')));
  }
  return result;
}

// Переводы отдельных слов запоминаем между запросами и сессиями (store "cache", ключ google-word:…),
// чтобы не тратить квоту на одни и те же слова.
const wordMemo = new Map();

async function translateWords(words, opts) {
  const need = [];
  const keys = words.map((w) => `google-word:${w}`);
  const rows = await idb.getMany('cache', keys).catch(() => []);
  words.forEach((w, i) => {
    if (wordMemo.has(w)) return;
    if (rows[i]?.ru !== undefined) wordMemo.set(w, rows[i].ru);
    else need.push(w);
  });
  if (need.length) {
    const ru = await googleTranslate(need, opts);
    const toStore = [];
    need.forEach((w, i) => { wordMemo.set(w, ru[i]); toStore.push({ key: `google-word:${w}`, ru: ru[i], at: Date.now() }); });
    await idb.putMany('cache', toStore).catch(() => {});
  }
  return (w) => wordMemo.get(w) ?? '';
}

const lowerFirst = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

function googleProvider({ key, endpoint }) {
  const glossBatch = async (texts, { signal } = {}) => {
    const opts = { key, endpoint, signal };
    const analyses = texts.map(analyze);
    const fulls = await googleTranslate(texts, opts);
    const lookups = [...new Set(analyses.flat().flatMap((t) => t.lookups))];
    const ru = await translateWords(lookups, opts);
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
  return {
    id: 'google',
    name: 'google',
    cacheable: true,
    glossBatch,
    glossSentence: async (text, o) => (await glossBatch([text], o))[0],
  };
}

export function stubProvider() {
  const gloss = (text) => ({
    full: '',
    tokens: analyze(text).map((t) => ({ en: t.en, gap: t.gap, ctx: t.rule?.ctx || '', lemma: t.lemma, base: t.rule?.base || '', pos: t.pos })),
  });
  return {
    id: 'stub',
    name: 'stub',
    cacheable: false,
    glossBatch: async (texts) => texts.map(gloss),
    glossSentence: async (text) => gloss(text),
  };
}

/** Создаёт провайдер по настройкам приложения. */
export function createProvider(settings) {
  const id = settings.provider || 'google';
  const info = providerInfo(id);
  const key = (settings.keys?.[id] || '').trim();
  if (id === 'stub') return stubProvider();
  if (info.needsKey && !key) throw new ApiError(`Для провайдера «${info.name}» не задан API-ключ. Откройте Настройки.`, { status: 401 });
  return googleProvider({ key, endpoint: settings.googleEndpoint || GOOGLE_ENDPOINT });
}
