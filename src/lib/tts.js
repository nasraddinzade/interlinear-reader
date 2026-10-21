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

export function speak(text, { id = null, voiceURI = '', rate = 1 } = {}) {
  if (!ttsSupported || !text) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const voice = voiceURI ? window.speechSynthesis.getVoices().find((v) => v.voiceURI === voiceURI) : null;
  if (voice) u.voice = voice;
  u.lang = voice?.lang || 'en-US';
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
  voices = window.speechSynthesis.getVoices().filter((v) => /^en[-_](US|GB)/i.test(v.lang));
  voiceListeners.forEach((fn) => fn());
}
if (ttsSupported) {
  refreshVoices();
  window.speechSynthesis.addEventListener?.('voiceschanged', refreshVoices);
  // В некоторых браузерах voiceschanged не стреляет — опросим пару раз.
  let tries = 0;
  const t = setInterval(() => { refreshVoices(); if (voices.length || ++tries > 10) clearInterval(t); }, 500);
}

export function useEnglishVoices() {
  return useSyncExternalStore(
    (fn) => { voiceListeners.add(fn); return () => voiceListeners.delete(fn); },
    () => voices,
    () => [],
  );
}
