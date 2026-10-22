// Встроенный переводчик браузера (Translator API, Chrome 138+ / Edge).
// Бесплатно, без ключа и лимитов, переводит на устройстве. Языковой пакет en→ru
// скачивается один раз; запуск загрузки требует клика пользователя.

const PAIR = { sourceLanguage: 'en', targetLanguage: 'ru' };
const AVAILABILITY_TIMEOUT = 8000;

export function chromeSupported() {
  return typeof self !== 'undefined' && 'Translator' in self;
}

/** 'available' | 'downloadable' | 'downloading' | 'unavailable' | 'unsupported' */
export async function chromeAvailability() {
  if (!chromeSupported()) return 'unsupported';
  const timeout = new Promise((resolve) => setTimeout(() => resolve('unavailable'), AVAILABILITY_TIMEOUT));
  try {
    return await Promise.race([self.Translator.availability(PAIR), timeout]);
  } catch {
    return 'unavailable';
  }
}

let translatorPromise = null;
const progressListeners = new Set();

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

/** Создаёт (или возвращает уже созданный) переводчик. Может запустить загрузку пакета. */
export function getChromeTranslator() {
  if (!chromeSupported()) {
    return Promise.reject(new ChromeTranslatorError('В этом браузере нет встроенного переводчика (нужен Chrome 138+ или Edge).', 'unsupported'));
  }
  if (!translatorPromise) {
    translatorPromise = self.Translator.create({
      ...PAIR,
      monitor(m) {
        m.addEventListener('downloadprogress', (e) => {
          progressListeners.forEach((fn) => fn(e.loaded));
        });
      },
    }).catch((e) => {
      translatorPromise = null;
      if (e?.name === 'NotAllowedError') {
        throw new ChromeTranslatorError('Нужно скачать языковой пакет en→ru. Нажмите «Загрузить языковой пакет».', 'activation');
      }
      if (e?.name === 'NotSupportedError') {
        throw new ChromeTranslatorError('Браузер не поддерживает перевод en→ru на устройстве.', 'unavailable');
      }
      throw new ChromeTranslatorError('Не удалось запустить встроенный переводчик: ' + (e?.message || e), 'unavailable');
    });
  }
  return translatorPromise;
}

/** Переводит массив строк по одной (API принимает одну строку за вызов). */
export async function chromeTranslate(texts, { signal } = {}) {
  const translator = await getChromeTranslator();
  const out = [];
  for (const t of texts) {
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
    out.push(String(await translator.translate(t, signal ? { signal } : undefined)));
  }
  return out;
}
