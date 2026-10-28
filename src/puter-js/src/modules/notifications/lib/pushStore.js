// IndexedDB shared with `push-sw.js` on the same origin; names must match it.
export const PUSH_DB_NAME = 'puter-push';
export const HANDLERS_STORE = 'handlers';
export const CLICKS_STORE = 'clicks';

const open = (idb) =>
    new Promise((resolve, reject) => {
        const req = idb.open(PUSH_DB_NAME, 1);
        req.onupgradeneeded = () => {
            req.result.createObjectStore(HANDLERS_STORE);
            req.result.createObjectStore(CLICKS_STORE);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });

const run = async (idb, store, mode, action) => {
    const db = await open(idb);
    try {
        return await new Promise((resolve, reject) => {
            const req = action(db.transaction(store, mode).objectStore(store));
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    } finally {
        db.close();
    }
};

export const idbGet = (store, key, idb = globalThis.indexedDB) =>
    run(idb, store, 'readonly', (s) => s.get(key));

export const idbPut = (store, key, value, idb = globalThis.indexedDB) =>
    run(idb, store, 'readwrite', (s) => s.put(value, key));

export const idbDelete = (store, key, idb = globalThis.indexedDB) =>
    run(idb, store, 'readwrite', (s) => s.delete(key));
