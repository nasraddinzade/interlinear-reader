// Настройки в localStorage.

import { useSyncExternalStore } from 'react';
import { DEFAULT_SOURCE, DEFAULT_TARGET } from './languages.js';

const STORAGE_KEY = 'ir.settings';

export const HINT_MODES = ['visible', 'hover', 'off'];
export const HINT_MODE_LABELS = {
  visible: 'Подсказки видны',
  hover: 'Подсказки по наведению',
  off: 'Без подсказок',
};

const DEFAULTS = {
  provider: 'chrome',
  sourceLang: DEFAULT_SOURCE, // язык текста по умолчанию для новых текстов
  targetLang: DEFAULT_TARGET, // на какой язык переводить
  languages: [DEFAULT_SOURCE], // языки текстов, добавленные пользователем
  voices: {}, // { en: voiceURI, es: voiceURI, ... }
  rate: 1,
  batchSize: 10,
  hintMode: 'visible',
};

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    const s = { ...DEFAULTS, ...parsed, voices: { ...(parsed.voices || {}) } };
    delete s.keys; // ключи старых облачных провайдеров больше не нужны
    delete s.models;
    delete s.customBaseUrl;
    delete s.googleEndpoint;
    if (parsed.voiceURI) { s.voices.en = s.voices.en || parsed.voiceURI; delete s.voiceURI; } // старое поле голоса
    if (!['chrome', 'stub'].includes(s.provider)) s.provider = 'chrome';
    if (!Array.isArray(s.languages) || !s.languages.length) s.languages = [DEFAULTS.sourceLang];
    if (!s.languages.includes(s.sourceLang)) s.languages = [s.sourceLang, ...s.languages];
    return s;
  } catch {
    return { ...DEFAULTS };
  }
}

let state = load();
const listeners = new Set();

export function getSettings() {
  return state;
}

export function updateSettings(patch) {
  state = typeof patch === 'function' ? patch(state) : { ...state, ...patch };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* ignore */ }
  listeners.forEach((fn) => fn());
}

/** Параметры озвучки для языка текста. */
export function voiceFor(settings, lang) {
  return { lang, voiceURI: settings.voices?.[lang] || '', rate: settings.rate };
}

export function useSettings() {
  return useSyncExternalStore(
    (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    () => state,
    () => state,
  );
}
