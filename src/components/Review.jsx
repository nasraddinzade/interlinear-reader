import { useEffect, useMemo, useState } from 'react';
import { listWords, putWord, applyAnswer, today } from '../lib/words.js';
import { speak, useSpeakingId } from '../lib/tts.js';
import { useSettings, voiceFor } from '../lib/settings.js';

// Очередь: невыученные слова. Сначала недавно забытые, потом с меньшей серией,
// слова с верным ответом сегодня — в конец (они всё равно не засчитаются дважды).
function buildQueue(words) {
  const d = today();
  const unlearned = words.filter((w) => !w.learned);
  const hitToday = (w) => (w.cleanHitDays || []).includes(d);
  return unlearned.sort((a, b) => {
    const ha = hitToday(a) ? 1 : 0, hb = hitToday(b) ? 1 : 0;
    if (ha !== hb) return ha - hb;
    const ma = a.lastMissAt || '', mb = b.lastMissAt || '';
    if (ma !== mb) return mb.localeCompare(ma);
    const ca = (a.cleanHitDays || []).length, cb = (b.cleanHitDays || []).length;
    if (ca !== cb) return ca - cb;
    return a.addedAt.localeCompare(b.addedAt);
  });
}

export default function Review() {
  const settings = useSettings();
  const speakingId = useSpeakingId();
  const voiceOf = (w) => voiceFor(settings, w?.lang || 'en');
  const [all, setAll] = useState(null);
  const [queue, setQueue] = useState([]);
  const [revealed, setRevealed] = useState(false);
  const [stats, setStats] = useState({ knew: 0, missed: 0, learnedNow: 0 });

  useEffect(() => {
    listWords().then((w) => { setAll(w); setQueue(buildQueue(w)); });
  }, []);

  const current = queue[0];
  const example = useMemo(() => current?.examples?.[0] || (current ? { sentence: current.sentence, sentenceRu: current.sentenceRu } : null), [current]);

  useEffect(() => {
    const onKey = (e) => {
      if (!current) return;
      if (e.key === ' ' || e.key === 'Enter') { if (!revealed) { e.preventDefault(); setRevealed(true); } }
      else if (revealed && (e.key === '1' || e.key === 'ArrowLeft')) answer(false);
      else if (revealed && (e.key === '2' || e.key === 'ArrowRight')) answer(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const answer = async (knew) => {
    if (!current) return;
    const updated = applyAnswer(current, knew);
    await putWord(updated);
    setStats((s) => ({
      knew: s.knew + (knew ? 1 : 0),
      missed: s.missed + (knew ? 0 : 1),
      learnedNow: s.learnedNow + (updated.learned && !current.learned ? 1 : 0),
    }));
    setQueue((q) => {
      const rest = q.slice(1);
      if (knew) return rest;
      // «Не знал» — возвращаем в оборот через 2–3 карточки.
      const at = Math.min(rest.length, 2 + Math.floor(Math.random() * 2));
      return [...rest.slice(0, at), updated, ...rest.slice(at)];
    });
    setRevealed(false);
  };

  if (all === null) return <div className="page narrow"><p className="muted">Загрузка…</p></div>;

  const total = all.length;
  const learned = all.filter((w) => w.learned).length;

  if (!current) {
    return (
      <div className="page narrow">
        <h1>Повторение</h1>
        {total === 0 ? (
          <p className="muted">В словаре нет слов. Сохраните слова из текста, чтобы их повторять.</p>
        ) : stats.knew + stats.missed > 0 ? (
          <div className="summary">
            <p>Сессия закончена.</p>
            <p>Знал: {stats.knew} · Не знал: {stats.missed} · Выучено сегодня: {stats.learnedNow}</p>
            <p className="muted">Всего выучено {learned} из {total}. Слово считается выученным после {all[0]?.requiredDays || 3} верных ответов в разные дни.</p>
            <button className="primary" onClick={() => { listWords().then((w) => { setAll(w); setQueue(buildQueue(w)); setStats({ knew: 0, missed: 0, learnedNow: 0 }); }); }}>Ещё раз</button>
          </div>
        ) : (
          <p className="muted">Все {total} слов выучены. Повторять нечего.</p>
        )}
      </div>
    );
  }

  return (
    <div className="page narrow review">
      <div className="page-head">
        <h1>Повторение</h1>
        <span className="muted">осталось {queue.length} · знал {stats.knew} · не знал {stats.missed}</span>
      </div>
      <div className="flashcard">
        <div className="fc-word">
          <span>{current.en}</span>
          <button className={`icon${speakingId === 'fc-w' ? ' active' : ''}`} title="Прослушать слово" onClick={() => speak(current.en, { id: 'fc-w', ...voiceOf(current) })}>🔊</button>
        </div>
        {example && (
          <div className="fc-sentence">
            <button className={`icon${speakingId === 'fc-s' ? ' active' : ''}`} title="Прослушать пример" onClick={() => speak(example.sentence, { id: 'fc-s', ...voiceOf(current) })}>🔊</button>
            <span>{example.sentence}</span>
          </div>
        )}
        {!revealed ? (
          <div className="fc-hidden">
            <button className="primary big" onClick={() => setRevealed(true)}>Показать</button>
            <div className="muted small">Пробел или Enter</div>
          </div>
        ) : (
          <div className="fc-answer">
            <dl className="card-grid">
              <dt>В контексте</dt><dd>{current.ctx || '—'}</dd>
              <dt>Начальная форма</dt><dd>{current.lemma} {current.pos && <span className="chip">{current.pos}</span>}</dd>
              <dt>Словарь</dt><dd>{current.base || '—'}</dd>
              <dt>Перевод</dt><dd>{example?.sentenceRu || <span className="muted">—</span>}</dd>
            </dl>
            <div className="fc-buttons">
              <button className="danger big" onClick={() => answer(false)}>Не знал <span className="kbd">1</span></button>
              <button className="ok big" onClick={() => answer(true)}>Знал <span className="kbd">2</span></button>
            </div>
            <div className="muted small">
              Серия: {(current.cleanHitDays || []).length} из {current.requiredDays || 3} дней
              {(current.cleanHitDays || []).includes(today()) ? ' · сегодня уже засчитано' : ''}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
