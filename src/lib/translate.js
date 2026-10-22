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

/**
 * Сопоставляет ответ модели с входными предложениями по выравниванию токенов,
 * а не по позиции: модель может пропустить или переставить предложения.
 * Возвращает массив той же длины, что texts; null — предложение в ответе не нашлось.
 */
export function matchResults(texts, glosses) {
  const used = new Set();
  const out = texts.map(() => null);
  texts.forEach((s, i) => {
    for (let k = 0; k < glosses.length; k++) {
      if (used.has(k)) continue;
      if (alignTokens(s, glosses[k].tokens).ok) { used.add(k); out[i] = glosses[k]; break; }
    }
  });
  // Если количество совпало, невыровненные берём по позиции — их всё равно перепроверит повтор.
  if (glosses.length === texts.length) {
    texts.forEach((_, i) => { if (!out[i] && !used.has(i)) { out[i] = glosses[i]; used.add(i); } });
  }
  return out;
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
  const size = Math.max(1, Math.min(batchSize, provider.maxBatch || Infinity));
  const queue = chunk(indexes, size);
  const attempts = new Map();
  while (queue.length) {
    if (signal?.aborted) return;
    const batch = queue.shift();
    const texts = batch.map((i) => sentences[i]);
    const done = [];
    let results;
    try {
      const raw = await withRetry(() => provider.glossBatch(texts, { signal }), {
        signal,
        onRetry: (n, delay, e) => onStatus?.(`Ошибка: ${errorMessage(e)}. Повтор ${n}/3 через ${Math.round(delay / 1000)} с…`),
      });
      results = matchResults(texts, raw);
      onStatus?.('');
    } catch (e) {
      if (signal?.aborted) return;
      if (e?.reduceBatch && batch.length > 1) {
        // Ответ не влез или сломался — делим пачку пополам и пробуем снова.
        const half = Math.ceil(batch.length / 2);
        queue.unshift(batch.slice(0, half), batch.slice(half));
        onStatus?.(`${errorMessage(e)}. Делю пачку: ${half} + ${batch.length - half}…`);
        continue;
      }
      onStatus?.('');
      batch.forEach((i) => onResult(i, { error: errorMessage(e) }));
      continue;
    }

    // Пропущенные моделью предложения (ответ обрезан или модель их потеряла) собираем
    // в новую пачку, а не дёргаем по одному. После двух неудач пачкой — запрос по одному.
    const missing = batch.filter((i, k) => !results[k]);
    if (missing.length > 1 && batch.length > 1 && missing.every((i) => (attempts.get(i) || 0) < 2)) {
      missing.forEach((i) => attempts.set(i, (attempts.get(i) || 0) + 1));
      onStatus?.(`Модель вернула ${batch.length - missing.length} из ${batch.length}, недостающие ${missing.length} — новой пачкой…`);
      queue.unshift(missing);
    }

    for (let k = 0; k < batch.length; k++) {
      const i = batch[k];
      const sentence = sentences[i];
      if (!results[k] && queue[0] === missing) continue; // уйдёт следующей пачкой
      let gloss = results[k] ? finalize(sentence, results[k]) : null;
      if (!gloss || !gloss.aligned) {
        // Предложение пропущено или правило 1 нарушено — повторяем запрос для него одного.
        onStatus?.(gloss ? `Токены не совпали с предложением ${i + 1}, повторный запрос…` : `Модель пропустила предложение ${i + 1}, повторный запрос…`);
        try {
          const raw2 = await withRetry(() => provider.glossBatch([sentence], { signal }), {
            retries: 2, signal,
            onRetry: (n, delay, e) => onStatus?.(`Ошибка: ${errorMessage(e)}. Повтор ${n}/2 через ${Math.round(delay / 1000)} с…`),
          });
          const [again] = matchResults([sentence], raw2);
          const g2 = again ? finalize(sentence, again) : raw2[0] ? finalize(sentence, raw2[0]) : null;
          if (g2 && (g2.aligned || !gloss)) gloss = g2;
          if (gloss && !gloss.aligned) console.warn('[gloss] alignment failed twice for sentence', i + 1, gloss.alignError);
        } catch (e) {
          if (signal?.aborted) return;
          console.warn('[gloss] retry failed', e);
          if (!gloss) { onStatus?.(''); onResult(i, { error: errorMessage(e) }); continue; }
        }
        onStatus?.('');
      }
      if (!gloss) { onResult(i, { error: 'Модель не вернула перевод этого предложения' }); continue; }
      if (provider.cacheable) await storeCache(sentence, provider.name, gloss);
      if (signal?.aborted) return;
      onResult(i, { gloss });
      done.push([i, gloss]);
    }

    // Второй проход: контекстные переводы слов. Строки уже показаны с черновыми подсказками.
    if (provider.refineSentence && done.length) {
      await refineGlosses({ sentences, items: done, provider, onResult, onStatus, signal });
    }
  }
}

/**
 * Уточняет подсказки над словами для уже переведённых предложений (items: [[index, gloss], ...]).
 * Каждое уточнённое предложение сразу отдаётся в onResult и перезаписывается в кэше.
 */
export async function refineGlosses({ sentences, items, provider, onResult, onStatus, signal }) {
  if (!provider.refineSentence) return;
  let n = 0;
  for (const [i, gloss] of items) {
    if (signal?.aborted) return;
    if (gloss.refined) continue;
    onStatus?.(`Уточняю подсказки: ${++n} из ${items.length}…`);
    try {
      const refined = await provider.refineSentence(sentences[i], gloss, { signal });
      if (signal?.aborted) return;
      if (provider.cacheable) await storeCache(sentences[i], provider.name, refined);
      onResult(i, { gloss: refined });
    } catch (e) {
      if (signal?.aborted) return;
      console.warn('[gloss] refine failed for sentence', i + 1, e);
    }
  }
  onStatus?.('');
}
