import { useMemo, useState } from 'react';
import { useWords, deleteWord, exportWordsJson, today } from '../lib/words.js';
import { speak, useSpeakingId } from '../lib/tts.js';
import { useSettings } from '../lib/settings.js';

export default function Dictionary() {
  const words = useWords();
  const settings = useSettings();
  const speakingId = useSpeakingId();
  const voice = { voiceURI: settings.voiceURI, rate: settings.rate };
  const [q, setQ] = useState('');
  const [source, setSource] = useState('');
  const [pos, setPos] = useState('');
  const [sort, setSort] = useState('date-desc');
  const [open, setOpen] = useState({});

  const sources = useMemo(() => [...new Set(words.flatMap((w) => (w.examples || []).map((e) => e.source).concat(w.source)))].filter(Boolean).sort(), [words]);
  const poses = useMemo(() => [...new Set(words.map((w) => w.pos).filter(Boolean))].sort(), [words]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let list = words.filter((w) => {
      if (source && w.source !== source && !(w.examples || []).some((e) => e.source === source)) return false;
      if (pos && w.pos !== pos) return false;
      if (needle) {
        const hay = [w.en, w.lemma, w.ctx, w.base].join(' ').toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    const byId = (a, b) => a.id.localeCompare(b.id);
    switch (sort) {
      case 'date-asc': list.sort((a, b) => a.addedAt.localeCompare(b.addedAt) || byId(a, b)); break;
      case 'alpha': list.sort((a, b) => a.lemma.toLowerCase().localeCompare(b.lemma.toLowerCase(), 'en')); break;
      case 'alpha-desc': list.sort((a, b) => b.lemma.toLowerCase().localeCompare(a.lemma.toLowerCase(), 'en')); break;
      default: list.sort((a, b) => b.addedAt.localeCompare(a.addedAt) || byId(b, a));
    }
    return list;
  }, [words, q, source, pos, sort]);

  const exportJson = () => {
    const blob = new Blob([exportWordsJson(words)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `vocabulary-${today()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const remove = async (w) => {
    if (!window.confirm(`Удалить «${w.en}» из словаря?`)) return;
    await deleteWord(w.id);
  };

  const learnedCount = words.filter((w) => w.learned).length;

  return (
    <div className="page">
      <div className="page-head">
        <h1>Словарь <span className="muted h-sub">{words.length} слов, выучено {learnedCount}</span></h1>
        <button onClick={exportJson} disabled={!words.length}>Экспорт в JSON</button>
      </div>
      <div className="filters">
        <input placeholder="Поиск…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="">Все тексты</option>
          {sources.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={pos} onChange={(e) => setPos(e.target.value)}>
          <option value="">Все части речи</option>
          {poses.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="date-desc">Сначала новые</option>
          <option value="date-asc">Сначала старые</option>
          <option value="alpha">По алфавиту A–Z</option>
          <option value="alpha-desc">По алфавиту Z–A</option>
        </select>
      </div>
      {words.length === 0 ? (
        <p className="muted">Словарь пуст. Нажмите на слово в тексте и сохраните его.</p>
      ) : shown.length === 0 ? (
        <p className="muted">Ничего не найдено.</p>
      ) : (
        <ul className="list words">
          {shown.map((w) => {
            const ex = w.examples?.[0] || { sentence: w.sentence, sentenceRu: w.sentenceRu, source: w.source };
            const more = (w.examples || []).length > 1;
            return (
              <li key={w.id} className={`list-item word${w.learned ? ' learned' : ''}`}>
                <div className="list-main">
                  <div className="word-head">
                    <span className="word-en">{w.en}</span>
                    {w.lemma && w.lemma.toLowerCase() !== w.en.toLowerCase() && <span className="muted">→ {w.lemma}</span>}
                    {w.pos && <span className="chip">{w.pos}</span>}
                    {w.learned ? <span className="chip ok">выучено</span> : (w.cleanHitDays?.length ? <span className="chip">{w.cleanHitDays.length}/{w.requiredDays}</span> : null)}
                    <button className={`icon${speakingId === w.id ? ' active' : ''}`} title="Прослушать слово" onClick={() => speak(w.en, { id: w.id, ...voice })}>🔊</button>
                  </div>
                  <div className="word-base">{w.base}{w.ctx && w.ctx !== w.base ? <span className="muted"> · в контексте: {w.ctx}</span> : null}</div>
                  <div className="word-example">
                    <button className={`icon${speakingId === w.id + 'e' ? ' active' : ''}`} title="Прослушать пример" onClick={() => speak(ex.sentence, { id: w.id + 'e', ...voice })}>🔊</button>
                    <span>{ex.sentence}</span>
                    {ex.source && <span className="muted"> — {ex.source}</span>}
                    {more && (
                      <button className="small link" onClick={() => setOpen((o) => ({ ...o, [w.id]: !o[w.id] }))}>
                        {open[w.id] ? 'скрыть' : `ещё ${w.examples.length - 1}`}
                      </button>
                    )}
                  </div>
                  {more && open[w.id] && (
                    <ul className="examples">
                      {w.examples.slice(1).map((e, i) => (
                        <li key={i}>
                          <button className={`icon${speakingId === `${w.id}e${i}` ? ' active' : ''}`} onClick={() => speak(e.sentence, { id: `${w.id}e${i}`, ...voice })}>🔊</button>
                          <span>{e.sentence}</span>{e.source && <span className="muted"> — {e.source}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <button className="icon danger" title="Удалить" onClick={() => remove(w)}>✕</button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
