#!/usr/bin/env node
// Проверка системного промта на реальной модели, без браузера.
// Использование:
//   node scripts/check-prompt.mjs --provider groq --key $GROQ_API_KEY [--model llama-3.3-70b-versatile] [--batch 10] [--file text.txt]
// Провайдеры: gemini | groq | openrouter | claude | custom (--url http://localhost:11434/v1)
// Проверяет: сокращения не режутся, фразовые глаголы одним токеном, конкатенация токенов
// совпадает с предложением посимвольно, lemma для неправильных глаголов — начальная форма.

import fs from 'node:fs';
import { createProvider } from '../src/lib/providers/index.js';
import { splitIntoSentences } from '../src/lib/segment.js';
import { alignTokens, joinTokens } from '../src/lib/align.js';
import { withRetry, matchResults } from '../src/lib/translate.js';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : 'true']);
    return acc;
  }, []),
);

const provider = args.provider || 'groq';
const key = args.key || process.env[`${provider.toUpperCase()}_API_KEY`] || process.env.ANTHROPIC_API_KEY || '';
const settings = {
  provider,
  keys: { [provider]: key },
  models: args.model ? { [provider]: args.model } : {},
  customBaseUrl: args.url || 'http://localhost:11434/v1',
};

const DEFAULT_TEXT = `Mr. Smith lives in the U.S. and works for a small company. I'll get back to you on that. Yesterday we went to the store and bought a book. She ran home as fast as she could. Dr. Brown said that the meeting was at 3 p.m. on Monday. They found out the truth kind of late. Please write down your name and address. We look forward to seeing you soon. It was a cold morning in October. The children were playing in the yard when it started to rain. Nobody had an umbrella, so everyone ran inside. "Where is my coat?" asked Tom. His mother gave him a towel and told him to sit by the fire. After an hour the sky cleared, and the sun came out again. Tom put on his boots and went back outside. He jumped into the biggest puddle he could find. They talked about the storm and laughed at Tom's wet socks. At nine o'clock the children went to bed. It had been a long day, but a good one. The house was quiet. Only the clock in the hall kept ticking.`;

const text = args.file ? fs.readFileSync(args.file, 'utf8') : DEFAULT_TEXT;
const { sentences } = splitIntoSentences(text);
console.log(`Провайдер: ${provider}${args.model ? ' / ' + args.model : ''}; предложений: ${sentences.length}`);

const p = createProvider(settings);
const batch = Math.min(Number(args.batch || 10), p.maxBatch || Infinity);
const results = [];
let skipped = 0;
const onRetry = (n, delay, e) => console.log(`    ошибка: ${e.message.slice(0, 160)}; повтор ${n} через ${Math.round(delay / 1000)} с`);
for (let i = 0; i < sentences.length; i += batch) {
  const slice = sentences.slice(i, i + batch);
  const t0 = Date.now();
  const raw = await withRetry(() => p.glossBatch(slice), { onRetry });
  const matched = matchResults(slice, raw);
  console.log(`  пачка ${i / batch + 1}: ${slice.length} предл. за ${Date.now() - t0} мс, в ответе ${raw.length}`);
  for (let k = 0; k < slice.length; k++) {
    if (matched[k]) { results.push(matched[k]); continue; }
    skipped++;
    console.log(`    предложение ${i + k + 1} пропущено моделью, запрашиваю отдельно`);
    const [one] = await withRetry(() => p.glossBatch([slice[k]]), { onRetry });
    results.push(one);
  }
}

let exact = 0;
const problems = [];
const phrasal = [];
const lemmas = [];
results.forEach((g, i) => {
  const s = sentences[i];
  const a = alignTokens(s, g.tokens);
  if (a.ok && joinTokens(a.tokens) === s) exact++;
  else problems.push(`  #${i + 1} ${a.reason || 'join mismatch'}\n     ${s}\n     ${g.tokens.map((t) => t.en).join(' | ')}`);
  for (const t of g.tokens) {
    if (/\s/.test(t.en.trim())) phrasal.push(`${t.en} → ${t.ctx} [${t.lemma}]`);
    if (/^(went|ran|bought|said|found|gave|told|came|put|had|kept|fell|was|were)\b/i.test(t.en.replace(/[^a-z]/gi, ''))) lemmas.push(`${t.en} → lemma "${t.lemma}"`);
  }
});

console.log(`\nКонкатенация совпала посимвольно: ${exact} из ${sentences.length}; пропущено моделью в пачках и дозапрошено: ${skipped}`);
if (problems.length) console.log('Расхождения:\n' + problems.join('\n'));
console.log(`\nМногословные токены (${phrasal.length}):\n  ` + phrasal.join('\n  '));
console.log(`\nЛеммы неправильных глаголов и форм be:\n  ` + lemmas.join('\n  '));
console.log('\nПример полного ответа для предложения 2:\n' + JSON.stringify(results[1], null, 1));
