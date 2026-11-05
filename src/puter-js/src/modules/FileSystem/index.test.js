import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The module opens a socket in its constructor; only its handshake and
// listeners are looked at here.
const sockets = [];
vi.mock('socket.io-client', () => ({
    io: (origin, options) => {
        const socket = { options, on: vi.fn(), disconnect: vi.fn() };
        sockets.push(socket);
        return socket;
    },
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

const makeModule = (env = 'gui', socketEnabled = true) => {
    const puter = {
        env,
        authToken: 'token',
        APIOrigin: 'https://api.test',
        appID: undefined,
        socketEnabled,
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
        // Each auth change also sends the cache timestamp request, whose idle
        // clock is a timer too, so intervals are counted on their own.
        const started = vi.spyOn(globalThis, 'setInterval');
        const cleared = vi.spyOn(globalThis, 'clearInterval');
        const running = () => started.mock.calls.length - cleared.mock.calls.length;

        try {
            fs.onAuthStateChanged();
            const timer = fs.cacheUpdateTimer;
            fs.onAuthStateChanged();
            fs.onAuthStateChanged();

            expect(running()).toBe(1);
            expect(fs.cacheUpdateTimer).not.toBe(timer);

            fs.stopCacheUpdateTimer();
            expect(running()).toBe(0);
        } finally {
            started.mockRestore();
            cleared.mockRestore();
        }
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

    it('keeps an active socket when credentials and origin have not changed', () => {
        const fs = makeModule('web');
        const previous = fs.socket;
        previous.active = true;
        fs.onAuthStateChanged();
        expect(fs.socket).toBe(previous);
        expect(previous.disconnect).not.toHaveBeenCalled();
    });

    it('replaces an inactive socket even when credentials are unchanged', () => {
        const fs = makeModule('web');
        const previous = fs.socket;
        previous.active = false;
        fs.onAuthStateChanged();
        expect(fs.socket).not.toBe(previous);
        expect(previous.disconnect).toHaveBeenCalledOnce();
    });

    it('closes the socket on sign-out without opening an anonymous replacement', () => {
        const fs = makeModule('web');
        const previous = fs.socket;
        fs.puter.authToken = null;
        fs.onAuthStateChanged();
        expect(previous.disconnect).toHaveBeenCalledOnce();
        expect(fs.socket).toBeNull();
    });

    it('replaces an active socket when the API origin changes', () => {
        const fs = makeModule('web');
        const previous = fs.socket;
        previous.active = true;
        fs.puter.APIOrigin = 'https://new-api.test';
        fs.onAuthStateChanged();
        expect(fs.socket).not.toBe(previous);
        expect(previous.disconnect).toHaveBeenCalledOnce();
    });

    it('never opens a socket when the client opted out', () => {
        const fs = makeModule('web', false);

        expect(fs.socket).toBeUndefined();
        const notify = fs.puter.onAuthStateChanged.mock.calls[0][0];
        notify();
        expect(fs.socket).toBeUndefined();
    });
});

describe('notification receipts', () => {
    it('offers to acknowledge receipts and hands each ask to notifications', () => {
        const fs = makeModule('app');
        const socket = sockets.at(-1);
        expect(socket.options.auth).toEqual({
            auth_token: 'token',
            acks: ['notif.receipt'],
        });

        fs.puter.notifications = { _answerReceipt: vi.fn() };
        const [, onAsk] = socket.on.mock.calls.find(
            ([name]) => name === 'notif.receipt',
        );
        const ack = vi.fn();
        onAsk({ uid: 'n-1' }, ack);

        expect(fs.puter.notifications._answerReceipt).toHaveBeenCalledWith(
            { uid: 'n-1' },
            ack,
        );
    });
});
