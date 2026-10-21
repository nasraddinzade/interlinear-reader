// Конвейер перевода: кэш → пачки → повторы с нарастающей паузой → проверка выравнивания.

import { idb } from './db.js';
import { sha256 } from './hash.js';
import { alignTokens } from './align.js';
import { isRetryable } from './providers/index.js';

export function cacheKey(hash, providerName) {
  return `${providerName}:${hash}`;
}

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('aborted', 'AbortError')); }, { once: true });
  });

/** Повтор с паузами 1с, 2с, 4с (или Retry-After), максимум `retries` повторов. */
export async function withRetry(fn, { retries = 3, base = 1000, signal, onRetry } = {}) {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (e) {
      if (signal?.aborted || attempt >= retries || !isRetryable(e)) throw e;
      const delay = e?.retryAfter ? Math.min(e.retryAfter * 1000, 60000) : base * 2 ** attempt;
      attempt++;
      onRetry?.(attempt, delay, e);
      await sleep(delay, signal);
    }
  }
}

/** Ищет переводы в кэше. Возвращает массив той же длины: gloss | null. */
export async function lookupCache(sentences, providerName) {
  const hashes = await Promise.all(sentences.map((s) => sha256(s)));
  const rows = await idb.getMany('cache', hashes.map((h) => cacheKey(h, providerName)));
  return rows.map((r) => (r && r.gloss ? r.gloss : null));
}

async function storeCache(sentence, providerName, gloss) {
  const h = await sha256(sentence);
  await idb.put('cache', { key: cacheKey(h, providerName), gloss, at: Date.now() });
}

function finalize(sentence, gloss) {
  const aligned = alignTokens(sentence, gloss.tokens);
  if (aligned.ok) return { full: gloss.full, tokens: aligned.tokens, aligned: true };
  return {
    full: gloss.full,
    tokens: gloss.tokens.map((t, i) => ({ ...t, gap: i === 0 ? '' : ' ' })),
    aligned: false,
    alignError: aligned.reason,
  };
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += Math.max(1, n)) out.push(arr.slice(i, i + Math.max(1, n)));
  return out;
}

function errorMessage(e) {
  if (!e) return 'Неизвестная ошибка';
  if (e.name === 'AbortError') return 'Отменено';
  return e.message || String(e);
}

/**
 * Переводит предложения с индексами `indexes` пачками по `batchSize`.
 * Для каждого индекса вызывает onResult(i, { gloss }) или onResult(i, { error }).
 * onStatus(text) — для строки состояния (повторы, паузы).
 */
export async function glossMissing({ sentences, indexes, provider, batchSize = 10, onResult, onStatus, signal }) {
  for (const batch of chunk(indexes, batchSize)) {
    if (signal?.aborted) return;
    const texts = batch.map((i) => sentences[i]);
    let results;
    try {
      results = await withRetry(() => provider.glossBatch(texts, { signal }), {
        signal,
        onRetry: (n, delay, e) => onStatus?.(`Ошибка: ${errorMessage(e)}. Повтор ${n}/3 через ${Math.round(delay / 1000)} с…`),
      });
      onStatus?.('');
    } catch (e) {
      if (signal?.aborted) return;
      onStatus?.('');
      batch.forEach((i) => onResult(i, { error: errorMessage(e) }));
      continue;
    }

    for (let k = 0; k < batch.length; k++) {
      const i = batch[k];
      const sentence = sentences[i];
      let gloss = finalize(sentence, results[k]);
      if (!gloss.aligned) {
        // Правило 1 нарушено — повторяем запрос для этого предложения один раз.
        onStatus?.(`Токены не совпали с предложением ${i + 1}, повторный запрос…`);
        try {
          const [again] = await withRetry(() => provider.glossBatch([sentence], { signal }), { retries: 1, signal });
          const g2 = finalize(sentence, again);
          if (g2.aligned) gloss = g2;
          else console.warn('[gloss] alignment failed twice for sentence', i + 1, gloss.alignError, '|', g2.alignError);
        } catch (e) {
          if (signal?.aborted) return;
          console.warn('[gloss] retry failed', e);
        }
        onStatus?.('');
      }
      if (provider.cacheable) await storeCache(sentence, provider.name, gloss);
      if (signal?.aborted) return;
      onResult(i, { gloss });
    }
  }
}
