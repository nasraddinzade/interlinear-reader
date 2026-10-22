import { useEffect, useState } from 'react';
import { useSettings, updateSettings, HINT_MODES, HINT_MODE_LABELS, voiceFor } from '../lib/settings.js';
import { PROVIDERS, providerInfo, createProvider } from '../lib/providers/index.js';
import { speak, useVoices, voicesForLang, ttsSupported } from '../lib/tts.js';
import { idb } from '../lib/db.js';
import { alignTokens } from '../lib/align.js';
import { chromeAvailability, getChromeTranslator, onChromeDownloadProgress, pairKey, chromeSupported } from '../lib/providers/chrome.js';
import { LANGUAGES, langName } from '../lib/languages.js';

const TEST_SENTENCES = {
  en: "I'll get back to you on that.",
  es: 'Te lo diré mañana por la mañana.',
  fr: 'Je vous répondrai demain matin.',
  de: 'Ich melde mich morgen früh bei dir.',
  it: 'Ti risponderò domani mattina.',
  pt: 'Respondo-te amanhã de manhã.',
  ru: 'Я отвечу тебе завтра утром.',
  zh: '我明天早上回复你。',
  ja: '明日の朝、返事します。',
};

const STATUS_TEXT = {
  checking: 'проверяю…',
  available: 'пакет установлен',
  downloadable: 'пакет не скачан',
  downloading: 'скачивается…',
  unavailable: 'эта пара недоступна в браузере',
  unsupported: 'нет встроенного переводчика',
};

/** Строка языка: статус пакета, кнопка загрузки, голос озвучки. */
function LanguageRow({ lang, tgt, settings, voices, onRemove, canRemove }) {
  const [status, setStatus] = useState('checking');
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState('');
  const key = pairKey(lang, tgt);

  useEffect(() => { setStatus('checking'); chromeAvailability(lang, tgt).then(setStatus); }, [lang, tgt]);
  useEffect(() => onChromeDownloadProgress((k, p) => { if (k === key) setProgress(p); }), [key]);

  const download = async () => {
    setError('');
    setStatus('downloading');
    setProgress(0);
    try {
      await getChromeTranslator(lang, tgt);
      setStatus('available');
    } catch (e) {
      setError(e.message);
      setStatus(await chromeAvailability(lang, tgt));
    } finally {
      setProgress(null);
    }
  };

  const langVoices = voicesForLang(lang);
  const voiceURI = settings.voices?.[lang] || '';
  const statusCls = status === 'available' ? 'ok-text' : status === 'unavailable' || status === 'unsupported' ? 'error' : 'muted';

  return (
    <div className="lang-row">
      <div className="lang-head">
        <strong>{langName(lang)}</strong>
        <span className="muted"> → {langName(tgt)}: </span>
        <span className={statusCls}>{STATUS_TEXT[status] || status}{progress !== null && ` ${Math.round(progress * 100)}%`}</span>
        {(status === 'downloadable' || status === 'downloading') && (
          <button className="primary small" onClick={download} disabled={status === 'downloading'}>Загрузить языковой пакет</button>
        )}
        {canRemove && <button className="icon danger" title="Убрать язык из списка" onClick={onRemove}>✕</button>}
      </div>
      {error && <p className="error small">{error}</p>}
      {ttsSupported && (
        <div className="lang-voice">
          <select value={voiceURI} onChange={(e) => updateSettings((s) => ({ ...s, voices: { ...s.voices, [lang]: e.target.value } }))}>
            <option value="">Голос по умолчанию{langVoices.length ? '' : ' (голосов для этого языка нет)'}</option>
            {langVoices.map((v) => <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang}){v.localService ? '' : ' · онлайн'}</option>)}
          </select>
          <button onClick={() => speak(TEST_SENTENCES[lang] || TEST_SENTENCES.en, { id: 'voice-' + lang, ...voiceFor(settings, lang) })}>🔊</button>
        </div>
      )}
    </div>
  );
}

export default function Settings() {
  const s = useSettings();
  const voices = useVoices();
  const info = providerInfo(s.provider);
  const [test, setTest] = useState(null);
  const [cacheCount, setCacheCount] = useState(null);
  const [addLang, setAddLang] = useState('');

  useEffect(() => { idb.count('cache').then(setCacheCount); }, [test]);

  const tgt = s.targetLang || 'ru';
  const available = LANGUAGES.filter((l) => l.code !== tgt && !s.languages.includes(l.code));

  const runTest = async () => {
    setTest({ busy: true });
    try {
      const src = s.sourceLang || 'en';
      const sentence = TEST_SENTENCES[src] || TEST_SENTENCES.en;
      const provider = createProvider(s, src, tgt);
      const t0 = Date.now();
      const g = await provider.glossSentence(sentence);
      const a = alignTokens(sentence, g.tokens);
      setTest({ ok: true, ms: Date.now() - t0, gloss: g, aligned: a.ok, reason: a.reason });
    } catch (e) {
      setTest({ ok: false, error: e.message });
    }
  };

  const clearCache = async () => {
    if (!window.confirm('Удалить все закэшированные переводы? Тексты придётся переводить заново.')) return;
    await idb.clear('cache');
    setCacheCount(0);
  };

  return (
    <div className="page narrow settings">
      <h1>Настройки</h1>

      <section>
        <h2>Языки</h2>
        <label>
          Переводить на
          <select value={tgt} onChange={(e) => updateSettings((st) => ({ ...st, targetLang: e.target.value, languages: st.languages.filter((l) => l !== e.target.value) }))}>
            {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
          </select>
        </label>
        <p className="muted small">
          Языки текстов, которые вы читаете. Для каждого браузер один раз скачивает языковой пакет; ниже же выбирается голос озвучки.
          {!chromeSupported() && ' В этом браузере нет встроенного переводчика, пакеты недоступны.'}
        </p>
        <div className="lang-list">
          {s.languages.map((lang) => (
            <LanguageRow
              key={lang + tgt}
              lang={lang}
              tgt={tgt}
              settings={s}
              voices={voices}
              canRemove={s.languages.length > 1}
              onRemove={() => updateSettings((st) => {
                const languages = st.languages.filter((l) => l !== lang);
                return { ...st, languages, sourceLang: languages.includes(st.sourceLang) ? st.sourceLang : languages[0] };
              })}
            />
          ))}
        </div>
        <div className="form-row">
          <select value={addLang} onChange={(e) => setAddLang(e.target.value)}>
            <option value="">Добавить язык…</option>
            {available.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
          </select>
          <button
            disabled={!addLang}
            onClick={() => { updateSettings((st) => ({ ...st, languages: [...st.languages, addLang] })); setAddLang(''); }}
          >
            Добавить
          </button>
        </div>
        <label>
          Язык новых текстов по умолчанию
          <select value={s.sourceLang} onChange={(e) => updateSettings({ sourceLang: e.target.value })}>
            {s.languages.map((l) => <option key={l} value={l}>{langName(l)}</option>)}
          </select>
        </label>
      </section>

      <section>
        <h2>Переводчик</h2>
        <label>
          Провайдер
          <select value={s.provider} onChange={(e) => { updateSettings({ provider: e.target.value }); setTest(null); }}>
            {PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <p className="muted small">{info.note}</p>
        <label>
          Размер пачки (предложений за один проход)
          <input type="number" min={1} max={50} value={s.batchSize} onChange={(e) => updateSettings({ batchSize: Math.max(1, Math.min(50, Number(e.target.value) || 10)) })} />
        </label>
        <div className="form-row">
          <button onClick={runTest} disabled={test?.busy || s.provider === 'stub'}>{test?.busy ? 'Проверяю…' : `Проверить перевод ${langName(s.sourceLang)} → ${langName(tgt)}`}</button>
          {test && !test.busy && (
            test.ok ? (
              <span className={test.aligned ? 'ok-text' : 'warn-text'}>
                OK за {test.ms} мс{test.aligned ? '' : ` (разбивка не совпала: ${test.reason})`}
              </span>
            ) : (
              <span className="error">{test.error}</span>
            )
          )}
        </div>
        {test?.ok && (
          <pre className="test-out">
            {test.gloss.full}{'\n'}
            {test.gloss.tokens.map((t) => `${t.en} → ${t.ctx}${t.lemma && t.lemma !== t.en.toLowerCase() ? ` [${t.lemma}: ${t.base}]` : ''}${t.pos ? ` (${t.pos})` : ''}`).join('\n')}
          </pre>
        )}
      </section>

      <section>
        <h2>Озвучка</h2>
        {!ttsSupported ? (
          <p className="error">Браузер не поддерживает SpeechSynthesis.</p>
        ) : (
          <>
            <p className="muted small">Голос для каждого языка выбирается в разделе «Языки». Если голосов для языка нет, в Windows их можно добавить в Параметры → Время и язык → Речь.</p>
            <label>
              Скорость: {Number(s.rate).toFixed(2)}
              <input type="range" min={0.5} max={1.5} step={0.05} value={s.rate} onChange={(e) => updateSettings({ rate: Number(e.target.value) })} />
            </label>
          </>
        )}
      </section>

      <section>
        <h2>Чтение</h2>
        <label>
          Режим подсказок (в читалке переключается клавишей H)
          <select value={s.hintMode} onChange={(e) => updateSettings({ hintMode: e.target.value })}>
            {HINT_MODES.map((m) => <option key={m} value={m}>{HINT_MODE_LABELS[m]}</option>)}
          </select>
        </label>
      </section>

      <section>
        <h2>Кэш переводов</h2>
        <p className="muted small">
          Переведённые предложения, слова и фразы хранятся в IndexedDB и не переводятся повторно.
          {cacheCount !== null && ` Сейчас в кэше: ${cacheCount}.`}
        </p>
        <button className="danger" onClick={clearCache} disabled={!cacheCount}>Очистить кэш</button>
      </section>
    </div>
  );
}
