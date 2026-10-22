// Перевод выделенного фрагмента: выделите мышью или долгим нажатием несколько слов
// внутри одного предложения — выделение прилипает к целым словам, рядом появляется
// перевод фразы с озвучкой и кнопкой сохранения в словарь.

import { useEffect, useRef, useState } from 'react';
import { speak, useSpeakingId } from '../lib/tts.js';
import { saveWord, findByToken } from '../lib/words.js';
import { analyze } from '../lib/gloss-local.js';

const DEBOUNCE_MS = 250;

function selectedTokens(range, en) {
  const out = [];
  for (const tok of en.querySelectorAll('.tok')) {
    const w = tok.querySelector('.w');
    if (!w) continue;
    const r = document.createRange();
    r.selectNodeContents(w);
    // Строгое пересечение: начало выделения раньше конца слова и конец выделения позже начала слова.
    const overlaps = range.compareBoundaryPoints(Range.END_TO_START, r) < 0 && range.compareBoundaryPoints(Range.START_TO_END, r) > 0;
    if (overlaps) out.push(tok);
  }
  return out;
}

export default function SelectionPopover({ text, getProvider, getSentenceRu, voice, lang = 'en', tgt = 'ru' }) {
  const [state, setState] = useState(null);
  const reqRef = useRef(0);
  const speakingId = useSpeakingId();

  useEffect(() => {
    let timer = null;
    const place = (range) => {
      const rect = range.getBoundingClientRect();
      return { left: rect.left + rect.width / 2, top: rect.bottom + 6 };
    };
    const handle = () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const sel = document.getSelection();
        if (!sel || sel.isCollapsed || sel.rangeCount === 0) { setState(null); return; }
        const range = sel.getRangeAt(0);
        const c = range.commonAncestorContainer;
        const el = c.nodeType === 1 ? c : c.parentElement;
        const en = el?.closest('.row .en');
        if (!en) { setState(null); return; }
        const toks = selectedTokens(range, en);
        if (toks.length < 2) { setState(null); return; }
        const phrase = toks.map((t, k) => (k ? t.dataset.gap || ' ' : '') + t.dataset.en).join('');
        const index = Number(en.closest('.row').dataset.index);
        const id = ++reqRef.current;
        const pos = place(range);
        setState((prev) => (prev && prev.phrase === phrase && prev.index === index ? { ...prev, pos } : { phrase, index, pos, loading: true, ru: '', error: '', saved: null }));
        const provider = getProvider();
        if (!provider?.translateText) { setState((s) => s && { ...s, loading: false }); return; }
        try {
          const [ru, existing] = await Promise.all([
            provider.translateText(phrase),
            findByToken({ en: phrase, lemma: phraseLemma(phrase, lang) }, lang),
          ]);
          if (id === reqRef.current) setState((s) => s && { ...s, ru, loading: false, saved: existing ? 'exists' : null });
        } catch (e) {
          if (id === reqRef.current) setState((s) => s && { ...s, error: e.message, loading: false });
        }
      }, DEBOUNCE_MS);
    };
    const onScroll = () => {
      const sel = document.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
      setState((s) => (s ? { ...s, pos: place(sel.getRangeAt(0)) } : s));
    };
    const onKey = (e) => { if (e.key === 'Escape') { setState(null); document.getSelection()?.removeAllRanges(); } };
    document.addEventListener('selectionchange', handle);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('selectionchange', handle);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [getProvider, lang]);

  if (!state) return null;

  const sentence = text.sentences[state.index];
  const save = async () => {
    const token = { en: state.phrase, ctx: state.ru, lemma: phraseLemma(state.phrase, lang), base: state.ru, pos: 'expression' };
    const r = await saveWord({ token, sentence, sentenceRu: getSentenceRu(state.index) || '', source: text.title, lang, tgt });
    setState((s) => s && { ...s, saved: r.created ? 'created' : r.exampleAdded ? 'example' : 'exists' });
  };

  const left = Math.min(Math.max(state.pos.left, 150), window.innerWidth - 150);
  return (
    <div
      className="sel-pop"
      style={{ left, top: state.pos.top }}
      onPointerDown={(e) => e.preventDefault()} /* не сбрасывать выделение при клике по всплывашке */
      role="dialog"
      aria-label="Перевод выделения"
    >
      <div className="sel-phrase">
        <span>{state.phrase}</span>
        <button className={`icon${speakingId === 'sel' ? ' active' : ''}`} title="Прослушать" onClick={() => speak(state.phrase, { id: 'sel', ...voice })}>🔊</button>
      </div>
      <div className="sel-ru">
        {state.loading ? <span className="muted">перевожу…</span> : state.error ? <span className="error">{state.error}</span> : state.ru || <span className="muted">нет перевода</span>}
      </div>
      <div className="sel-actions">
        {state.saved === 'created' ? <span className="ok-text">Сохранено в словарь</span>
          : state.saved === 'example' ? <span className="ok-text">Пример добавлен</span>
          : state.saved === 'exists' ? <button className="small" onClick={save}>+ Добавить пример</button>
          : <button className="primary small" onClick={save} disabled={state.loading || !state.ru}>В словарь</button>}
        <button className="icon" title="Закрыть" onClick={() => { setState(null); document.getSelection()?.removeAllRanges(); }}>×</button>
      </div>
    </div>
  );
}

function phraseLemma(phrase, lang = 'en') {
  try {
    return analyze(phrase, lang).map((t) => t.lemma).join(' ') || phrase;
  } catch {
    return phrase;
  }
}
