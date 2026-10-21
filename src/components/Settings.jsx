import { useEffect, useState } from 'react';
import { useSettings, updateSettings, HINT_MODES, HINT_MODE_LABELS } from '../lib/settings.js';
import { PROVIDERS, providerInfo, createProvider } from '../lib/providers/index.js';
import { speak, useEnglishVoices, ttsSupported } from '../lib/tts.js';
import { idb } from '../lib/db.js';
import { alignTokens } from '../lib/align.js';

const TEST_SENTENCE = "I'll get back to you on that.";

export default function Settings() {
  const s = useSettings();
  const voices = useEnglishVoices();
  const info = providerInfo(s.provider);
  const [showKey, setShowKey] = useState(false);
  const [test, setTest] = useState(null);
  const [cacheCount, setCacheCount] = useState(null);

  useEffect(() => { idb.count('cache').then(setCacheCount); }, [test]);

  const setKey = (v) => updateSettings((st) => ({ ...st, keys: { ...st.keys, [info.id]: v } }));
  const setModel = (v) => updateSettings((st) => ({ ...st, models: { ...st.models, [info.id]: v } }));
  const model = s.models?.[info.id] ?? info.defaultModel ?? '';

  const runTest = async () => {
    setTest({ busy: true });
    try {
      const provider = createProvider(s);
      const t0 = Date.now();
      const g = await provider.glossSentence(TEST_SENTENCE);
      const a = alignTokens(TEST_SENTENCE, g.tokens);
      setTest({ ok: true, ms: Date.now() - t0, gloss: g, aligned: a.ok, reason: a.reason });
    } catch (e) {
      setTest({ ok: false, error: e.message });
    }
  };

  const clearCache = async () => {
    if (!window.confirm('Удалить все закэшированные переводы? Тексты придётся переводить заново (это стоит запросов к API).')) return;
    await idb.clear('cache');
    setCacheCount(0);
  };

  return (
    <div className="page narrow settings">
      <h1>Настройки</h1>

      <section>
        <h2>Переводчик</h2>
        <label>
          Провайдер
          <select value={s.provider} onChange={(e) => { updateSettings({ provider: e.target.value }); setTest(null); }}>
            {PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <p className="muted small">{info.note}</p>
        {info.needsKey && (
          <label>
            API-ключ {info.keyUrl && <a href={info.keyUrl} target="_blank" rel="noreferrer">(получить)</a>}
            <span className="key-row">
              <input
                type={showKey ? 'text' : 'password'}
                value={s.keys?.[info.id] || ''}
                onChange={(e) => setKey(e.target.value.trim())}
                placeholder="Хранится только в этом браузере (localStorage)"
                autoComplete="off"
                spellCheck={false}
              />
              <button type="button" onClick={() => setShowKey((v) => !v)}>{showKey ? 'Скрыть' : 'Показать'}</button>
            </span>
          </label>
        )}
        {info.id === 'custom' && (
          <>
            <label>
              Базовый URL
              <input value={s.customBaseUrl || ''} onChange={(e) => updateSettings({ customBaseUrl: e.target.value })} placeholder="http://localhost:11434/v1" />
            </label>
            <label>
              API-ключ (если нужен)
              <input type="password" value={s.keys?.custom || ''} onChange={(e) => setKey(e.target.value.trim())} autoComplete="off" />
            </label>
          </>
        )}
        {info.id !== 'stub' && (
          <label>
            Модель
            <input list="model-list" value={model} onChange={(e) => setModel(e.target.value)} spellCheck={false} />
            <datalist id="model-list">
              {(info.models || []).map((m) => <option key={m} value={m} />)}
            </datalist>
          </label>
        )}
        <label>
          Размер пачки (предложений в одном запросе)
          <input type="number" min={1} max={50} value={s.batchSize} onChange={(e) => updateSettings({ batchSize: Math.max(1, Math.min(50, Number(e.target.value) || 10)) })} />
        </label>
        <div className="form-row">
          <button onClick={runTest} disabled={test?.busy || s.provider === 'stub'}>{test?.busy ? 'Проверяю…' : 'Проверить подключение'}</button>
          {test && !test.busy && (
            test.ok ? (
              <span className={test.aligned ? 'ok-text' : 'warn-text'}>
                OK за {test.ms} мс{test.aligned ? ', разбивка совпала' : `, разбивка НЕ совпала (${test.reason})`}
              </span>
            ) : (
              <span className="error">{test.error}</span>
            )
          )}
        </div>
        {test?.ok && (
          <pre className="test-out">
            {test.gloss.full}{'\n'}
            {test.gloss.tokens.map((t) => `${t.en} → ${t.ctx} [${t.lemma}: ${t.base}] (${t.pos})`).join('\n')}
          </pre>
        )}
      </section>

      <section>
        <h2>Озвучка</h2>
        {!ttsSupported ? (
          <p className="error">Браузер не поддерживает SpeechSynthesis.</p>
        ) : (
          <>
            <label>
              Голос (en-US / en-GB)
              <select value={s.voiceURI || ''} onChange={(e) => updateSettings({ voiceURI: e.target.value })}>
                <option value="">По умолчанию</option>
                {voices.map((v) => <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang}){v.localService ? '' : ' · онлайн'}</option>)}
              </select>
            </label>
            {voices.length === 0 && <p className="muted small">Английских голосов не найдено. В Windows их можно добавить в Параметры → Время и язык → Речь.</p>}
            <label>
              Скорость: {Number(s.rate).toFixed(2)}
              <input type="range" min={0.5} max={1.5} step={0.05} value={s.rate} onChange={(e) => updateSettings({ rate: Number(e.target.value) })} />
            </label>
            <button onClick={() => speak(TEST_SENTENCE, { id: 'settings-test', voiceURI: s.voiceURI, rate: s.rate })}>🔊 Проверить голос</button>
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
          Переведённые предложения хранятся в IndexedDB и не запрашиваются повторно. Ключ — хэш предложения плюс имя провайдера.
          {cacheCount !== null && ` Сейчас в кэше: ${cacheCount}.`}
        </p>
        <button className="danger" onClick={clearCache} disabled={!cacheCount}>Очистить кэш</button>
      </section>
    </div>
  );
}
