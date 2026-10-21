import { useEffect, useState } from 'react';
import { listTexts, deleteText } from '../lib/texts.js';
import { navigate } from '../lib/route.js';

export default function Library() {
  const [texts, setTexts] = useState(null);
  const reload = () => listTexts().then(setTexts);
  useEffect(() => { reload(); }, []);

  const remove = async (t) => {
    if (!window.confirm(`Удалить текст «${t.title}»? Переводы останутся в кэше, слова — в словаре.`)) return;
    await deleteText(t.id);
    reload();
  };

  return (
    <div className="page narrow">
      <div className="page-head">
        <h1>Библиотека</h1>
        <button className="primary" onClick={() => navigate('new')}>+ Новый текст</button>
      </div>
      {texts === null ? (
        <p className="muted">Загрузка…</p>
      ) : texts.length === 0 ? (
        <p className="muted">Пока пусто. Вставьте английский текст на экране «Новый текст».</p>
      ) : (
        <ul className="list">
          {texts.map((t) => (
            <li key={t.id} className="list-item">
              <a className="list-main" href={`#/read/${t.id}`}>
                <div className="list-title">{t.title}</div>
                <div className="list-sub">
                  {t.sentences.length} предл. · {new Date(t.createdAt).toLocaleDateString('ru-RU')}
                </div>
              </a>
              <button className="icon danger" title="Удалить" onClick={() => remove(t)}>✕</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
