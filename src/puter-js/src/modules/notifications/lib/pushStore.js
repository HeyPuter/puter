// IndexedDB shared with `push-sw.js` on the same origin; names must match it.
export const PUSH_DB_NAME = 'puter-push';
export const HANDLERS_STORE = 'handlers';
export const CLICKS_STORE = 'clicks';

// Kept in the handlers store under keys no channel can take, so the database
// stays at the version workers already installed open.
const OPT_IN_PREFIX = 'puter:opt-in:';
export const SERVER_KEY_ENTRY = 'puter:server-key';
/** Every key the server named as Puter's, the current one first. */
export const SERVER_KEYS_ENTRY = 'puter:server-keys';
/** Per user: `{ endpoint, at }` of the subscription the server last confirmed. */
export const SYNCED_PREFIX = 'puter:synced:';
/** Per worker scope: set by `push-sw.js` when a subscription is replaced. */
export const SUBSCRIPTION_CHANGED_PREFIX = 'puter:subscription-changed:';
/** Per worker scope: `{ endpoint, receipt }` the server last gave. */
export const RECEIPT_PREFIX = 'puter:receipt:';
/** Where a tap without a URL goes, per worker scope; read by `push-sw.js`. */
export const TAP_BASE_PREFIX = 'puter:tap-base:';
/** How long a kept tap waits for its page, as in `push-sw.js`. */
export const CLICK_KEEP_MS = 5 * 60 * 1000;

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

/** Forgets every user's opt-in and sync, every receipt, and every kept tap. */
export const forgetPushState = async (idb = globalThis.indexedDB) => {
    for (const prefix of [
        OPT_IN_PREFIX,
        SYNCED_PREFIX,
        SUBSCRIPTION_CHANGED_PREFIX,
        RECEIPT_PREFIX,
    ]) {
        await run(idb, HANDLERS_STORE, 'readwrite', (s) =>
            s.delete(globalThis.IDBKeyRange.bound(prefix, `${prefix}￿`)),
        );
    }
    await run(idb, CLICKS_STORE, 'readwrite', (s) => s.clear());
};

/** Takes tap `uid` (only the copy posted as `id`, if given) in one transaction. */
export const takeClick = async (uid, id, idb = globalThis.indexedDB) => {
    const matches = (kept) => !!kept && (id === undefined || kept.id === id);
    const kept = await run(idb, CLICKS_STORE, 'readwrite', (s) => {
        const req = s.get(uid);
        req.addEventListener('success', () => {
            if (matches(req.result)) s.delete(uid);
        });
        return req;
    });
    return matches(kept) ? kept : null;
};

/** Removes kept taps older than `CLICK_KEEP_MS`. */
export const forgetOldClicks = (idb = globalThis.indexedDB) => {
    const cutoff = Date.now() - CLICK_KEEP_MS;
    return run(idb, CLICKS_STORE, 'readwrite', (s) => {
        const req = s.openCursor();
        req.addEventListener('success', () => {
            const cursor = req.result;
            if (!cursor) return;
            if (!(cursor.value?.at > cutoff)) cursor.delete();
            cursor.continue();
        });
        return req;
    });
};
