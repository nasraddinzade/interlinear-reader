// Встроенный переводчик браузера (Translator API, Chrome 138+ / Edge).
// Бесплатно, без ключа и лимитов, переводит на устройстве. Языковой пакет для каждой
// пары языков скачивается один раз; запуск загрузки требует клика пользователя.

const AVAILABILITY_TIMEOUT = 8000;

export function chromeSupported() {
  return typeof self !== 'undefined' && 'Translator' in self;
}

export const pairKey = (src, tgt) => `${src}>${tgt}`;

/** 'available' | 'downloadable' | 'downloading' | 'unavailable' | 'unsupported' */
export async function chromeAvailability(src, tgt) {
  if (!chromeSupported()) return 'unsupported';
  if (src === tgt) return 'unavailable';
  const timeout = new Promise((resolve) => setTimeout(() => resolve('unavailable'), AVAILABILITY_TIMEOUT));
  try {
    return await Promise.race([self.Translator.availability({ sourceLanguage: src, targetLanguage: tgt }), timeout]);
  } catch {
    return 'unavailable';
  }
}

const translators = new Map(); // pairKey -> Promise<Translator>
const progressListeners = new Set();

/** fn(pairKey, loaded 0..1) */
export function onChromeDownloadProgress(fn) {
  progressListeners.add(fn);
  return () => progressListeners.delete(fn);
}

export class ChromeTranslatorError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'ChromeTranslatorError';
    this.code = code; // 'unsupported' | 'activation' | 'unavailable'
    this.status = code === 'activation' ? 401 : 400;
  }
}

/** Создаёт (или возвращает уже созданный) переводчик для пары языков. Может запустить загрузку пакета. */
export function getChromeTranslator(src, tgt) {
  if (!chromeSupported()) {
    return Promise.reject(new ChromeTranslatorError('В этом браузере нет встроенного переводчика (нужен Chrome 138+ или Edge).', 'unsupported'));
  }
  const key = pairKey(src, tgt);
  if (!translators.has(key)) {
    const p = self.Translator.create({
      sourceLanguage: src,
      targetLanguage: tgt,
      monitor(m) {
        m.addEventListener('downloadprogress', (e) => {
          progressListeners.forEach((fn) => fn(key, e.loaded));
        });
      },
    }).catch((e) => {
      translators.delete(key);
      if (e?.name === 'NotAllowedError') {
        throw new ChromeTranslatorError(`Нужно скачать языковой пакет ${src}→${tgt}. Нажмите «Загрузить языковой пакет».`, 'activation');
      }
      if (e?.name === 'NotSupportedError') {
        throw new ChromeTranslatorError(`Браузер не поддерживает перевод ${src}→${tgt} на устройстве.`, 'unavailable');
      }
      throw new ChromeTranslatorError('Не удалось запустить встроенный переводчик: ' + (e?.message || e), 'unavailable');
    });
    translators.set(key, p);
  }
  return translators.get(key);
}

/** Переводит массив строк по одной (API принимает одну строку за вызов). */
export async function chromeTranslate(texts, src, tgt, { signal } = {}) {
  const translator = await getChromeTranslator(src, tgt);
  const out = [];
  for (const t of texts) {
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
    out.push(String(await translator.translate(t, signal ? { signal } : undefined)));
  }
  return out;
}

/** Определение языка текста (LanguageDetector API). Возвращает код или null. */
export async function detectLanguage(text) {
  if (typeof self === 'undefined' || !('LanguageDetector' in self)) return null;
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), 4000));
  try {
    const run = (async () => {
      const d = await self.LanguageDetector.create();
      const res = await d.detect(text.slice(0, 2000));
      const best = res?.[0];
      if (!best || best.confidence < 0.5 || best.detectedLanguage === 'und') return null;
      return best.detectedLanguage.split('-')[0];
    })();
    return await Promise.race([run, timeout]);
  } catch {
    return null;
  }
}
