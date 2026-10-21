// Личный словарь: хранение, дедупликация, логика выученности.

import { idb } from './db.js';
import { useEffect, useState } from 'react';

export const REQUIRED_DAYS = 3;

/** Ключ дедупликации: нижний регистр, без пунктуации, одиночные пробелы. */
export function wordKey(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^\p{L}\p{N}'\s-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const listeners = new Set();
function notify() { listeners.forEach((fn) => fn()); }
export function onWordsChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export async function listWords() {
  return idb.getAll('words');
}

async function nextId() {
  const row = await idb.get('meta', 'wordSeq');
  const n = (row?.value || 0) + 1;
  await idb.put('meta', { key: 'wordSeq', value: n });
  return 'w_' + String(n).padStart(4, '0');
}

function tokenKey(token) {
  return wordKey(token.lemma) || wordKey(token.en);
}

export async function findByToken(token) {
  const key = tokenKey(token);
  const all = await idb.getAll('words');
  return all.find((w) => w.key === key) || null;
}

/**
 * Сохраняет токен. Если слово с таким же ключом уже есть, дубль не создаётся:
 * предложение добавляется в массив examples существующей записи.
 * Возвращает { word, created, exampleAdded }.
 */
export async function saveWord({ token, sentence, sentenceRu, source }) {
  const key = tokenKey(token);
  const example = { en: token.en, ctx: token.ctx, sentence, sentenceRu: sentenceRu || '', source: source || '' };
  const existing = await findByToken(token);
  if (existing) {
    const dup = (existing.examples || []).some((e) => e.sentence === sentence);
    if (!dup) {
      existing.examples = [...(existing.examples || []), example];
      await idb.put('words', existing);
      notify();
    }
    return { word: existing, created: false, exampleAdded: !dup };
  }
  const word = {
    id: await nextId(),
    key,
    en: token.en.replace(/^[\s"“'‘(\[]+|[\s"”'’)\].,;:!?]+$/g, ''),
    lemma: token.lemma || token.en,
    ctx: token.ctx,
    base: token.base,
    pos: token.pos,
    sentence,
    sentenceRu: sentenceRu || '',
    source: source || '',
    addedAt: today(),
    cleanHitDays: [],
    requiredDays: REQUIRED_DAYS,
    learned: false,
    examples: [example],
    misses: 0,
    lastMissAt: null,
    lastReviewAt: null,
  };
  await idb.put('words', word);
  notify();
  return { word, created: true, exampleAdded: true };
}

export async function deleteWord(id) {
  await idb.delete('words', id);
  notify();
}

export async function putWord(word) {
  await idb.put('words', word);
  notify();
}

/**
 * Логика выученности (как в words-learning-game): слово выучено после
 * requiredDays верных ответов в РАЗНЫЕ дни; несколько ответов за день — один.
 * «Не знал» обнуляет чистую серию и возвращает слово в оборот чаще.
 */
export function applyAnswer(word, knew) {
  const d = today();
  const w = { ...word, lastReviewAt: d };
  if (knew) {
    const days = w.cleanHitDays || [];
    if (!days.includes(d)) w.cleanHitDays = [...days, d];
    w.learned = w.cleanHitDays.length >= (w.requiredDays || REQUIRED_DAYS);
  } else {
    w.cleanHitDays = [];
    w.learned = false;
    w.misses = (w.misses || 0) + 1;
    w.lastMissAt = d;
  }
  return w;
}

/** Все ключи, по которым токен считается сохранённым (лемма записи и все en из примеров). */
export function savedKeySet(words) {
  const set = new Set();
  for (const w of words) {
    set.add(w.key);
    set.add(wordKey(w.en));
    for (const e of w.examples || []) set.add(wordKey(e.en));
  }
  set.delete('');
  return set;
}

export function isTokenSaved(token, keySet) {
  if (!keySet || keySet.size === 0) return false;
  return keySet.has(wordKey(token.lemma)) || keySet.has(wordKey(token.en));
}

/** Хук: список слов, обновляется при любом изменении словаря. */
export function useWords() {
  const [words, setWords] = useState([]);
  useEffect(() => {
    let alive = true;
    const reload = () => listWords().then((w) => { if (alive) setWords(w); });
    reload();
    const off = onWordsChange(reload);
    return () => { alive = false; off(); };
  }, []);
  return words;
}

export function exportWordsJson(words) {
  return JSON.stringify({ exportedAt: new Date().toISOString(), count: words.length, words }, null, 2);
}
