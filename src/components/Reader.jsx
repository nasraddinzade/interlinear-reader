import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { getText } from '../lib/texts.js';
import { createProvider } from '../lib/providers/index.js';
import { lookupCache, glossMissing } from '../lib/translate.js';
import { useSettings, updateSettings, HINT_MODES, HINT_MODE_LABELS, getSettings } from '../lib/settings.js';
import { speak, useSpeakingId } from '../lib/tts.js';
import { useWords, savedKeySet, isTokenSaved } from '../lib/words.js';
import WordCard from './WordCard.jsx';
import { getChromeTranslator, onChromeDownloadProgress } from '../lib/providers/chrome.js';
import SelectionPopover from './SelectionPopover.jsx';

const cleanForSpeech = (s) => s.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

function Token({ t, id, saved, speaking, hintMode, tapped, onTap, onOpen }) {
  const ptype = useRef('mouse');
  const cls = ['tok', saved && 'saved', speaking && 'speaking', tapped && 'tapped'].filter(Boolean).join(' ');
  return (
    <span
      className={cls}
      data-tok={id}
      data-en={t.en}
      data-gap={t.gap ?? ' '}
      onPointerDown={(e) => { ptype.current = e.pointerType; }}
      onClick={() => {
        // Клик в конце выделения нескольких слов — это не открытие карточки.
        const sel = document.getSelection();
        if (sel && !sel.isCollapsed && sel.toString().trim().includes(' ')) return;
        // На сенсорном экране в режиме «по наведению» первый тап показывает подсказку,
        // второй тап по тому же слову открывает карточку.
        if (hintMode === 'hover' && ptype.current === 'touch' && !tapped && t.ctx) { onTap(id); return; }
        onOpen();
      }}
      title={hintMode === 'off' ? undefined : ''}
    >
      <span className="g">{t.ctx || ' '}</span>
      <span className="w">{t.en}</span>
      {hintMode === 'hover' && t.ctx ? <span className="tip">{t.ctx}</span> : null}
    </span>
  );
}

export default function Reader({ id }) {
  const settings = useSettings();
  const [text, setText] = useState(undefined);
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState('');
  const [fatal, setFatal] = useState('');
  const [needsDownload, setNeedsDownload] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(null);
  const [runKey, setRunKey] = useState(0);
  const [card, setCard] = useState(null);
  const [tapped, setTapped] = useState(null);
  const speakingId = useSpeakingId();
  const words = useWords();
  const savedKeys = useMemo(() => savedKeySet(words), [words]);
  const runRef = useRef(null);
  const rowsRef = useRef([]);
  rowsRef.current = rows;
  const getProvider = useCallback(() => runRef.current?.provider || null, []);
  const hintMode = settings.hintMode || 'visible';

  const providerSig = settings.provider;

  useEffect(() => {
    let alive = true;
    getText(id).then((t) => { if (alive) setText(t || null); });
    return () => { alive = false; };
  }, [id]);

  const applyResult = useCallback((i, r) => {
    setRows((prev) => {
      const next = prev.slice();
      next[i] = r.gloss ? { status: 'done', gloss: r.gloss } : { status: 'error', error: r.error };
      return next;
    });
    // Встроенный переводчик ещё не скачал языковой пакет — нужен клик пользователя.
    if (r.error && /языковой пакет/i.test(r.error)) setNeedsDownload(true);
  }, []);

  useEffect(() => onChromeDownloadProgress((p) => setDownloadProgress(p)), []);

  const downloadPack = async () => {
    setDownloadProgress(0);
    try {
      await getChromeTranslator();
      setNeedsDownload(false);
      setRunKey((k) => k + 1); // перезапускаем перевод
    } catch (e) {
      setFatal(e.message);
    } finally {
      setDownloadProgress(null);
    }
  };

  // Перевод: сначала кэш, потом пачками только то, чего нет.
  useEffect(() => {
    if (!text) return undefined;
    const ctrl = new AbortController();
    setFatal('');
    setStatus('');
    setNeedsDownload(false);
    let provider;
    try {
      provider = createProvider(getSettings());
    } catch (e) {
      setFatal(e.message);
      setRows(text.sentences.map(() => ({ status: 'error', error: e.message })));
      return undefined;
    }
    runRef.current = { provider, ctrl };
    setRows(text.sentences.map(() => ({ status: 'pending' })));
    (async () => {
      const cached = provider.cacheable ? await lookupCache(text.sentences, provider.name) : text.sentences.map(() => null);
      if (ctrl.signal.aborted) return;
      setRows(cached.map((g) => (g ? { status: 'done', gloss: g } : { status: 'pending' })));
      const missing = cached.map((g, i) => (g ? -1 : i)).filter((i) => i >= 0);
      if (missing.length === 0) return;
      await glossMissing({
        sentences: text.sentences,
        indexes: missing,
        provider,
        batchSize: Number(getSettings().batchSize) || 10,
        signal: ctrl.signal,
        onStatus: setStatus,
        onResult: applyResult,
      });
    })().catch((e) => { if (!ctrl.signal.aborted) setFatal(e.message); });
    return () => ctrl.abort();
  }, [text, providerSig, settings.batchSize, applyResult, runKey]);

  const retryRow = (i) => {
    const run = runRef.current;
    if (!run || !text) return;
    setRows((prev) => { const n = prev.slice(); n[i] = { status: 'pending' }; return n; });
    glossMissing({
      sentences: text.sentences, indexes: [i], provider: run.provider, batchSize: 1,
      signal: run.ctrl.signal, onStatus: setStatus, onResult: applyResult,
    });
  };

  // Горячая клавиша H — переключение режима подсказок.
  useEffect(() => {
    const onKey = (e) => {
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (e.key === 'h' || e.key === 'H' || e.key === 'р' || e.key === 'Р') {
        e.preventDefault();
        cycleHintMode();
      } else if (e.key === 'Escape') {
        setCard(null);
        setTapped(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Тап вне слова убирает всплывающую подсказку.
  useEffect(() => {
    if (!tapped) return undefined;
    const onDown = (e) => { if (!e.target.closest?.('.tok.tapped')) setTapped(null); };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [tapped]);

  const cycleHintMode = () => {
    const cur = getSettings().hintMode || 'visible';
    const next = HINT_MODES[(HINT_MODES.indexOf(cur) + 1) % HINT_MODES.length];
    updateSettings({ hintMode: next });
    setTapped(null);
  };

  if (text === undefined) return <div className="page"><p className="muted">Загрузка…</p></div>;
  if (text === null) return <div className="page"><p className="error">Текст не найден. <a href="#/library">В библиотеку</a></p></div>;

  const voice = { voiceURI: settings.voiceURI, rate: settings.rate };
  const done = rows.filter((r) => r.status === 'done').length;
  const errors = rows.filter((r) => r.status === 'error').length;
  const total = text.sentences.length;
  const inProgress = done + errors < total;

  return (
    <div className={`reader mode-${hintMode}`}>
      <div className="reader-bar">
        <div className="reader-title" title={text.title}>{text.title}</div>
        <div className="reader-progress">
          {inProgress ? (
            <>
              <span>Переведено {done} из {total}</span>
              <progress value={done} max={total} />
            </>
          ) : errors ? (
            <span className="error">Не переведено: {errors}</span>
          ) : (
            <span className="muted">{total} предл.</span>
          )}
          {status && <span className="status">{status}</span>}
        </div>
        <button className="hint-toggle" onClick={cycleHintMode} title="Переключить режим подсказок (клавиша H)">
          {HINT_MODE_LABELS[hintMode]}
        </button>
      </div>
      {fatal && <p className="notice warn">{fatal} <a href="#/settings">Настройки</a></p>}
      {needsDownload && (
        <p className="notice">
          Встроенному переводчику нужен языковой пакет en→ru (скачивается один раз).{' '}
          <button className="primary small" onClick={downloadPack} disabled={downloadProgress !== null}>
            {downloadProgress !== null ? `Скачивается… ${Math.round(downloadProgress * 100)}%` : 'Загрузить языковой пакет'}
          </button>
        </p>
      )}

      <div className="rows">
        {text.sentences.map((sentence, i) => {
          const row = rows[i] || { status: 'pending' };
          const sid = `s${i}`;
          const isNewPara = i > 0 && text.paragraphOf?.[i] !== text.paragraphOf?.[i - 1];
          const rowSpeaking = speakingId === sid;
          return (
            <div key={i} data-index={i} className={['row', isNewPara && 'para', rowSpeaking && 'speaking', row.status].filter(Boolean).join(' ')}>
              <div className="num">{i + 1}</div>
              <button
                className={`play${rowSpeaking ? ' active' : ''}`}
                title="Прослушать предложение"
                onClick={() => speak(sentence, { id: sid, ...voice })}
              >
                ▶
              </button>
              <div className="en">
                {row.status === 'done' ? (
                  row.gloss.tokens.map((t, k) => {
                    const tid = `${sid}t${k}`;
                    return (
                      <span key={k}>
                        {k > 0 ? (t.gap || ' ') : ''}
                        <Token
                          t={t}
                          id={tid}
                          hintMode={hintMode}
                          saved={isTokenSaved(t, savedKeys)}
                          speaking={speakingId === tid}
                          tapped={tapped === tid}
                          onTap={setTapped}
                          onOpen={() => {
                            setTapped(null);
                            speak(cleanForSpeech(t.en), { id: tid, ...voice });
                            setCard({ token: t, sentence, sentenceRu: row.gloss.full, index: i });
                          }}
                        />
                      </span>
                    );
                  })
                ) : (
                  <span className="plain">{sentence}</span>
                )}
                {row.status === 'done' && row.gloss.aligned === false && (
                  <button className="warn-btn" title={`Разбивка не совпала с оригиналом: ${row.gloss.alignError || ''}. Нажмите, чтобы перевести заново.`} onClick={() => retryRow(i)}>⚠</button>
                )}
              </div>
              <div className="ru">
                {row.status === 'done' ? (
                  row.gloss.full || <span className="muted">—</span>
                ) : row.status === 'error' ? (
                  <span className="err">
                    {row.error} <button className="small" onClick={() => retryRow(i)}>Повторить</button>
                  </span>
                ) : (
                  <span className="muted">переводится…</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <SelectionPopover
        text={text}
        voice={voice}
        getProvider={getProvider}
        getSentenceRu={(i) => rowsRef.current[i]?.gloss?.full || ''}
      />

      {card && (
        <WordCard
          token={card.token}
          sentence={card.sentence}
          sentenceRu={card.sentenceRu}
          source={text.title}
          voice={voice}
          onClose={() => setCard(null)}
        />
      )}
    </div>
  );
}
