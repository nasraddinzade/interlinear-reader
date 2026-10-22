import { idb } from './db.js';
import { splitIntoSentences } from './segment.js';

export async function listTexts() {
  const all = await idb.getAll('texts');
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export function getText(id) {
  return idb.get('texts', id);
}

export async function addText({ title, body, lang = 'en' }) {
  const { sentences, paragraphOf } = splitIntoSentences(body, lang);
  if (sentences.length === 0) throw new Error('В тексте не нашлось ни одного предложения');
  const cleanTitle = (title || '').trim() || sentences[0].slice(0, 60).replace(/\s+\S*$/, '') + (sentences[0].length > 60 ? '…' : '');
  const text = {
    id: 't_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    title: cleanTitle,
    lang,
    sentences,
    paragraphOf,
    createdAt: Date.now(),
  };
  await idb.put('texts', text);
  return text;
}

export function deleteText(id) {
  return idb.delete('texts', id);
}
