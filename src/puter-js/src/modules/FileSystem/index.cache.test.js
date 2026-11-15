import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';

const sockets = [];
vi.mock('socket.io-client', () => ({
    io: () => {
        const socket = { id: 'socket-1', on: vi.fn(), disconnect: vi.fn() };
        sockets.push(socket);
        return socket;
    },
}));

// Load the dual-export XHR adapter natively; Vite treats its CommonJS branch as a module mutation.
const { default: XMLHttpRequestShim } = createRequire(import.meta.url)('../../lib/polyfills/xhrshim.js');
const { PuterJSFileSystemModule } = await import('./index.js');

const LAST_VALID_TS = 'last_valid_ts';

let api;
/** What the API answers the cache timestamp request with, as a raw body. */
let timestampBody;
let sdk;
let fs;

const makeLocalStorage = () => {
    const store = new Map();
    return {
        getItem: key => store.get(key) ?? null,
        setItem: (key, value) => store.set(key, String(value)),
        removeItem: key => store.delete(key),
    };
};

beforeEach(async () => {
    sockets.length = 0;
    timestampBody = '{}';
    api = createServer((req, res) => {
        if ( req.url !== '/cache/last-change-timestamp' ) {
            res.statusCode = 404;
            res.end('{}');
            return;
        }
        res.setHeader('Content-Type', 'application/json');
        res.end(timestampBody);
    });
    await new Promise(resolve => api.listen(0, '127.0.0.1', resolve));

    sdk = {
        env: 'app',
        authToken: 'token',
        APIOrigin: `http://127.0.0.1:${api.address().port}`,
        socketEnabled: true,
        debugMode: false,
        onAuthStateChanged: vi.fn(),
        _cache: { flushall: vi.fn(), del: vi.fn(), get: vi.fn(), set: vi.fn() },
    };
    vi.stubGlobal('puter', sdk);
    vi.stubGlobal('XMLHttpRequest', XMLHttpRequestShim);
    vi.stubGlobal('localStorage', makeLocalStorage());
    fs = new PuterJSFileSystemModule(sdk);
});

afterEach(async () => {
    api.closeAllConnections();
    await new Promise(resolve => api.close(resolve));
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

/** Delivers a socket event to the module, as the server would. */
const emit = (event, ...args) => {
    const [, handler] = sockets.at(-1).on.mock.calls.find(([name]) => name === event);
    return handler(...args);
};

describe('cache check against the server', () => {
    it('purges the cache when the server changed after the cache was last known valid', async () => {
        localStorage.setItem(LAST_VALID_TS, '1000');
        timestampBody = JSON.stringify({ timestamp: 3001 });
        await fs.checkCacheAndPurge();
        expect(sdk._cache.flushall).toHaveBeenCalledTimes(1);
        expect(localStorage.getItem(LAST_VALID_TS)).toBe('0');
    });

    it('keeps the cache when the server has nothing newer', async () => {
        localStorage.setItem(LAST_VALID_TS, '1000');
        timestampBody = JSON.stringify({ timestamp: 3000 });
        await fs.checkCacheAndPurge();
        expect(sdk._cache.flushall).not.toHaveBeenCalled();
        expect(localStorage.getItem(LAST_VALID_TS)).toBe('1000');
    });

    it('purges a cache never marked valid, taking the time as now when the server names none', async () => {
        const before = Date.now();
        expect(await fs.getCacheTimestamp()).toBeGreaterThanOrEqual(before);
        await fs.checkCacheAndPurge();
        expect(sdk._cache.flushall).toHaveBeenCalledTimes(1);
    });

    it('keeps the cache and reports the failure when the answer cannot be read', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        timestampBody = 'not json';
        await fs.checkCacheAndPurge();
        expect(sdk._cache.flushall).not.toHaveBeenCalled();
        expect(error).toHaveBeenCalledWith('Error checking cache timestamp:', new Error('Failed to parse response'));
    });
});

describe('file system socket', () => {
    it('purges the cache when an item is renamed elsewhere', () => {
        emit('item.renamed', { path: '/alice/docs/b.txt' });
        expect(sdk._cache.flushall).toHaveBeenCalledTimes(1);
    });

    const LIFECYCLE = [
        ['connect', [], ['FileSystem Socket: Connected', 'socket-1']],
        ['disconnect', [], ['FileSystem Socket: Disconnected']],
        ['reconnect', [2], ['FileSystem Socket: Reconnected', 'socket-1']],
        ['reconnect_attempt', [2], ['FileSystem Socket: Reconnection Attemps', 2]],
        ['reconnect_error', ['timeout'], ['FileSystem Socket: Reconnection Error', 'timeout']],
        ['reconnect_failed', [], ['FileSystem Socket: Reconnection Failed']],
    ];

    it.each(LIFECYCLE)('logs %s in debug mode only', (event, args, logged) => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        emit(event, ...args);
        expect(log).not.toHaveBeenCalled();
        sdk.debugMode = true;
        emit(event, ...args);
        expect(log.mock.calls).toEqual([logged]);
    });

    it('logs a socket error in debug mode only', () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        emit('error', 'refused');
        expect(error).not.toHaveBeenCalled();
        sdk.debugMode = true;
        emit('error', 'refused');
        expect(error.mock.calls).toEqual([['FileSystem Socket Error:', 'refused']]);
    });
});
