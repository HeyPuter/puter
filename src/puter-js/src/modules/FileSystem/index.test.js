import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The module opens a socket in its constructor; nothing here exercises it.
vi.mock('../../lib/socket.io/socket.io.esm.min.js', () => ({
    default: () => ({ on: vi.fn(), disconnect: vi.fn() }),
}));

const { PuterJSFileSystemModule } = await import('./index.js');

// The cache timestamp request is fired but never answered, so the module's
// timer behavior is observed on its own.
class StubXHR {
    open () {}
    setRequestHeader () {}
    addEventListener () {}
    send () {}
}

const makeLocalStorage = () => {
    const store = new Map();
    return {
        getItem: key => store.get(key) ?? null,
        setItem: (key, value) => store.set(key, String(value)),
        removeItem: key => store.delete(key),
    };
};

const origXHR = globalThis.XMLHttpRequest;
const origPuter = globalThis.puter;
const origLocalStorage = globalThis.localStorage;

const makeModule = (env = 'gui') => {
    const puter = {
        env,
        authToken: 'token',
        APIOrigin: 'https://api.test',
        appID: undefined,
        onAuthStateChanged: vi.fn(),
        _cache: { flushall: vi.fn(), del: vi.fn(), get: vi.fn(), set: vi.fn() },
    };
    globalThis.puter = puter;
    return new PuterJSFileSystemModule(puter);
};

beforeEach(() => {
    vi.useFakeTimers();
    globalThis.XMLHttpRequest = StubXHR;
    globalThis.localStorage = makeLocalStorage();
});

afterEach(() => {
    vi.useRealTimers();
    globalThis.XMLHttpRequest = origXHR;
    globalThis.puter = origPuter;
    globalThis.localStorage = origLocalStorage;
});

describe('cache update timer', () => {
    it('keeps a single interval across repeated auth-state changes', () => {
        const fs = makeModule();
        // `vi.getTimerCount()` is global and constructing the module schedules
        // a timer of its own, so the cache interval is counted as a delta from
        // construction rather than as an absolute.
        const baseline = vi.getTimerCount();

        fs.onAuthStateChanged();
        const timer = fs.cacheUpdateTimer;
        fs.onAuthStateChanged();
        fs.onAuthStateChanged();

        expect(vi.getTimerCount()).toBe(baseline + 1);
        expect(fs.cacheUpdateTimer).not.toBe(timer);

        fs.stopCacheUpdateTimer();
        expect(vi.getTimerCount()).toBe(baseline);
    });

    it('refreshes the cache timestamp while running', () => {
        const fs = makeModule();

        fs.startCacheUpdateTimer();
        vi.advanceTimersByTime(1000);

        expect(Number(globalThis.localStorage.getItem('last_valid_ts'))).toBeGreaterThan(0);
    });

    it('stops writing once the timer is stopped', () => {
        const fs = makeModule();

        fs.startCacheUpdateTimer();
        fs.stopCacheUpdateTimer();
        vi.advanceTimersByTime(5000);

        expect(fs.cacheUpdateTimer).toBeNull();
        expect(globalThis.localStorage.getItem('last_valid_ts')).toBeNull();
    });

    it('does not run outside the desktop environment', () => {
        const fs = makeModule('web');
        const baseline = vi.getTimerCount();

        fs.onAuthStateChanged();
        fs.startCacheUpdateTimer();

        // No cache interval on top of what construction already scheduled.
        expect(vi.getTimerCount()).toBe(baseline);
        expect(fs.cacheUpdateTimer).toBeNull();
    });
});

describe('auth state', () => {
    it('reads the token and API origin live from the Puter instance', () => {
        const fs = makeModule('web');

        fs.puter.authToken = 'rotated-token';
        fs.puter.APIOrigin = 'https://api.rotated';

        expect(fs.authToken).toBe('rotated-token');
        expect(fs.APIOrigin).toBe('https://api.rotated');
    });

    it('subscribes so the socket is rebuilt when auth state changes', () => {
        const fs = makeModule('web');

        expect(fs.puter.onAuthStateChanged).toHaveBeenCalledTimes(1);
        const notify = fs.puter.onAuthStateChanged.mock.calls[0][0];

        const previousSocket = fs.socket;
        notify();
        expect(fs.socket).not.toBe(previousSocket);
    });
});
