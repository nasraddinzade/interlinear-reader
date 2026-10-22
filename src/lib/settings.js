// Настройки в localStorage. Ключи API никуда, кроме localStorage, не попадают.

import { useSyncExternalStore } from 'react';

const STORAGE_KEY = 'ir.settings';

export const HINT_MODES = ['visible', 'hover', 'off'];
export const HINT_MODE_LABELS = {
  visible: 'Подсказки видны',
  hover: 'Подсказки по наведению',
  off: 'Без подсказок',
};

const chromeTranslator = typeof self !== 'undefined' && 'Translator' in self;

const DEFAULTS = {
  provider: chromeTranslator ? 'chrome' : 'google',
  keys: {},
  voiceURI: '',
  rate: 1,
  batchSize: 10,
  hintMode: 'visible',
};

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    const s = { ...DEFAULTS, ...parsed, keys: { ...(parsed.keys || {}) } };
    if (!['chrome', 'google', 'stub'].includes(s.provider)) s.provider = DEFAULTS.provider; // старые настройки с ИИ-провайдерами
    if (s.provider === 'google' && !s.keys.google && chromeTranslator) s.provider = 'chrome'; // ключа нет, а встроенный переводчик есть
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

export function useSettings() {
  return useSyncExternalStore(
    (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    () => state,
    () => state,
  );
}
