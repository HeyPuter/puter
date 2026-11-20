// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('socket.io-client', () => ({
    io: () => ({
        on: vi.fn(),
        off: vi.fn(),
        emit: vi.fn(),
        disconnect: vi.fn(),
    }),
}));
vi.mock('./lib/polyfills/localStorage.js', () => ({ default: {} }));
vi.mock('./lib/polyfills/xhrshim.js', () => ({ default: class {} }));

const STORAGE_KEY = 'puter.auth.token.v2';
const ORIGIN_KEY = 'puter.auth.token.origin.v2';
const GUI_ORIGIN = 'https://puter.com';
const API_ORIGIN = 'https://api.puter.com';
const LAUNCH = '?puter.app_instance_id=i';

const b64url = (value) => Buffer.from(value).toString('base64url');
const jwt = (payload) =>
    `${b64url('{"alg":"HS256"}')}.${b64url(JSON.stringify(payload))}.sig`;
const APP_UID = 'app-01010101-0101-0101-0101-010101010101';
const APP_TOKEN = jwt({ t: 'au', v: '2', au: Buffer.alloc(16, 1).toString('base64') });
// A token that names no app.
const PLAIN_TOKEN = jwt({ t: 's', v: '2' });

// Every test boots a fresh SDK, and a custom element name can't be defined
// twice: later boots register their classes under a numbered name.
const origDefine = customElements.define.bind(customElements);
let redefinitions = 0;
customElements.define = (name, cls) =>
    origDefine(customElements.get(name) ? `${name}-${++redefinitions}` : name, cls);
HTMLDialogElement.prototype.showModal ??= function () {
    this.setAttribute('open', '');
};

const origParent = Object.getOwnPropertyDescriptor(globalThis, 'parent');
const origXHR = globalThis.XMLHttpRequest;

/** What `/whoami` answers; null leaves the request unanswered. */
let whoamiUser = null;

class BootXHR {
    listeners = {};
    status = 200;
    readyState = 0;
    responseType = '';
    upload = { addEventListener() {} };
    open(_method, url) {
        this.url = url;
    }
    setRequestHeader() {}
    addEventListener(type, fn) {
        (this.listeners[type] ??= []).push(fn);
    }
    getResponseHeader(name) {
        return name.toLowerCase() === 'content-type' ? 'application/json' : null;
    }
    abort() {}
    send() {
        if (!whoamiUser || !this.url.endsWith('/whoami')) return;
        queueMicrotask(() => {
            this.responseText = JSON.stringify(whoamiUser);
            this.response = this.responseText;
            this.readyState = 4;
            for (const fn of this.listeners.readystatechange ?? []) fn.call(this);
            for (const fn of this.listeners.load ?? []) fn.call(this, { target: this });
        });
    }
}

const flush = async () => {
    for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

/** Runs `boot` with `process` hidden from the SDK's environment probe only. */
const asBrowser = async (boot) => {
    const realProcess = globalThis.process;
    Object.defineProperty(globalThis, 'process', {
        configurable: true,
        get() {
            const caller = (new Error().stack ?? '').split('\n')[2] ?? '';
            return /src\/index\.js:\d+/.test(caller) ? undefined : realProcess;
        },
    });
    try {
        return await boot();
    } finally {
        Object.defineProperty(globalThis, 'process', {
            value: realProcess,
            configurable: true,
            writable: true,
        });
    }
};

/** Boots the SDK's own instance as an app framed at `search`. */
const bootApp = async (search = `${LAUNCH}&puter.auth.token=${APP_TOKEN}`) => {
    history.replaceState(null, '', `/app/index.html${search}`);
    vi.resetModules();
    const { puter } = await import('./index.js');
    expect(puter.env).toBe('app');
    return puter;
};

/** Boots the SDK's own instance as a top-level third-party page at `search`. */
const bootWeb = async (search = '') => {
    history.replaceState(null, '', `/site/index.html${search}`);
    vi.resetModules();
    Object.defineProperty(globalThis, 'parent', { value: globalThis, configurable: true });
    const { puter } = await asBrowser(() => import('./index.js'));
    expect(puter.env).toBe('web');
    return puter;
};

/** Delivers `data` as a window message from `source` at `origin`. */
const deliver = async (origin, source, data) => {
    window.dispatchEvent(new MessageEvent('message', { origin, source, data }));
    await flush();
};

const parentMessages = () => globalThis.parent.postMessage.mock.calls.map(([message]) => message);

beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    whoamiUser = null;
    Object.defineProperty(globalThis, 'parent', {
        value: { postMessage: vi.fn() },
        configurable: true,
    });
    Object.defineProperty(document, 'readyState', { value: 'loading', configurable: true });
    globalThis.XMLHttpRequest = BootXHR;
    globalThis.PUTER_QUIET = true;
});

afterEach(() => {
    if (origParent) Object.defineProperty(globalThis, 'parent', origParent);
    delete document.readyState;
    delete globalThis.PUTER_QUIET;
    globalThis.XMLHttpRequest = origXHR;
    document.body.innerHTML = '';
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('app launch parameters', () => {
    it('reads the app identity, arguments and API domain from the launch URL', async () => {
        const args = encodeURIComponent(JSON.stringify({ file: 'a b.txt' }));
        const puter = await bootApp(
            `${LAUNCH}&puter.args=${args}&puter.app.id=app-123&puter.app.name=my%20editor&puter.domain=self.test`,
        );
        expect(puter.args).toEqual({ file: 'a b.txt' });
        expect(puter.appID).toBe('app-123');
        expect(puter.appName).toBe('my editor');
        expect(puter.appDataPath).toBe('~/AppData/app-123');
        expect(puter.APIOrigin).toBe('https://api.self.test');
    });

    it('connects to the app that launched it and reports ready', async () => {
        const puter = await bootApp(`${LAUNCH}&puter.parent_instance_id=parent-1`);
        expect(puter.parentInstanceID).toBe('parent-1');
        expect(puter.ui.parentApp().targetAppInstanceID).toBe('parent-1');
        expect(parentMessages()).toContainEqual(
            expect.objectContaining({
                targetAppInstanceID: 'parent-1',
                contents: { $: 'ready' },
            }),
        );
    });

    it('falls back to the app id stored on an earlier launch', async () => {
        localStorage.setItem('puter.app.id', 'app-stored');
        const puter = await bootApp(LAUNCH);
        expect(puter.appID).toBe('app-stored');
        expect(puter.appDataPath).toBe('~/AppData/app-stored');
    });

    it('strips the launch token a task later when the page has already loaded', async () => {
        Object.defineProperty(document, 'readyState', { value: 'complete', configurable: true });
        const puter = await bootApp();
        expect(new URLSearchParams(location.search).get('puter.auth.token')).toBe(APP_TOKEN);
        await flush();
        expect(location.search).toBe(LAUNCH);
        expect(puter.authToken).toBe(APP_TOKEN);
    });
});

describe('environment detection', () => {
    afterEach(() => {
        delete globalThis.puter_gui_enabled;
        delete globalThis.when_puter_happens;
        delete window.auth_token;
    });

    const bootGui = async () => {
        globalThis.puter_gui_enabled = true;
        window.auth_token = 'gui-session-token';
        history.replaceState(null, '', '/');
        vi.resetModules();
        const { puter } = await import('./index.js');
        return puter;
    };

    it('runs as the desktop when the page says so, on the page\'s own session', async () => {
        const puter = await bootGui();
        expect(puter.env).toBe('gui');
        expect(puter.authToken).toBe('gui-session-token');
        expect(puter.fs).toBeDefined();
    });

    it('hands itself to the desktop\'s when_puter_happens callbacks', async () => {
        const first = vi.fn(() => {
            throw new Error('callback failed');
        });
        const second = vi.fn();
        globalThis.when_puter_happens = [first, second];
        const puter = await bootGui();
        expect(first).toHaveBeenCalledWith({ puter });
        expect(second).toHaveBeenCalledWith({ puter });

        const only = vi.fn();
        globalThis.when_puter_happens = only;
        puter.runWhenPuterHappensCallbacks();
        expect(only).toHaveBeenCalledWith({ puter });
    });

    it('reports a failing when_puter_happens callback in debug mode', async () => {
        const puter = await bootGui();
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const failure = new Error('callback failed');
        globalThis.when_puter_happens = () => {
            throw failure;
        };
        puter.runWhenPuterHappensCallbacks();
        expect(error).not.toHaveBeenCalled();
        puter.debugMode = true;
        puter.runWhenPuterHappensCallbacks();
        expect(error).toHaveBeenCalledWith('when_puter_happens callback failed', failure);
    });

    it.each([
        ['web-worker', {}],
        ['service-worker', { ServiceWorkerGlobalScope: class {} }],
    ])('runs as a %s inside one, where signing out is refused', async (env, scopes) => {
        history.replaceState(null, '', '/worker.js');
        vi.resetModules();
        const { Puter } = await import('./index.js');
        vi.stubGlobal('WorkerGlobalScope', class {});
        for (const [name, value] of Object.entries(scopes)) vi.stubGlobal(name, value);
        const puter = new Puter();
        expect(puter.env).toBe(env);
        expect(() => puter.resetAuthToken()).toThrow(
            'Sign out is not permitted from WebWorkers or ServiceWorkers',
        );
    });
});

describe('default origins', () => {
    afterEach(() => {
        delete globalThis.PUTER_API_ORIGIN;
        delete globalThis.PUTER_ORIGIN;
    });

    it('can be replaced, and yield to the page-level overrides', async () => {
        const puter = await bootApp();
        puter.defaultAPIOrigin = 'https://api.self.test';
        puter.defaultGUIOrigin = 'https://self.test';
        expect(puter.defaultAPIOrigin).toBe('https://api.self.test');
        expect(puter.defaultGUIOrigin).toBe('https://self.test');

        globalThis.PUTER_API_ORIGIN = 'https://api.override.test';
        globalThis.PUTER_ORIGIN = 'https://override.test';
        expect(puter.defaultAPIOrigin).toBe('https://api.override.test');
        expect(puter.defaultGUIOrigin).toBe('https://override.test');
    });
});

describe('reauth in an app', () => {
    const SIGNAL = { reason: 'session_expired', auth_id: 'auth-1' };
    const reauthRequests = () => parentMessages().filter((message) => message?.msg === 'reauth_required');

    it('asks the desktop for a new token and waits for the desktop to send one', async () => {
        const puter = await bootApp();
        const stateChanges = vi.fn();
        puter.onAuthStateChanged(stateChanges);
        let settled = false;
        const reauth = puter.triggerReauth(SIGNAL).then(() => {
            settled = true;
        });

        expect(puter.authToken).toBeNull();
        expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
        expect(stateChanges).toHaveBeenCalledTimes(1);
        expect(reauthRequests()).toEqual([
            { msg: 'reauth_required', appInstanceID: 'i', ...SIGNAL },
        ]);
        expect(globalThis.parent.postMessage).toHaveBeenLastCalledWith(expect.anything(), GUI_ORIGIN);

        // Only the embedding desktop, at its own origin, can end the wait.
        const token = { msg: 'puter.token', token: APP_TOKEN };
        await deliver('https://evil.example', globalThis.parent, token);
        await deliver(GUI_ORIGIN, { postMessage() {} }, token);
        await deliver(GUI_ORIGIN, globalThis.parent, { msg: 'windowFocused' });
        expect(settled).toBe(false);
        expect(puter.authToken).toBeNull();

        await deliver(GUI_ORIGIN, globalThis.parent, token);
        await reauth;
        expect(puter.authToken).toBe(APP_TOKEN);
    });

    it('shares one request between callers that hit it together', async () => {
        const puter = await bootApp();
        const first = puter.triggerReauth(SIGNAL);
        const second = puter.triggerReauth({ reason: 'other', auth_id: 'auth-2' });
        expect(reauthRequests()).toHaveLength(1);
        await deliver(GUI_ORIGIN, globalThis.parent, { msg: 'puter.token', token: APP_TOKEN });
        await Promise.all([first, second]);

        // A later expiry starts a new request.
        const third = puter.triggerReauth(SIGNAL);
        expect(reauthRequests()).toHaveLength(2);
        await deliver(GUI_ORIGIN, globalThis.parent, { msg: 'puter.token', token: APP_TOKEN });
        await third;
    });

    it('gives up after five minutes without a token', async () => {
        const puter = await bootApp();
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        const reauth = puter.triggerReauth(SIGNAL);
        const outcome = expect(reauth).rejects.toThrow('reauth_timeout');
        await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
        await outcome;
        expect(puter.authToken).toBeNull();
    });

    it('still waits for a token when the desktop cannot be messaged', async () => {
        const puter = await bootApp();
        globalThis.parent.postMessage.mockImplementation(() => {
            throw new DOMException('sandboxed', 'SecurityError');
        });
        const reauth = puter.triggerReauth(SIGNAL);
        await deliver(GUI_ORIGIN, globalThis.parent, { msg: 'puter.token', token: APP_TOKEN });
        await expect(reauth).resolves.toBeUndefined();
    });
});

describe('reauth on a web page', () => {
    it('signs the user in again through the sign-in popup', async () => {
        localStorage.setItem(STORAGE_KEY, APP_TOKEN);
        localStorage.setItem(ORIGIN_KEY, API_ORIGIN);
        const puter = await bootWeb();
        expect(puter.authToken).toBe(APP_TOKEN);

        const popup = { closed: false };
        const open = vi.spyOn(window, 'open').mockReturnValue(popup);
        vi.stubGlobal('navigator', Object.create(navigator, {
            userActivation: { value: { hasBeenActive: true, isActive: true } },
        }));
        vi.spyOn(crypto, 'randomUUID').mockReturnValue('sess-1');

        const reauth = puter.triggerReauth({ reason: 'session_expired', auth_id: 'auth-1' });
        expect(puter.authToken).toBeNull();
        expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
        await flush();
        expect(open).toHaveBeenCalledTimes(1);

        await deliver(GUI_ORIGIN, popup, {
            msg: 'puter.token',
            msg_id: 'sess-1',
            success: true,
            token: PLAIN_TOKEN,
        });
        await reauth;
        expect(puter.authToken).toBe(PLAIN_TOKEN);
    });
});

describe('a stored token bound to another API origin', () => {
    it('is not replayed by an app: the app reauths against the default origin', async () => {
        localStorage.setItem(STORAGE_KEY, APP_TOKEN);
        localStorage.setItem(ORIGIN_KEY, API_ORIGIN);
        const puter = await bootApp(
            `${LAUNCH}&puter.api_origin=${encodeURIComponent('https://api.evil.example')}`,
        );
        expect(puter.authToken).toBeNull();
        expect(puter.APIOrigin).toBe(API_ORIGIN);
        expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
        expect(parentMessages()).toContainEqual({
            msg: 'reauth_required',
            appInstanceID: 'i',
            reason: 'api_origin_mismatch',
            auth_id: undefined,
        });

        // The desktop's answer ends the wait and is bound to the default origin.
        await deliver(GUI_ORIGIN, globalThis.parent, { msg: 'puter.token', token: APP_TOKEN });
        expect(puter.authToken).toBe(APP_TOKEN);
        expect(localStorage.getItem(ORIGIN_KEY)).toBe(API_ORIGIN);
    });

    it('is dropped by a web page', async () => {
        localStorage.setItem(STORAGE_KEY, APP_TOKEN);
        localStorage.setItem(ORIGIN_KEY, 'https://api.evil.example');
        const puter = await bootWeb();
        expect(puter.authToken).toBeFalsy();
        expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
        expect(localStorage.getItem(ORIGIN_KEY)).toBeNull();
    });
});

describe('when storage is unavailable', () => {
    const denied = () => {
        throw new DOMException('The operation is insecure.', 'SecurityError');
    };
    const storageErrors = (error) =>
        error.mock.calls.filter(([message]) => message === 'Error accessing localStorage:');

    it('boots a web page signed out', async () => {
        localStorage.setItem(STORAGE_KEY, APP_TOKEN);
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(denied);
        const puter = await bootWeb();
        expect(puter.authToken).toBeFalsy();
        expect(puter.fs).toBeDefined();
        expect(storageErrors(error)).toHaveLength(1);
    });

    it('boots an app signed out when the app has no launch token', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(denied);
        const puter = await bootApp(LAUNCH);
        expect(puter.authToken).toBeFalsy();
        expect(puter.fs).toBeDefined();
        expect(storageErrors(error)).toHaveLength(1);
    });

    it('keeps the launch token, app id and sign-out working in memory', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(denied);
        vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(denied);
        const puter = await bootApp();
        expect(puter.authToken).toBe(APP_TOKEN);
        expect(puter.appID).toBe(APP_UID);

        puter.setAppID('app-456');
        expect(puter.appID).toBe('app-456');
        expect(puter.appDataPath).toBe('~/AppData/app-456');

        puter.resetAuthToken();
        expect(puter.authToken).toBeNull();
        puter.setAuthToken(null);
        expect(puter.authToken).toBeNull();
        expect(storageErrors(error).length).toBeGreaterThanOrEqual(4);
    });
});

describe('a tab the desktop opened for an app', () => {
    afterEach(() => {
        globalThis.opener = null;
    });

    it('takes the opened item from the desktop tab instead of the URL', async () => {
        const asked = [];
        const opener = {
            closed: false,
            postMessage: (data, guiOrigin) => {
                asked.push([data, guiOrigin]);
                window.dispatchEvent(new MessageEvent('message', {
                    origin: guiOrigin,
                    source: opener,
                    data: {
                        msg: 'puter.launch',
                        appInstanceID: data.appInstanceID,
                        item: { 'puter.item.name': 'notes.txt', 'puter.item.uid': 'f-1', other: 'dropped' },
                    },
                }));
            },
        };
        Object.defineProperty(globalThis, 'opener', { value: opener, configurable: true, writable: true });
        const puter = await bootWeb(LAUNCH);
        await puter.openerLaunch_;

        expect(asked).toEqual([
            [{ msg: 'puter.requestLaunch', env: 'app-tab', appInstanceID: 'i' }, GUI_ORIGIN],
        ]);
        expect(puter.ui.wasLaunchedWithItems()).toBe(true);
        expect(Object.fromEntries(puter.openerLaunchItem_)).toEqual({
            'puter.item.name': 'notes.txt',
            'puter.item.uid': 'f-1',
        });
        expect(puter.authToken).toBeFalsy();
    });
});

describe('logger prefix', () => {
    const logged = async (puter) => {
        await flush();
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        puter.logger.info('hello');
        return log.mock.calls.at(-1);
    };

    it('names the app once the boot user lookup answers', async () => {
        whoamiUser = { username: 'alice', app_name: 'editor' };
        expect(await logged(await bootApp())).toEqual(['[prefix=[editor]]', 'hello']);
    });

    it('falls back to the app instance when the user has no app name', async () => {
        whoamiUser = { username: 'alice' };
        expect(await logged(await bootApp())).toEqual(['[prefix=[i]]', 'hello']);
    });

    it('stays bare while signed out', async () => {
        expect(await logged(await bootApp(LAUNCH))).toEqual(['hello']);
    });
});

describe('auth state listeners', () => {
    it('all hear a change, even after one of them throws', async () => {
        const puter = await bootApp();
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const failure = new Error('listener failed');
        const second = vi.fn();
        puter.onAuthStateChanged(() => {
            throw failure;
        });
        const unsubscribe = puter.onAuthStateChanged(second);

        puter.resetAuthToken();
        expect(second).toHaveBeenCalledTimes(1);
        expect(error).not.toHaveBeenCalledWith('Auth state listener failed', failure);

        puter.debugMode = true;
        puter.resetAuthToken();
        expect(second).toHaveBeenCalledTimes(2);
        expect(error).toHaveBeenCalledWith('Auth state listener failed', failure);

        unsubscribe();
        puter.resetAuthToken();
        expect(second).toHaveBeenCalledTimes(2);
        // This instance outlives the test and still hears window messages.
        puter.debugMode = false;
    });
});

describe('windows the SDK opened', () => {
    it('are trusted to send a token back, the eight most recent only', async () => {
        const puter = await bootWeb();
        const windows = Array.from({ length: 9 }, () => ({ closed: false }));
        puter.trackOpenedWindow_(null);
        for (const win of windows) puter.trackOpenedWindow_(win);
        expect(puter.tokenSourceAllowed_(windows[0])).toBe(false);
        expect(windows.slice(1).map((win) => puter.tokenSourceAllowed_(win))).toEqual(Array(8).fill(true));
        expect(puter.tokenSourceAllowed_(null)).toBe(false);
    });
});

describe('network monitoring', () => {
    const goOnline = (online) => vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(online);

    it('purges the cache when the connection drops, not while it stays up', async () => {
        const puter = await bootApp();
        vi.spyOn(console, 'log').mockImplementation(() => {});
        puter._cache.set('item:/alice/a.txt', { name: 'a.txt' });

        window.dispatchEvent(new Event('online'));
        expect(puter._cache.get('item:/alice/a.txt')).toEqual({ name: 'a.txt' });

        goOnline(false);
        window.dispatchEvent(new Event('offline'));
        expect(puter._cache.get('item:/alice/a.txt')).toBeUndefined();

        // Already offline: coming back and dropping again is what purges next.
        puter._cache.set('item:/alice/b.txt', { name: 'b.txt' });
        window.dispatchEvent(new Event('offline'));
        expect(puter._cache.get('item:/alice/b.txt')).toEqual({ name: 'b.txt' });
    });

    it('rechecks the connection shortly after the tab changes visibility', async () => {
        const puter = await bootApp();
        vi.spyOn(console, 'log').mockImplementation(() => {});
        puter._cache.set('item:/alice/a.txt', { name: 'a.txt' });
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        goOnline(false);
        document.dispatchEvent(new Event('visibilitychange'));
        expect(puter._cache.get('item:/alice/a.txt')).toEqual({ name: 'a.txt' });
        vi.advanceTimersByTime(100);
        expect(puter._cache.get('item:/alice/a.txt')).toBeUndefined();
    });

    it('reports a cache that cannot be purged', async () => {
        const puter = await bootApp();
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const failure = new Error('cache is gone');
        puter._cache = { flushall: () => {
            throw failure;
        } };
        goOnline(false);
        window.dispatchEvent(new Event('offline'));
        expect(error).toHaveBeenCalledWith('Error purging cache:', failure);
    });
});

describe('a page with no origin to sign in with', () => {
    const notices = () => [...document.body.children].filter((el) => el.localName.startsWith('puter-dialog'));

    // A notice keeps listening for a token after it leaves the page.
    afterEach(() => {
        for (const notice of notices()) window.removeEventListener('message', notice.messageListener);
    });

    /** Boots a web page whose address and origin are `href` and `origin`. */
    const bootAt = async (href, origin) => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.resetModules();
        Object.defineProperty(globalThis, 'parent', { value: globalThis, configurable: true });
        const { Puter } = await import('./index.js');
        vi.stubGlobal('location', new URL(href));
        vi.stubGlobal('origin', origin);
        const puter = await asBrowser(() => new Puter());
        expect(puter.env).toBe('web');
        return { puter, warn };
    };
    const originWarnings = (warn) =>
        warn.mock.calls.filter(([message]) => message.includes('no origin to sign in with'));

    it('warns once and shows a notice when opened from a file', async () => {
        const { puter, warn } = await bootAt('file:///Users/alice/app/index.html', 'null');
        expect(originWarnings(warn)).toHaveLength(1);
        // Shown once the body exists.
        expect(notices()).toEqual([]);
        document.dispatchEvent(new Event('DOMContentLoaded'));
        expect(notices()).toHaveLength(1);
        expect(notices()[0].shadowRoot.querySelector('dialog').hasAttribute('open')).toBe(true);

        puter.warnUnsupportedOrigin();
        expect(originWarnings(warn)).toHaveLength(1);
        expect(notices()).toHaveLength(1);
    });

    it('shows the notice at once when the page has already loaded', async () => {
        Object.defineProperty(document, 'readyState', { value: 'interactive', configurable: true });
        await bootAt('file:///Users/alice/app/index.html', 'null');
        expect(notices()).toHaveLength(1);
    });

    it('only warns inside a sandboxed frame', async () => {
        const { warn } = await bootAt('https://embed.example/widget.html', 'null');
        expect(originWarnings(warn)).toHaveLength(1);
        document.dispatchEvent(new Event('DOMContentLoaded'));
        expect(notices()).toEqual([]);
    });

    it('says nothing on a page with an origin', async () => {
        const { warn } = await bootAt('https://site.example/index.html', 'https://site.example');
        expect(originWarnings(warn)).toEqual([]);
    });
});

describe('messages from the desktop', () => {
    it('answers an origin request to whoever asked', async () => {
        await bootApp();
        const source = { postMessage: vi.fn() };
        await deliver('https://evil.example', source, { msg: 'requestOrigin' });
        expect(source.postMessage).not.toHaveBeenCalled();
        await deliver(GUI_ORIGIN, source, { msg: 'requestOrigin' });
        expect(source.postMessage).toHaveBeenCalledWith({ msg: 'originResponse' }, '*');
    });

    it('takes the app id sent with a token that names no app', async () => {
        const puter = await bootApp(LAUNCH);
        await deliver(GUI_ORIGIN, globalThis.parent, { msg: 'puter.token', token: PLAIN_TOKEN, app_uid: ' app-789 ' });
        expect(puter.authToken).toBe(PLAIN_TOKEN);
        expect(puter.appID).toBe('app-789');
        expect(localStorage.getItem('puter.app.id')).toBe('app-789');
    });

    it('keeps the app id the token names over the one sent with the token', async () => {
        const puter = await bootApp(LAUNCH);
        await deliver(GUI_ORIGIN, globalThis.parent, { msg: 'puter.token', token: APP_TOKEN, app_uid: 'app-789' });
        expect(puter.appID).toBe(APP_UID);
    });

    it('releases every caller waiting on the sign-in prompt', async () => {
        const puter = await bootApp(LAUNCH);
        const waiters = [
            { resolve: vi.fn(), reject: vi.fn() },
            { resolve: vi.fn(), reject: vi.fn() },
        ];
        puter.puterAuthState.isPromptOpen = true;
        puter.puterAuthState.resolvers.push(...waiters);
        await deliver(GUI_ORIGIN, globalThis.parent, { msg: 'puter.token', token: APP_TOKEN });
        for (const waiter of waiters) {
            expect(waiter.resolve).toHaveBeenCalledTimes(1);
            expect(waiter.reject).not.toHaveBeenCalled();
        }
        expect(puter.puterAuthState).toMatchObject({ isPromptOpen: false, authGranted: true, resolvers: [] });
    });
});

describe('reading the app id out of a token', () => {
    it('works with either base64 decoder, and gives up with neither', async () => {
        const puter = await bootApp(LAUNCH);
        expect(puter.getAppIDFromAuthToken(APP_TOKEN)).toBe(APP_UID);

        vi.stubGlobal('atob', undefined);
        expect(puter.getAppIDFromAuthToken(APP_TOKEN)).toBe(APP_UID);
        vi.unstubAllGlobals();

        const realBuffer = globalThis.Buffer;
        const without = (run) => {
            globalThis.Buffer = undefined;
            try {
                return run();
            } finally {
                globalThis.Buffer = realBuffer;
            }
        };
        expect(without(() => puter.getAppIDFromAuthToken(APP_TOKEN))).toBe(APP_UID);
        // Not base64 at all.
        expect(without(() => puter.decodeCompressedAppID('!!!!'))).toBeNull();

        const realAtob = globalThis.atob;
        const withNeither = (run) => without(() => {
            globalThis.atob = undefined;
            try {
                return run();
            } finally {
                globalThis.atob = realAtob;
            }
        });
        expect(withNeither(() => puter.getAppIDFromAuthToken(APP_TOKEN))).toBeNull();
        expect(withNeither(() => puter.decodeCompressedAppID('AQEBAQEBAQEBAQEBAQEBAQ=='))).toBeNull();
    });
});
