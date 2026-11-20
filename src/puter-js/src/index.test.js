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
// Node/worker polyfills; their CommonJS export branch trips the test module
// runner, and jsdom provides the real thing.
vi.mock('./lib/polyfills/localStorage.js', () => ({ default: {} }));
vi.mock('./lib/polyfills/xhrshim.js', () => ({ default: class {} }));

const LAUNCH = '?puter.app_instance_id=i&puter.auth.token=';
const STORAGE_KEY = 'puter.auth.token.v2';
const ORIGIN_KEY = 'puter.auth.token.origin.v2';

const b64url = (value) => Buffer.from(value).toString('base64url');
const jwt = (payload) =>
    `${b64url('{"alg":"HS256"}')}.${b64url(JSON.stringify(payload))}.sig`;

// Shapes match the compressed claims the backend signs.
const GUI_TOKEN = jwt({ t: 'gui', v: '2', uu: 'AAAAAAAAAAAAAAAAAAAAAA==' });
const APP_TOKEN = jwt({
    t: 'au',
    v: '2',
    au: Buffer.alloc(16, 1).toString('base64'),
});
const GODMODE_TOKEN = jwt({
    t: 't',
    v: '2',
    token_uid: 'tok',
    full_access: true,
    godmode_app_uid: 'app-1',
});

// Every test boots a fresh SDK, and a custom element can't be defined twice.
const origDefine = customElements.define.bind(customElements);
customElements.define = (name, cls) =>
    customElements.get(name) || origDefine(name, cls);

const origParent = Object.getOwnPropertyDescriptor(globalThis, 'parent');
const origFetch = globalThis.fetch;
const origXHR = globalThis.XMLHttpRequest;

// Boot requests are fired but never answered.
class StubXHR {
    open() {}
    setRequestHeader() {}
    addEventListener() {}
    send() {}
}

/** Boots a fresh SDK as an app framed at `search`. */
const bootApp = async (search) => {
    history.replaceState(null, '', `/app/index.html${search}`);
    vi.resetModules();
    const { puter } = await import('./index.js');
    return puter;
};

/** Constructs an SDK as a top-level third-party page at `search`. */
const bootWeb = async (search) => {
    history.replaceState(null, '', `/site/index.html${search}`);
    vi.resetModules();
    // The module's own instance boots as Node here and goes unused.
    const { Puter } = await import('./index.js');
    Object.defineProperty(globalThis, 'parent', {
        value: globalThis,
        configurable: true,
    });
    // The SDK reads a global `process` as "running under Node".
    vi.stubGlobal('process', undefined);
    try {
        return new Puter();
    } finally {
        vi.unstubAllGlobals();
    }
};

/** Lets the deferred address-bar cleanup run. */
const afterLoad = async () => {
    window.dispatchEvent(new Event('load'));
    await new Promise((resolve) => setTimeout(resolve, 0));
};

beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    Object.defineProperty(globalThis, 'parent', {
        value: { postMessage: vi.fn() },
        configurable: true,
    });
    Object.defineProperty(document, 'readyState', {
        value: 'loading',
        configurable: true,
    });
    globalThis.fetch = vi.fn(() => new Promise(() => {}));
    globalThis.XMLHttpRequest = StubXHR;
});

afterEach(() => {
    if ( origParent ) Object.defineProperty(globalThis, 'parent', origParent);
    delete document.readyState;
    globalThis.fetch = origFetch;
    globalThis.XMLHttpRequest = origXHR;
});

describe('app-mode launch token', () => {
    it('keeps the token in the URL until load, then strips only it', async () => {
        const puter = await bootApp(
            `${LAUNCH}${APP_TOKEN}&puter.item.name=a%20b#frag`,
        );
        expect(puter.env).toBe('app');
        expect(puter.authToken).toBe(APP_TOKEN);

        // Still readable to the app's own boot code.
        const params = new URLSearchParams(location.search);
        expect(params.get('puter.auth.token')).toBe(APP_TOKEN);

        await afterLoad();
        expect(location.search).toBe(
            '?puter.app_instance_id=i&puter.item.name=a%20b',
        );
        expect(location.hash).toBe('#frag');
        expect(puter.authToken).toBe(APP_TOKEN);
    });

    it('still persists an app token, so a reload keeps working', async () => {
        await bootApp(`${LAUNCH}${APP_TOKEN}`);
        expect(localStorage.getItem(STORAGE_KEY)).toBe(APP_TOKEN);

        await afterLoad();
        const reloaded = await bootApp(location.search);
        expect(reloaded.authToken).toBe(APP_TOKEN);
    });

    it('keeps a godmode session token out of localStorage', async () => {
        const puter = await bootApp(`${LAUNCH}${GUI_TOKEN}`);
        expect(puter.authToken).toBe(GUI_TOKEN);
        expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
        expect(localStorage.getItem(ORIGIN_KEY)).toBeNull();
        expect(sessionStorage.getItem(STORAGE_KEY)).toBe(GUI_TOKEN);
    });

    it('keeps a godmode app signed in across a frame reload', async () => {
        await bootApp(`${LAUNCH}${GUI_TOKEN}`);
        await afterLoad();
        expect(location.search).not.toContain('puter.auth.token');

        const reloaded = await bootApp(location.search);
        expect(reloaded.authToken).toBe(GUI_TOKEN);
        expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it('drops the sessionStorage copy when an app token takes over', async () => {
        const puter = await bootApp(`${LAUNCH}${GUI_TOKEN}`);
        puter.setAuthToken(APP_TOKEN);
        expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
        expect(localStorage.getItem(STORAGE_KEY)).toBe(APP_TOKEN);
    });

    it('drops the sessionStorage copy on sign-out', async () => {
        const puter = await bootApp(`${LAUNCH}${GUI_TOKEN}`);
        puter.resetAuthToken();
        expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it('does not replay a stored godmode token to another API origin', async () => {
        sessionStorage.setItem(STORAGE_KEY, GUI_TOKEN);
        sessionStorage.setItem(ORIGIN_KEY, 'https://api.puter.com');

        const puter = await bootApp(
            '?puter.app_instance_id=i&puter.api_origin=https://api.evil.example',
        );
        expect(puter.authToken).not.toBe(GUI_TOKEN);
    });

    it('purges a stored session token without adopting it', async () => {
        localStorage.setItem(STORAGE_KEY, GUI_TOKEN);
        localStorage.setItem(ORIGIN_KEY, 'https://api.puter.com');

        const puter = await bootApp('?puter.app_instance_id=i');
        expect(puter.authToken).toBeNull();
        expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
        expect(localStorage.getItem(ORIGIN_KEY)).toBeNull();
    });

    it('keeps a godmode launch token in sessionStorage only', async () => {
        const puter = await bootApp(`${LAUNCH}${GODMODE_TOKEN}`);
        expect(puter.authToken).toBe(GODMODE_TOKEN);
        expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
        expect(sessionStorage.getItem(STORAGE_KEY)).toBe(GODMODE_TOKEN);

        await afterLoad();
        const reloaded = await bootApp(location.search);
        expect(reloaded.authToken).toBe(GODMODE_TOKEN);
    });

    it('takes a renewed token only from the embedding desktop', async () => {
        const puter = await bootApp(`${LAUNCH}${GODMODE_TOKEN}`);
        const renewed = jwt({
            t: 't',
            token_uid: 'tok2',
            full_access: true,
            godmode_app_uid: 'app-1',
        });

        window.dispatchEvent(
            new MessageEvent('message', {
                origin: puter.defaultGUIOrigin,
                source: window,
                data: { msg: 'puter.token', token: renewed },
            }),
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(puter.authToken).toBe(GODMODE_TOKEN);

        window.dispatchEvent(
            new MessageEvent('message', {
                origin: puter.defaultGUIOrigin,
                source: globalThis.parent,
                data: { msg: 'puter.token', token: renewed },
            }),
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(puter.authToken).toBe(renewed);
    });

    it('leaves a stored app token alone on a godmode launch', async () => {
        localStorage.setItem(STORAGE_KEY, APP_TOKEN);
        localStorage.setItem(ORIGIN_KEY, 'https://api.puter.com');

        const puter = await bootApp(`${LAUNCH}${GUI_TOKEN}`);
        expect(puter.authToken).toBe(GUI_TOKEN);
        expect(localStorage.getItem(STORAGE_KEY)).toBe(APP_TOKEN);
    });
});

describe('GUI origin of an app', () => {
    const DESKTOP = 'https://desktop.puter.com';
    const launchedBy = (origin) =>
        bootApp(
            `${LAUNCH}${APP_TOKEN}&puter.origin=${encodeURIComponent(origin)}`,
        );

    /** Sends `data` to the app as its parent at `origin` would. */
    const fromParent = async (origin, data) => {
        window.dispatchEvent(
            new MessageEvent('message', {
                origin,
                source: globalThis.parent,
                data,
            }),
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
    };

    const closeAnswers = () =>
        globalThis.parent.postMessage.mock.calls
            .map(([message]) => message)
            .filter((message) => message?.original_msg_id === 'close-1');

    it('is the first-party desktop that launched it', async () => {
        expect((await launchedBy(DESKTOP)).defaultGUIOrigin).toBe(DESKTOP);
        expect((await launchedBy('https://puter.com')).defaultGUIOrigin).toBe(
            'https://puter.com',
        );
    });

    it('stays puter.com for any other launcher', async () => {
        for (const origin of [
            'https://evil.example',
            'https://desktop.puter.com.evil.example',
            'https://x.desktop.puter.com',
            'http://desktop.puter.com',
            'not a url',
        ]) {
            expect((await launchedBy(origin)).defaultGUIOrigin).toBe(
                'https://puter.com',
            );
        }
        expect((await bootApp(`${LAUNCH}${APP_TOKEN}`)).defaultGUIOrigin).toBe(
            'https://puter.com',
        );
    });

    it('yields to an explicit PUTER_ORIGIN', async () => {
        globalThis.PUTER_ORIGIN = 'https://self-hosted.test';
        try {
            expect((await launchedBy(DESKTOP)).defaultGUIOrigin).toBe(
                'https://self-hosted.test',
            );
        } finally {
            delete globalThis.PUTER_ORIGIN;
        }
    });

    it('is not taken from the URL of a top-level page', async () => {
        const puter = await bootWeb(
            `?puter.app_instance_id=i&puter.origin=${encodeURIComponent(DESKTOP)}`,
        );
        expect(puter.env).not.toBe('app');
        expect(puter.defaultGUIOrigin).toBe('https://puter.com');
    });

    it('answers windowWillClose from that desktop and no other', async () => {
        await launchedBy(DESKTOP);
        const willClose = { msg: 'windowWillClose', msg_id: 'close-1' };

        await fromParent('https://evil.example', willClose);
        await fromParent('https://puter.com', willClose);
        expect(closeAnswers()).toEqual([]);

        await fromParent(DESKTOP, willClose);
        expect(closeAnswers()).toEqual([
            expect.objectContaining({ msg: true, original_msg_id: 'close-1' }),
        ]);
    });
});

describe('token adoption on a top-level page', () => {
    it('takes a token from a window it opened, and from nothing else', async () => {
        const puter = await bootWeb('');
        expect(puter.env).toBe('web');
        // Top-level: `parent` is the page itself, so there is no embedder.
        expect(globalThis.parent).toBe(globalThis);

        const stranger = { closed: false };
        expect(puter.tokenSourceAllowed_(stranger)).toBe(false);

        const popup = { closed: false };
        puter.trackOpenedWindow_(popup);
        expect(puter.tokenSourceAllowed_(popup)).toBe(true);

        // Still ours once closed: it may post, then close itself.
        popup.closed = true;
        expect(puter.tokenSourceAllowed_(popup)).toBe(true);
    });
});

describe('web-mode stored token', () => {
    it('purges a stored session token on a third-party page', async () => {
        localStorage.setItem(STORAGE_KEY, GUI_TOKEN);
        localStorage.setItem(ORIGIN_KEY, 'https://api.puter.com');

        const puter = await bootWeb('');
        expect(puter.env).toBe('web');
        expect(puter.authToken).toBeNull();
        expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it('persists a session token nowhere on a third-party page', async () => {
        const puter = await bootWeb('');
        puter.setAuthToken(GUI_TOKEN);
        expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
        expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it('does not touch a query token it never consumed', async () => {
        const puter = await bootWeb('?auth_token=sites-own-param');
        expect(puter.env).toBe('web');
        await afterLoad();
        expect(location.search).toBe('?auth_token=sites-own-param');
    });
});

describe('godmode app in a tab the GUI opened', () => {
    const TAB = '?puter.app_instance_id=i';

    /** Boots a top-level tab whose GUI opener hands it `token`. */
    const bootTab = async (token) => {
        const opener = {
            closed: false,
            postMessage: (data, guiOrigin) =>
                window.dispatchEvent(
                    new MessageEvent('message', {
                        origin: guiOrigin,
                        source: opener,
                        data: {
                            msg: 'puter.launch',
                            appInstanceID: data.appInstanceID,
                            token,
                        },
                    }),
                ),
        };
        Object.defineProperty(globalThis, 'opener', {
            value: opener,
            configurable: true,
            writable: true,
        });
        const puter = await bootWeb(TAB);
        await puter.openerLaunch_;
        return puter;
    };

    afterEach(() => {
        globalThis.opener = null;
    });

    it('keeps the handed-over token in sessionStorage, so a reload has it', async () => {
        const puter = await bootTab(GODMODE_TOKEN);
        expect(puter.env).toBe('web');
        expect(puter.authToken).toBe(GODMODE_TOKEN);
        expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
        expect(sessionStorage.getItem(STORAGE_KEY)).toBe(GODMODE_TOKEN);

        // The opener was cut off, so the reload has only what it stored.
        expect(globalThis.opener).toBeNull();
        const reloaded = await bootWeb(TAB);
        expect(reloaded.authToken).toBe(GODMODE_TOKEN);
        expect(sessionStorage.getItem(STORAGE_KEY)).toBe(GODMODE_TOKEN);
    });

    it('reloads on the godmode token over an app token stored earlier', async () => {
        localStorage.setItem(STORAGE_KEY, APP_TOKEN);
        localStorage.setItem(ORIGIN_KEY, 'https://api.puter.com');
        await bootTab(GODMODE_TOKEN);

        const reloaded = await bootWeb(TAB);
        expect(reloaded.authToken).toBe(GODMODE_TOKEN);
    });

    it('drops the sessionStorage copy on sign-out', async () => {
        const puter = await bootTab(GODMODE_TOKEN);
        puter.resetAuthToken();
        expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it('still keeps an app token in localStorage only', async () => {
        await bootTab(APP_TOKEN);
        expect(localStorage.getItem(STORAGE_KEY)).toBe(APP_TOKEN);
        expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
    });
});

describe('GUI cache refresh', () => {
    it('keeps one refresh loop however often the token is set', async () => {
        const puter = await bootApp(`${LAUNCH}${APP_TOKEN}`);
        puter.env = 'gui';
        const refresh = vi
            .spyOn(puter, 'checkAndUpdateGUIFScache')
            .mockImplementation(() => {});
        vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
        try {
            puter.setAuthToken(APP_TOKEN);
            puter.setAuthToken(APP_TOKEN);
            puter.setAuthToken(APP_TOKEN);
            vi.advanceTimersByTime(10_000);
            expect(refresh).toHaveBeenCalledOnce();
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('GUI message listener', () => {
    /** Boots an app and returns the window listener it adds last. */
    const bootWithListener = async () => {
        const add = vi.spyOn(window, 'addEventListener');
        try {
            const puter = await bootApp(`${LAUNCH}${APP_TOKEN}`);
            const [, handler] = add.mock.calls
                .filter(([type]) => type === 'message')
                .at(-1);
            return { puter, handler };
        } finally {
            add.mockRestore();
        }
    };

    it('ignores a GUI message with no data', async () => {
        const { puter, handler } = await bootWithListener();
        await expect(
            handler({ origin: puter.defaultGUIOrigin, data: null }),
        ).resolves.toBeUndefined();
    });

    it('ignores a late failure message without touching a pending sign-in', async () => {
        const { puter, handler } = await bootWithListener();
        const previous = puter.authToken;
        const waiter = { resolve: vi.fn(), reject: vi.fn() };
        puter.puterAuthState.isPromptOpen = true;
        puter.puterAuthState.resolvers.push(waiter);
        await handler({
            origin: puter.defaultGUIOrigin,
            source: globalThis.parent,
            data: {
                msg: 'puter.token',
                success: false,
                token: 'invalid',
                error: 'auth_canceled',
            },
        });
        expect(puter.authToken).toBe(previous);
        expect(waiter.reject).not.toHaveBeenCalled();
        expect(waiter.resolve).not.toHaveBeenCalled();
        expect(puter.puterAuthState.resolvers).toEqual([waiter]);
        expect(puter.puterAuthState.isPromptOpen).toBe(true);
    });

    it('reports a failed user lookup after sign-in', async () => {
        const { puter, handler } = await bootWithListener();
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const unhandled = vi.fn();
        process.on('unhandledRejection', unhandled);
        try {
            puter.onAuth = vi.fn();
            puter.getUser = vi.fn(async () => {
                throw new Error('offline');
            });
            await handler({
                origin: puter.defaultGUIOrigin,
                source: globalThis.parent,
                data: { msg: 'puter.token', token: APP_TOKEN },
            });
            await new Promise((resolve) => setTimeout(resolve, 0));
            expect(unhandled).not.toHaveBeenCalled();
            expect(puter.onAuth).not.toHaveBeenCalled();
            expect(error).toHaveBeenCalled();
        } finally {
            process.off('unhandledRejection', unhandled);
            error.mockRestore();
        }
    });
});

describe('app-open reporting', () => {
    /** URLs opened through XHR, the transport `fetchUrl` uses. */
    let opened;
    beforeEach(() => {
        opened = [];
        globalThis.XMLHttpRequest = class extends StubXHR {
            open(_method, url) {
                opened.push(String(url));
            }
        };
    });

    /** Starts the report (never answered) and waits for its request. */
    const raoRequested = async (puter) => {
        void puter.request_rao_();
        for (let i = 0; i < 50; i++) {
            if (opened.some((url) => url.endsWith('/rao'))) return true;
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
        return false;
    };

    it('reports an open from a page', async () => {
        const puter = await bootWeb('');
        expect(await raoRequested(puter)).toBe(true);
    });

    it('reports nothing from a client a worker runtime built', async () => {
        globalThis.puter_report_app_open = false;
        try {
            const puter = await bootWeb('');
            expect(puter.reportsAppOpen).toBe(false);
            expect(await raoRequested(puter)).toBe(false);
        } finally {
            delete globalThis.puter_report_app_open;
        }
    });
});
