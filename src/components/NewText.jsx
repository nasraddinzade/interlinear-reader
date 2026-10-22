import { useEffect, useRef, useState } from 'react';
import { addText } from '../lib/texts.js';
import { navigate } from '../lib/route.js';
import { useSettings, updateSettings } from '../lib/settings.js';
import { chromeSupported, detectLanguage } from '../lib/providers/chrome.js';
import { LANGUAGES, langName } from '../lib/languages.js';

export default function NewText() {
  const settings = useSettings();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [lang, setLang] = useState(settings.sourceLang || 'en');
  const [detected, setDetected] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const detectTimer = useRef(null);

  // Автоопределение языка вставленного текста (LanguageDetector API), если он есть.
  useEffect(() => {
    clearTimeout(detectTimer.current);
    if (body.trim().length < 40) return undefined;
    detectTimer.current = setTimeout(async () => {
      const code = await detectLanguage(body);
      if (code && code !== lang && LANGUAGES.some((l) => l.code === code)) {
        setLang(code);
        setDetected(code);
      }
    }, 400);
    return () => clearTimeout(detectTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body]);

  const onFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const txt = await f.text();
    setBody(txt);
    if (!title) setTitle(f.name.replace(/\.txt$/i, ''));
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (!settings.languages.includes(lang)) updateSettings((s) => ({ ...s, languages: [...s.languages, lang] }));
      updateSettings({ sourceLang: lang });
      const t = await addText({ title, body, lang });
      navigate(`read/${t.id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page narrow">
      <h1>Новый текст</h1>
      {settings.provider === 'stub' && (
        <p className="notice">
          Выбран режим без перевода. Текст откроется, но переводов не будет — выберите встроенный переводчик в{' '}
          <a href="#/settings">Настройках</a>.
        </p>
      )}
      {settings.provider === 'chrome' && !chromeSupported() && (
        <p className="notice warn">
          В этом браузере нет встроенного переводчика. Откройте приложение в Chrome 138+ или Edge.
        </p>
      )}
      <form onSubmit={submit} className="form">
        <div className="form-grid">
          <label>
            Название (необязательно)
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Например, глава 1" />
          </label>
          <label>
            Язык текста{detected === lang && detected ? <span className="muted"> · определён автоматически</span> : null}
            <select value={lang} onChange={(e) => { setLang(e.target.value); setDetected(''); }}>
              {LANGUAGES.filter((l) => l.code !== settings.targetLang).map((l) => (
                <option key={l.code} value={l.code}>{l.name}</option>
              ))}
            </select>
          </label>
        </div>
        <p className="muted small">
          Перевод на {langName(settings.targetLang)} (меняется в <a href="#/settings">Настройках</a>).
          {lang !== 'en' && ' Леммы, части речи и фразовые глаголы считаются только для английского; для других языков слова переводятся как есть.'}
        </p>
        <label>
          Текст
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={16}
            placeholder="Вставьте текст сюда…"
            spellCheck={false}
          />
        </label>
        <div className="form-row">
          <label className="file-btn">
            Загрузить файл .txt
            <input type="file" accept=".txt,text/plain" onChange={onFile} />
          </label>
          <span className="muted">{body.trim() ? `${body.length.toLocaleString('ru-RU')} символов` : ''}</span>
          <span className="spacer" />
          <button className="primary" type="submit" disabled={busy || !body.trim()}>
            Загрузить и читать
          </button>
        </div>
        {error && <p className="error">{error}</p>}
      </form>
    </div>
  );
}
