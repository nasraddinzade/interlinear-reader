// Тонкая обёртка над IndexedDB. Хранилища:
//   texts  — загруженные тексты            { id, title, sentences[], paragraphOf[], createdAt }
//   cache  — переводы предложений          { key: `${provider}:${sha256(sentence)}`, gloss, at }
//   words  — личный словарь                { id, key, en, lemma, ... examples[] }
//   meta   — служебные счётчики            { key, value }

const DB_NAME = 'interlinear-reader';
const DB_VERSION = 1;
let dbPromise = null;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('texts')) db.createObjectStore('texts', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('cache')) db.createObjectStore('cache', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('words')) {
        const s = db.createObjectStore('words', { keyPath: 'id' });
        s.createIndex('key', 'key', { unique: false });
      }
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function run(store, mode, fn) {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(store, mode);
        const result = fn(t.objectStore(store));
        t.oncomplete = () => resolve(typeof result === 'function' ? result() : result?.result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      }),
  );
}

export const idb = {
  get: (store, key) => run(store, 'readonly', (s) => s.get(key)),
  getAll: (store) => run(store, 'readonly', (s) => s.getAll()),
  count: (store) => run(store, 'readonly', (s) => s.count()),
  put: (store, value) => run(store, 'readwrite', (s) => s.put(value)),
  putMany: (store, values) => run(store, 'readwrite', (s) => { values.forEach((v) => s.put(v)); }),
  delete: (store, key) => run(store, 'readwrite', (s) => s.delete(key)),
  clear: (store) => run(store, 'readwrite', (s) => s.clear()),
  /** Возвращает массив той же длины, что keys; отсутствующие записи — undefined. */
  getMany: (store, keys) =>
    run(store, 'readonly', (s) => {
      const out = new Array(keys.length);
      keys.forEach((k, i) => {
        const r = s.get(k);
        r.onsuccess = () => { out[i] = r.result; };
      });
      return () => out;
    }),
};
