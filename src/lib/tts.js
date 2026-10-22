// Озвучка через системный SpeechSynthesis.
// Перед каждым воспроизведением — cancel(), иначе фразы встают в очередь.
// Подсветка снимается по событию onend, а не по таймеру.

import { useSyncExternalStore } from 'react';

let speakingId = null;
let current = null; // держим ссылку, иначе Chrome может собрать utterance до onend
const listeners = new Set();

function setSpeaking(id) {
  speakingId = id;
  listeners.forEach((fn) => fn());
}

export const ttsSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

const LANG_DEFAULT = { en: 'en-US', es: 'es-ES', fr: 'fr-FR', de: 'de-DE', it: 'it-IT', pt: 'pt-PT', zh: 'zh-CN', ja: 'ja-JP', ko: 'ko-KR', ar: 'ar-SA', ru: 'ru-RU', uk: 'uk-UA', pl: 'pl-PL', nl: 'nl-NL', tr: 'tr-TR', hi: 'hi-IN' };

export function speak(text, { id = null, lang = 'en', voiceURI = '', rate = 1 } = {}) {
  if (!ttsSupported || !text) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const all = window.speechSynthesis.getVoices();
  const voice = (voiceURI && all.find((v) => v.voiceURI === voiceURI)) || voicesForLang(lang)[0] || null;
  if (voice) u.voice = voice;
  u.lang = voice?.lang || LANG_DEFAULT[lang] || lang;
  u.rate = Math.min(2, Math.max(0.5, Number(rate) || 1));
  const done = () => { if (current === u) { current = null; setSpeaking(null); } };
  u.onend = done;
  u.onerror = done;
  current = u;
  setSpeaking(id ?? text);
  window.speechSynthesis.speak(u);
}

export function stopSpeaking() {
  if (!ttsSupported) return;
  window.speechSynthesis.cancel();
  current = null;
  setSpeaking(null);
}

export function useSpeakingId() {
  return useSyncExternalStore(
    (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    () => speakingId,
    () => null,
  );
}

// ---- Голоса ------------------------------------------------------------------

const voiceListeners = new Set();
let voices = [];
function refreshVoices() {
  if (!ttsSupported) return;
  voices = window.speechSynthesis.getVoices();
  voiceListeners.forEach((fn) => fn());
}
if (ttsSupported) {
  refreshVoices();
  window.speechSynthesis.addEventListener?.('voiceschanged', refreshVoices);
  // В некоторых браузерах voiceschanged не стреляет — опросим пару раз.
  let tries = 0;
  const t = setInterval(() => { refreshVoices(); if (voices.length || ++tries > 10) clearInterval(t); }, 500);
}

/** Голоса для языка (по префиксу BCP-47: en → en-US, en-GB, …). */
export function voicesForLang(lang) {
  const prefix = String(lang || '').toLowerCase().split('-')[0];
  return voices.filter((v) => v.lang.toLowerCase().split(/[-_]/)[0] === prefix);
}

export function useVoices() {
  return useSyncExternalStore(
    (fn) => { voiceListeners.add(fn); return () => voiceListeners.delete(fn); },
    () => voices,
    () => [],
  );
}
