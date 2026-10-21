import { useRoute, navigate } from './lib/route.js';
import Library from './components/Library.jsx';
import NewText from './components/NewText.jsx';
import Reader from './components/Reader.jsx';
import Dictionary from './components/Dictionary.jsx';
import Review from './components/Review.jsx';
import Settings from './components/Settings.jsx';

const NAV = [
  ['library', 'Библиотека'],
  ['new', 'Новый текст'],
  ['words', 'Словарь'],
  ['review', 'Повторение'],
  ['settings', 'Настройки'],
];

export default function App() {
  const { page, param } = useRoute();
  let screen;
  switch (page) {
    case 'new': screen = <NewText />; break;
    case 'read': screen = <Reader id={param} key={param} />; break;
    case 'words': screen = <Dictionary />; break;
    case 'review': screen = <Review />; break;
    case 'settings': screen = <Settings />; break;
    default: screen = <Library />;
  }
  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="#/library" onClick={(e) => { e.preventDefault(); navigate('library'); }}>
          Interlinear Reader
        </a>
        <nav>
          {NAV.map(([id, label]) => (
            <a key={id} href={`#/${id}`} className={page === id || (id === 'library' && page === 'read') ? 'active' : ''}>
              {label}
            </a>
          ))}
        </nav>
      </header>
      <main className={`screen screen-${page}`}>{screen}</main>
    </div>
  );
}
