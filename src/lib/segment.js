export function normalizeWs(s) {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Разбивает текст на предложения через Intl.Segmenter.
 * Абзацы (разделены пустой строкой) сегментируются отдельно, переносы строк
 * внутри абзаца схлопываются в пробел, чтобы предложение всегда было одной строкой.
 * Возвращает { sentences: string[], paragraphOf: number[] }.
 */
export function splitIntoSentences(text) {
  const paragraphs = text
    .replace(/\r\n?/g, '\n')
    .split(/\n[ \t]*\n/)
    .map(normalizeWs)
    .filter(Boolean);

  const segmenter =
    typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
      ? new Intl.Segmenter('en', { granularity: 'sentence' })
      : null;

  const sentences = [];
  const paragraphOf = [];
  paragraphs.forEach((p, pi) => {
    const parts = segmenter
      ? [...segmenter.segment(p)].map((s) => s.segment)
      : p.split(/(?<=[.!?]["'”’)]?)\s+(?=["'“‘(]?[A-Z0-9])/);
    for (const s of mergeFalseBreaks(parts.map((x) => x.trim()).filter(Boolean))) {
      sentences.push(s);
      paragraphOf.push(pi);
    }
  });
  return { sentences, paragraphOf };
}

// V8 применяет только базовые правила UAX #29 без списка исключений CLDR,
// поэтому "Mr. Smith" или "Dr. Brown" режутся по точке. Склеиваем сегмент со следующим, если
// он заканчивается известным сокращением или инициалом, либо следующий начинается со строчной
// буквы (например, «"Where is it?" asked Tom.»).
const ABBREV = /(?:^|[\s("“‘'])(?:Mr|Mrs|Ms|Mx|Dr|Prof|Sr|Jr|St|Mt|Ft|Messrs|Gen|Col|Capt|Lt|Sgt|Cmdr|Rev|Hon|Pres|Gov|Sen|Rep|vs|cf|e\.g|i\.e|No|Nos|Inc|Ltd|Co|Corp|Bros|Fig|Figs|Vol|Ch|pp|approx|Dept|Est|Ave|Blvd|Rd|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|[A-Z])\.["”’')]*$/;

export function mergeFalseBreaks(parts) {
  const out = [];
  for (const part of parts) {
    const prev = out[out.length - 1];
    if (prev !== undefined && (ABBREV.test(prev) || /^[\p{Ll}]/u.test(part))) {
      out[out.length - 1] = prev + ' ' + part;
    } else {
      out.push(part);
    }
  }
  return out;
}
