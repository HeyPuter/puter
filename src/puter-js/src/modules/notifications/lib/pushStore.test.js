import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    CLICKS_STORE,
    CLICK_KEEP_MS,
    HANDLERS_STORE,
    PUSH_DB_NAME,
    RECEIPT_PREFIX,
    SERVER_KEY_ENTRY,
    SUBSCRIPTION_CHANGED_PREFIX,
    SYNCED_PREFIX,
    TAP_BASE_PREFIX,
    forgetOldClicks,
    forgetPushState,
    hasOptIn,
    idbDelete,
    idbGet,
    idbPut,
    setOptIn,
    takeClick,
} from './pushStore.js';

const ALICE = '0b1c9a52-3f0e-4c7a-9a65-2f6d1e8b7c40';
const BOB = '7d2e4f10-8a3b-4c5d-9e6f-0a1b2c3d4e5f';

/**
 * Enough of IndexedDB for the push store: one database whose requests settle
 * a microtask later. `failing` names what the browser refuses: 'open' or a
 * store operation.
 */
const fakeIndexedDB = () => {
    const idb = { stores: null, opened: [], openConnections: 0, failing: null };
    const request = (operation, run) => {
        const req = { listeners: [] };
        req.addEventListener = (_type, listener) => req.listeners.push(listener);
        const succeed = (result) => {
            req.result = result;
            req.onsuccess?.();
            for ( const listener of req.listeners ) listener();
        };
        queueMicrotask(() => {
            if ( idb.failing === operation ) {
                req.error = new DOMException(`${operation} failed`, 'UnknownError');
                req.onerror?.();
                return;
            }
            succeed(run(succeed));
        });
        return req;
    };
    const inRange = (key, range) => (typeof range === 'object'
        ? key >= range.lower && key <= range.upper
        : key === range);
    const objectStore = (name) => {
        const rows = idb.stores[name];
        return {
            get: key => request('get', () => rows.get(key)),
            put: (value, key) => request('put', () => void rows.set(key, value)),
            delete: range => request('delete', () => {
                for ( const key of [...rows.keys()] ) {
                    if ( inRange(key, range) ) rows.delete(key);
                }
            }),
            clear: () => request('clear', () => void rows.clear()),
            openCursor: () => request('openCursor', (succeed) => {
                const keys = [...rows.keys()];
                const cursorAt = index => (index < keys.length ? {
                    value: rows.get(keys[index]),
                    delete: () => rows.delete(keys[index]),
                    continue: () => queueMicrotask(() => succeed(cursorAt(index + 1))),
                } : null);
                return cursorAt(0);
            }),
        };
    };
    idb.open = (name, version) => {
        idb.opened.push([name, version]);
        const req = {};
        queueMicrotask(() => {
            if ( idb.failing === 'open' ) {
                req.error = new DOMException('open failed', 'UnknownError');
                req.onerror?.();
                return;
            }
            req.result = {
                createObjectStore: (store) => {
                    idb.stores[store] = new Map();
                },
                transaction: store => ({ objectStore: () => objectStore(store) }),
                close: () => {
                    idb.openConnections--;
                },
            };
            // First open: the upgrade creates the object stores.
            if ( ! idb.stores ) {
                idb.stores = {};
                req.onupgradeneeded?.();
            }
            idb.openConnections++;
            req.onsuccess?.();
        });
        return req;
    };
    return idb;
};

/** Lets a cursor walk that outlives its first result finish. */
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

let idb;

beforeEach(() => {
    idb = fakeIndexedDB();
    vi.stubGlobal('indexedDB', idb);
    vi.stubGlobal('IDBKeyRange', { bound: (lower, upper) => ({ lower, upper }) });
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

const keysOf = store => [...idb.stores[store].keys()];

describe('push store entries', () => {
    it('reads back what was put, per store, until it is deleted', async () => {
        await idbPut(HANDLERS_STORE, 'chat', { url: '/chat' });
        await idbPut(CLICKS_STORE, 'chat', { at: 1 });
        expect(await idbGet(HANDLERS_STORE, 'chat')).toEqual({ url: '/chat' });
        expect(await idbGet(CLICKS_STORE, 'chat')).toEqual({ at: 1 });
        expect(await idbGet(HANDLERS_STORE, 'missing')).toBeUndefined();

        await idbDelete(HANDLERS_STORE, 'chat');
        expect(await idbGet(HANDLERS_STORE, 'chat')).toBeUndefined();
        expect(await idbGet(CLICKS_STORE, 'chat')).toEqual({ at: 1 });
    });

    it('opens the database the push worker shares, and closes it after each operation', async () => {
        await idbPut(HANDLERS_STORE, 'chat', true);
        await idbGet(HANDLERS_STORE, 'chat');
        expect(idb.opened).toEqual([[PUSH_DB_NAME, 1], [PUSH_DB_NAME, 1]]);
        expect(Object.keys(idb.stores)).toEqual([HANDLERS_STORE, CLICKS_STORE]);
        expect(idb.openConnections).toBe(0);
    });

    it('uses the database it is handed instead of the page\'s own', async () => {
        const other = fakeIndexedDB();
        await idbPut(HANDLERS_STORE, 'chat', true, other);
        expect(await idbGet(HANDLERS_STORE, 'chat', other)).toBe(true);
        expect(idb.opened).toEqual([]);
    });

    it('rejects when the database cannot be opened', async () => {
        idb.failing = 'open';
        await expect(idbGet(HANDLERS_STORE, 'chat')).rejects.toThrow('open failed');
    });

    it('rejects when an operation fails, and still closes the database', async () => {
        await idbPut(HANDLERS_STORE, 'chat', true);
        idb.failing = 'put';
        await expect(idbPut(HANDLERS_STORE, 'chat', false)).rejects.toThrow('put failed');
        expect(idb.openConnections).toBe(0);
        idb.failing = null;
        expect(await idbGet(HANDLERS_STORE, 'chat')).toBe(true);
    });
});

describe('push opt-in', () => {
    it('is remembered per user until turned off', async () => {
        expect(await hasOptIn(ALICE)).toBe(false);
        await setOptIn(ALICE, true);
        expect(await hasOptIn(ALICE)).toBe(true);
        expect(await hasOptIn(BOB)).toBe(false);

        await setOptIn(ALICE, false);
        expect(await hasOptIn(ALICE)).toBe(false);
        expect(keysOf(HANDLERS_STORE)).toEqual([]);
    });

    it('forgets every user\'s opt-in, sync state and kept taps, and nothing else', async () => {
        await setOptIn(ALICE, true);
        await setOptIn(BOB, true);
        const kept = ['chat', SERVER_KEY_ENTRY, `${RECEIPT_PREFIX}/app/`, `${TAP_BASE_PREFIX}/app/`];
        const dropped = [`${SYNCED_PREFIX}${ALICE}`, `${SYNCED_PREFIX}${BOB}`, `${SUBSCRIPTION_CHANGED_PREFIX}/app/`];
        for ( const key of [...kept, ...dropped] ) await idbPut(HANDLERS_STORE, key, { key });
        await idbPut(CLICKS_STORE, 'tap-1', { at: Date.now() });

        await forgetPushState();
        expect(keysOf(HANDLERS_STORE)).toEqual(kept);
        expect(keysOf(CLICKS_STORE)).toEqual([]);
        expect(await hasOptIn(ALICE)).toBe(false);
        expect(await hasOptIn(BOB)).toBe(false);
    });
});

describe('kept taps', () => {
    it('hands a tap over once', async () => {
        const tap = { id: 'copy-1', url: '/chat/42', at: Date.now() };
        await idbPut(CLICKS_STORE, 'tap-1', tap);
        expect(await takeClick('tap-1')).toEqual(tap);
        expect(await takeClick('tap-1')).toBeNull();
        expect(keysOf(CLICKS_STORE)).toEqual([]);
    });

    it('takes only the copy it was posted, leaving another copy in place', async () => {
        const tap = { id: 'copy-2', url: '/chat/42', at: Date.now() };
        await idbPut(CLICKS_STORE, 'tap-1', tap);
        expect(await takeClick('tap-1', 'copy-1')).toBeNull();
        expect(keysOf(CLICKS_STORE)).toEqual(['tap-1']);
        expect(await takeClick('tap-1', 'copy-2')).toEqual(tap);
        expect(keysOf(CLICKS_STORE)).toEqual([]);
    });

    it('has nothing to hand over for a tap that was never kept', async () => {
        expect(await takeClick('tap-unknown', 'copy-1')).toBeNull();
    });

    it('drops taps whose page never came for them', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-03-01T12:00:00Z'));
        const now = Date.now();
        await idbPut(CLICKS_STORE, 'expired', { at: now - CLICK_KEEP_MS });
        await idbPut(CLICKS_STORE, 'fresh', { at: now - CLICK_KEEP_MS + 1 });
        await idbPut(CLICKS_STORE, 'undated', { url: '/chat/42' });
        await idbPut(CLICKS_STORE, 'newest', { at: now });

        await forgetOldClicks();
        await settle();
        expect(keysOf(CLICKS_STORE)).toEqual(['fresh', 'newest']);
    });

    it('has nothing to drop from an empty store', async () => {
        await idbPut(CLICKS_STORE, 'tap-1', { at: Date.now() });
        await takeClick('tap-1');
        await forgetOldClicks();
        await settle();
        expect(keysOf(CLICKS_STORE)).toEqual([]);
    });
});
