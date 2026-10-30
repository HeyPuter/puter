// IndexedDB shared with `push-sw.js` on the same origin; names must match it.
export const PUSH_DB_NAME = 'puter-push';
export const HANDLERS_STORE = 'handlers';
export const CLICKS_STORE = 'clicks';

// Kept in the handlers store under keys no channel can take, so the database
// stays at the version workers already installed open.
const OPT_IN_PREFIX = 'puter:opt-in:';
export const SERVER_KEY_ENTRY = 'puter:server-key';

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

/** Whether the user with `userUuid` turned push on here with `enable()`. */
export const hasOptIn = async (userUuid, idb = globalThis.indexedDB) =>
    (await idbGet(HANDLERS_STORE, OPT_IN_PREFIX + userUuid, idb)) === true;

/** Records or forgets one user's opt-in. */
export const setOptIn = (userUuid, on, idb = globalThis.indexedDB) =>
    on
        ? idbPut(HANDLERS_STORE, OPT_IN_PREFIX + userUuid, true, idb)
        : idbDelete(HANDLERS_STORE, OPT_IN_PREFIX + userUuid, idb);

/** Forgets every user's opt-in and every kept tap. */
export const forgetPushState = async (idb = globalThis.indexedDB) => {
    await run(idb, HANDLERS_STORE, 'readwrite', (s) =>
        s.delete(
            globalThis.IDBKeyRange.bound(OPT_IN_PREFIX, `${OPT_IN_PREFIX}￿`),
        ),
    );
    await run(idb, CLICKS_STORE, 'readwrite', (s) => s.clear());
};
