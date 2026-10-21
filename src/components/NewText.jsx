import { useState } from 'react';
import { addText } from '../lib/texts.js';
import { navigate } from '../lib/route.js';
import { useSettings } from '../lib/settings.js';
import { providerInfo } from '../lib/providers/index.js';

export default function NewText() {
  const settings = useSettings();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const info = providerInfo(settings.provider);
  const keyMissing = info.needsKey && !(settings.keys?.[info.id] || '').trim();

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
          Выбран провайдер без перевода. Текст откроется, но переводов не будет — выберите провайдера и введите ключ в{' '}
          <a href="#/settings">Настройках</a>.
        </p>
      )}
      {keyMissing && (
        <p className="notice warn">
          Для провайдера «{info.name}» не задан ключ. <a href="#/settings">Настройки</a>.
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
