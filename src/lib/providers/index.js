// Адаптер движка перевода. Один интерфейс:
//   provider.glossSentence(text)            -> { full, tokens }
//   provider.glossBatch(texts, { signal })  -> [{ full, tokens }, ...]
// Провайдер выбирается в настройках; ключи хранятся только в localStorage.

import { SYSTEM_PROMPT, buildUserMessage, parseJsonResponse, extractSentences } from './prompt.js';

export class ApiError extends Error {
  constructor(message, { status = 0, retryAfter = null, body = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.retryAfter = retryAfter;
    this.body = body;
  }
}

export function isRetryable(err) {
  if (!err) return false;
  if (err.name === 'AbortError') return false;
  if (err instanceof ApiError) return err.status === 0 || err.status === 408 || err.status === 409 || err.status === 429 || err.status >= 500;
  if (err instanceof TypeError) return true; // сетевая ошибка fetch
  if (err instanceof SyntaxError) return true; // модель вернула битый JSON — пробуем ещё раз
  return /JSON|sentences|Ожидалось|не объект/.test(err.message || '');
}

export const PROVIDERS = [
  {
    id: 'stub',
    name: 'Без перевода (офлайн-заглушка)',
    needsKey: false,
    note: 'Текст показывается как есть, переводы пустые. Нужно, чтобы приложение работало без ключа.',
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    needsKey: true,
    keyUrl: 'https://aistudio.google.com/apikey',
    defaultModel: 'gemini-2.5-flash',
    models: ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-3.6-flash', 'gemini-3.8-flash', 'gemini-3-flash-preview'],
    note:
      'Бесплатный уровень есть у моделей Flash / Flash-Lite (2.5 и 3.x). Google не публикует фиксированные цифры: ' +
      'актуальные RPM/RPD для вашего проекта видны в AI Studio. По данным на октябрь 2026 у 2.5 Flash порядка 10 запросов в минуту и несколько сотен в день.',
  },
  {
    id: 'groq',
    name: 'Groq',
    needsKey: true,
    keyUrl: 'https://console.groq.com/keys',
    defaultModel: 'openai/gpt-oss-120b',
    models: ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'openai/gpt-oss-20b'],
    note:
      'Бесплатный уровень (октябрь 2026): gpt-oss-120b, gpt-oss-20b и qwen3.8-27b — 30 запросов/мин, 1 000/день, 8 000 токенов/мин, 200 000 токенов/день. ' +
      'Из-за лимита токенов в минуту пачка ограничена 5 предложениями, а между пачками бывают паузы по 20–30 с. ' +
      'Модели Llama 3.x из каталога убраны. Точные лимиты и список моделей — в console.groq.com/settings/limits.',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    needsKey: true,
    keyUrl: 'https://openrouter.ai/settings/keys',
    defaultModel: 'google/gemma-4-31b-it:free',
    models: ['google/gemma-4-31b-it:free', 'google/gemma-4-26b-a4b-it:free', 'nvidia/nemotron-3-super-120b-a12b:free', 'minimax/minimax-m3.1-flash:free'],
    note:
      'Модели с суффиксом :free бесплатны: 20 запросов/мин и 50 запросов/день, пока на счёт не куплено 10 $ кредитов (тогда 1 000/день). ' +
      'Неудачные запросы тоже считаются. Список :free-моделей меняется, см. openrouter.ai/models?q=free.',
  },
  {
    id: 'claude',
    name: 'Claude API (Anthropic)',
    needsKey: true,
    keyUrl: 'https://platform.claude.com/settings/keys',
    defaultModel: 'claude-opus-5-5',
    models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'],
    note:
      'Бесплатного уровня нет, оплата за токены. Ориентир (октябрь 2026): Opus 5.5 — 4 $/20 $ за 1M входных/выходных токенов, ' +
      'Sonnet 5.5 — 2 $/10 $, Haiku 5.5 — 0,10 $/0,50 $. Качество глосс у Opus и Sonnet заметно выше.',
  },
  {
    id: 'custom',
    name: 'OpenAI-совместимый сервер (Ollama, LM Studio, свой URL)',
    needsKey: false,
    defaultModel: 'llama3.1',
    defaultBaseUrl: 'http://localhost:11434/v1',
    models: ['llama3.1', 'qwen2.5:14b', 'gemma3:12b'],
    note:
      'Любой сервер с эндпоинтом POST {baseUrl}/chat/completions. Для Ollama запустите «ollama serve» с переменной OLLAMA_ORIGINS=* ' +
      'и укажите http://localhost:11434/v1. Полностью офлайн и бесплатно, качество зависит от модели.',
  },
];

export function providerInfo(id) {
  return PROVIDERS.find((p) => p.id === id) || PROVIDERS[0];
}

async function readError(res) {
  let body = null;
  try { body = await res.text(); } catch { /* ignore */ }
  let message = `HTTP ${res.status}`;
  try {
    const j = JSON.parse(body);
    message = j?.error?.message || j?.message || j?.error || message;
    if (typeof message !== 'string') message = JSON.stringify(message);
  } catch { if (body) message += ': ' + body.slice(0, 200); }
  const ra = res.headers.get('retry-after');
  const retryAfter = ra && /^\d+$/.test(ra) ? Number(ra) : null;
  return new ApiError(message, { status: res.status, retryAfter, body });
}

// ---- HTTP-клиенты -----------------------------------------------------------

async function postJson(url, headers, body, signal) {
  let res;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new ApiError('Сеть недоступна или сервер не отвечает (' + e.message + ')', { status: 0 });
  }
  if (!res.ok) throw await readError(res);
  return res.json();
}

async function callOpenAICompatible({ baseUrl, key, model, extraHeaders = {}, extraBody = {}, jsonMode = false }, system, user, signal) {
  const url = baseUrl.replace(/\/+$/, '') + '/chat/completions';
  const headers = { ...extraHeaders };
  if (key) headers.Authorization = `Bearer ${key}`;
  const body = {
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0.2,
    ...extraBody,
  };
  if (jsonMode) body.response_format = { type: 'json_object' };
  const j = await postJson(url, headers, body, signal);
  const text = j?.choices?.[0]?.message?.content;
  if (typeof text !== 'string') throw new ApiError('Пустой ответ модели', { status: 0 });
  return text;
}

async function callGemini({ key, model }, system, user, signal) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
  };
  const j = await postJson(url, { 'x-goog-api-key': key }, body, signal);
  const cand = j?.candidates?.[0];
  const text = cand?.content?.parts?.map((p) => p.text || '').join('');
  if (!text) throw new ApiError('Пустой ответ Gemini' + (cand?.finishReason ? ` (${cand.finishReason})` : ''), { status: 0 });
  return text;
}

async function callClaude({ key, model }, system, user, signal) {
  const body = {
    model,
    max_tokens: 16000,
    system,
    messages: [{ role: 'user', content: user }],
    output_config: { effort: 'low' },
  };
  const j = await postJson(
    'https://api.anthropic.com/v1/messages',
    {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body,
    signal,
  );
  if (j?.stop_reason === 'refusal') throw new ApiError('Модель отказалась отвечать (refusal)', { status: 0 });
  const text = (j?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  if (!text) throw new ApiError('Пустой ответ Claude', { status: 0 });
  return text;
}

// ---- Сборка провайдера ------------------------------------------------------

function llmProvider(id, cacheName, call, { maxBatch } = {}) {
  const glossBatch = async (texts, { signal } = {}) => {
    const raw = await call(SYSTEM_PROMPT, buildUserMessage(texts), signal);
    return extractSentences(parseJsonResponse(raw), texts.length);
  };
  return {
    id,
    name: cacheName,
    cacheable: true,
    maxBatch, // верхняя граница пачки для провайдеров с маленьким лимитом токенов в минуту
    glossBatch,
    glossSentence: async (text, opts) => (await glossBatch([text], opts))[0],
  };
}

export function stubProvider() {
  const gloss = (text) => ({
    full: '',
    tokens: text.split(/(\s+)/).filter((s) => s && !/^\s+$/.test(s)).map((w) => ({ en: w, ctx: '', lemma: '', base: '', pos: '' })),
  });
  return {
    id: 'stub',
    name: 'stub',
    cacheable: false,
    glossBatch: async (texts) => texts.map(gloss),
    glossSentence: async (text) => gloss(text),
  };
}

/** Создаёт провайдер по настройкам приложения. */
export function createProvider(settings) {
  const id = settings.provider || 'stub';
  const info = providerInfo(id);
  const key = (settings.keys?.[id] || '').trim();
  const model = (settings.models?.[id] || info.defaultModel || '').trim();

  if (id === 'stub') return stubProvider();
  if (info.needsKey && !key) throw new ApiError(`Для провайдера «${info.name}» не задан API-ключ. Откройте Настройки.`, { status: 401 });

  switch (id) {
    case 'gemini':
      return llmProvider(id, 'gemini', (s, u, sig) => callGemini({ key, model }, s, u, sig));
    case 'groq':
      return llmProvider(id, 'groq', (s, u, sig) =>
        callOpenAICompatible(
          {
            baseUrl: 'https://api.groq.com/openai/v1', key, model, jsonMode: true,
            // gpt-oss — рассуждающие модели; для глоссирования хватает low, это быстрее и дешевле по токенам.
            extraBody: /gpt-oss/.test(model) ? { reasoning_effort: 'low' } : {},
          },
          s, u, sig),
        // Бесплатный Groq: 8 000 токенов/мин. Пачка из 5 предложений — около 3 500 токенов.
        { maxBatch: 5 });
    case 'openrouter':
      return llmProvider(id, 'openrouter', (s, u, sig) =>
        callOpenAICompatible(
          { baseUrl: 'https://openrouter.ai/api/v1', key, model, extraHeaders: { 'HTTP-Referer': 'https://github.com/nasraddinzade/interlinear-reader', 'X-Title': 'Interlinear Reader' } },
          s, u, sig));
    case 'claude':
      return llmProvider(id, 'claude', (s, u, sig) => callClaude({ key, model }, s, u, sig));
    case 'custom': {
      const baseUrl = (settings.customBaseUrl || info.defaultBaseUrl).trim();
      return llmProvider(id, `custom:${model}`, (s, u, sig) => callOpenAICompatible({ baseUrl, key, model }, s, u, sig));
    }
    default:
      return stubProvider();
  }
}
