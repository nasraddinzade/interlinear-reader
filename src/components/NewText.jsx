import { useState } from 'react';
import { addText } from '../lib/texts.js';
import { navigate } from '../lib/route.js';
import { useSettings } from '../lib/settings.js';
import { chromeSupported } from '../lib/providers/chrome.js';

export default function NewText() {
  const settings = useSettings();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

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
      const t = await addText({ title, body });
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
        <label>
          Название (необязательно)
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Например, глава 1" />
        </label>
        <label>
          Английский текст
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
