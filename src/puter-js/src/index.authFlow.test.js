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

const origDefine = customElements.define.bind(customElements);
customElements.define = (name, cls) =>
    customElements.get(name) || origDefine(name, cls);

const origParent = Object.getOwnPropertyDescriptor(globalThis, 'parent');
const origXHR = globalThis.XMLHttpRequest;
const urls = [];
class CountingXHR {
    _listeners = {};
    status = 200;
    readyState = 0;
    responseType = '';
    upload = { addEventListener() {} };
    open(method, url) {
        this.url = url;
        urls.push(`${method} ${url}`);
    }
    setRequestHeader() {}
    addEventListener(type, fn) {
        (this._listeners[type] ??= []).push(fn);
    }
    getResponseHeader(n) {
        return n.toLowerCase() === 'content-type' ? 'application/json' : null;
    }
    abort() {}
    send() {
        queueMicrotask(() => {
            this.responseText = JSON.stringify({ username: 'u' });
            this.response = this.responseText;
            this.readyState = 4;
            for (const fn of this._listeners.readystatechange ?? [])
                fn.call(this);
            for (const fn of this._listeners.load ?? [])
                fn.call(this, { target: this });
        });
    }
}

beforeEach(() => {
    localStorage.clear();
    urls.length = 0;
    Object.defineProperty(globalThis, 'parent', {
        value: globalThis,
        configurable: true,
    });
    globalThis.XMLHttpRequest = CountingXHR;
});
afterEach(() => {
    if (origParent) Object.defineProperty(globalThis, 'parent', origParent);
    globalThis.XMLHttpRequest = origXHR;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

const flush = async () => {
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};

describe('implicit sign-in on a web page', () => {
    it('runs onAuth twice for one sign-in', async () => {
        history.replaceState(null, '', '/site/index.html');
        vi.resetModules();
        // Hide `process` from the SDK's environment probe only, so the
        // module's own instance boots as a top-level web page.
        const realProcess = globalThis.process;
        Object.defineProperty(globalThis, 'process', {
            configurable: true,
            get() {
                const stack = new Error().stack ?? '';
                return /src\/index\.js:\d+/.test(stack.split('\n')[2] ?? '')
                    ? undefined
                    : realProcess;
            },
        });
        let puter;
        try {
            ({ puter } = await import('./index.js'));
        } finally {
            Object.defineProperty(globalThis, 'process', {
                value: realProcess,
                configurable: true,
                writable: true,
            });
        }
        expect(puter.env).toBe('web');
        expect(puter.authToken).toBeFalsy();

        const popup = { closed: false };
        vi.spyOn(window, 'open').mockReturnValue(popup);
        Object.defineProperty(navigator, 'userActivation', {
            value: { hasBeenActive: true, isActive: true },
            configurable: true,
        });
        vi.spyOn(crypto, 'randomUUID').mockReturnValue('sess-1');

        const onAuth = vi.fn();
        puter.onAuth = onAuth;

        const signedIn = puter.ui.authenticateWithPuter();
        window.dispatchEvent(
            new MessageEvent('message', {
                origin: puter.defaultGUIOrigin,
                source: popup,
                data: {
                    msg: 'puter.token',
                    msg_id: 'sess-1',
                    success: true,
                    token: 'tok',
                },
            }),
        );
        await signedIn;
        await flush();

        expect(puter.authToken).toBe('tok');
        expect(onAuth).toHaveBeenCalledTimes(1);
        const whoami = urls.filter((u) => u.includes('/whoami'));
        expect(whoami.length).toBe(1);
    });
});
