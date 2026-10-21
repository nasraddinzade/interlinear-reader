import { useEffect, useState } from 'react';
import { speak, useSpeakingId } from '../lib/tts.js';
import { findByToken, saveWord } from '../lib/words.js';

const clean = (s) => s.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

export default function WordCard({ token, sentence, sentenceRu, source, voice, onClose }) {
  const [existing, setExisting] = useState(null);
  const [msg, setMsg] = useState('');
  const speakingId = useSpeakingId();

  useEffect(() => {
    let alive = true;
    findByToken(token).then((w) => { if (alive) setExisting(w); });
    return () => { alive = false; };
  }, [token]);

  const alreadyHasExample = existing && (existing.examples || []).some((e) => e.sentence === sentence);

  const save = async () => {
    const r = await saveWord({ token, sentence, sentenceRu, source });
    setExisting(r.word);
    setMsg(r.created ? 'Сохранено в словарь' : r.exampleAdded ? 'Пример добавлен к существующей записи' : 'Уже в словаре с этим примером');
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal card" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Карточка слова">
        <button className="close" onClick={onClose} aria-label="Закрыть">×</button>
        <div className="card-head">
          <span className="card-en">{token.en}</span>
          <button className={`icon${speakingId === 'card-word' ? ' active' : ''}`} title="Прослушать слово" onClick={() => speak(clean(token.en), { id: 'card-word', ...voice })}>🔊</button>
          {token.pos && <span className="chip">{token.pos}</span>}
        </div>
        <dl className="card-grid">
          <dt>В контексте</dt><dd>{token.ctx || <span className="muted">—</span>}</dd>
          <dt>Начальная форма</dt><dd>{token.lemma || <span className="muted">—</span>}</dd>
          <dt>Словарь</dt><dd>{token.base || <span className="muted">—</span>}</dd>
        </dl>
        <div className="card-sentence">
          <button className={`icon${speakingId === 'card-sent' ? ' active' : ''}`} title="Прослушать предложение" onClick={() => speak(sentence, { id: 'card-sent', ...voice })}>🔊</button>
          <div>
            <div>{sentence}</div>
            {sentenceRu && <div className="muted">{sentenceRu}</div>}
          </div>
        </div>
        <div className="card-actions">
          {existing && alreadyHasExample ? (
            <button disabled>✓ В словаре</button>
          ) : existing ? (
            <button className="primary" onClick={save}>+ Добавить пример в словарь</button>
          ) : (
            <button className="primary" onClick={save}>Сохранить в словарь</button>
          )}
          {existing && <a href="#/words" className="muted small-link">открыть словарь</a>}
          {msg && <span className="muted">{msg}</span>}
        </div>
      </div>
    </div>
  );
}
