// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('socket.io-client', () => ({
    io: () => ({
        on: vi.fn(),
        off: vi.fn(),
        emit: vi.fn(),
        disconnect: vi.fn(),
        active: true,
    }),
}));
vi.mock('./lib/polyfills/localStorage.js', () => ({ default: {} }));
vi.mock('./lib/polyfills/xhrshim.js', () => ({ default: class {} }));

const origDefine = customElements.define.bind(customElements);
customElements.define = (name, cls) =>
    customElements.get(name) || origDefine(name, cls);

const TOKEN = 'gui-session-token';
const USER = { uuid: 'u-1', username: 'alice', email_confirmed: true };

/** Origin and path of every request the SDK sent, in order. */
const sent = [];

class CountingXHR {
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
        const { origin, pathname } = new URL(this.url);
        sent.push({ origin, path: pathname });
        const body = pathname === '/whoami'
            ? USER
            : pathname === '/cache/last-change-timestamp'
                ? { timestamp: 1 }
                : {};
        queueMicrotask(() => {
            this.responseText = JSON.stringify(body);
            this.response = this.responseText;
            this.readyState = 4;
            for (const fn of this.listeners.readystatechange ?? []) fn.call(this);
            for (const fn of this.listeners.load ?? []) fn.call(this, { target: this });
        });
    }
}

const flush = async () => {
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};

const count = (path) => sent.filter((r) => r.path === path).length;

const origXHR = globalThis.XMLHttpRequest;

beforeEach(() => {
    sent.length = 0;
    localStorage.clear();
    globalThis.XMLHttpRequest = CountingXHR;
    globalThis.PUTER_QUIET = true;
    globalThis.puter_gui_enabled = true;
    window.auth_token = TOKEN;
});

afterEach(() => {
    globalThis.XMLHttpRequest = origXHR;
    delete globalThis.PUTER_QUIET;
    delete globalThis.puter_gui_enabled;
    delete window.auth_token;
    vi.restoreAllMocks();
});

/** The desktop's SDK, as loaded with a session token. */
const bootGui = async () => {
    history.replaceState(null, '', '/');
    vi.resetModules();
    const { puter } = await import('./index.js');
    expect(puter.env).toBe('gui');
    await flush();
    sent.length = 0;
    return puter;
};

/** What the desktop does to refresh its user: read it, then hand back the token. */
const refreshUser = async (puter) => {
    const user = await puter.os.user();
    puter.setAuthToken(TOKEN);
    return user;
};

describe('the desktop handing back the token it holds', () => {
    it('reads the user once per refresh and still checks the FS cache', async () => {
        const puter = await bootGui();

        await refreshUser(puter);
        await flush();

        expect(count('/whoami')).toBe(1);
        expect(count('/cache/last-change-timestamp')).toBe(1);
        expect(puter.whoami).toEqual(USER);
        expect(await puter.whoamiCache_).toEqual(USER);
    });

    it('reads the user once for overlapping refreshes', async () => {
        const puter = await bootGui();

        await Promise.all([
            refreshUser(puter),
            refreshUser(puter),
            refreshUser(puter),
        ]);
        await flush();

        expect(count('/whoami')).toBe(1);
        expect(puter.whoami).toEqual(USER);
    });

    it('joins a read of the same token that is still in flight', async () => {
        const puter = await bootGui();

        puter.setAuthToken('other-token');
        puter.setAuthToken('other-token');
        await flush();

        expect(count('/whoami')).toBe(1);
        expect(puter.whoami).toEqual(USER);
    });

    it('reads the user again once the API origin has changed', async () => {
        const puter = await bootGui();
        await refreshUser(puter);
        await flush();
        sent.length = 0;

        puter.setAPIOrigin('https://api.elsewhere.test');
        puter.setAuthToken(TOKEN);
        await flush();

        expect(sent.filter((r) => r.path === '/whoami')).toEqual([
            { origin: 'https://api.elsewhere.test', path: '/whoami' },
        ]);
    });

    it('reads the user when a different token is set', async () => {
        const puter = await bootGui();
        await refreshUser(puter);
        await flush();
        sent.length = 0;

        puter.setAuthToken('next-token');
        await flush();

        expect(count('/whoami')).toBe(1);
    });
});
