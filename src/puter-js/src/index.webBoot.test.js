// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ioCalls = [];
vi.mock('socket.io-client', () => ({
    io: (origin, opts) => {
        ioCalls.push({ origin, token: opts?.auth?.auth_token ?? null });
        return {
            on: vi.fn(),
            off: vi.fn(),
            emit: vi.fn(),
            disconnect: vi.fn(),
        };
    },
}));
vi.mock('./lib/polyfills/localStorage.js', () => ({ default: {} }));
vi.mock('./lib/polyfills/xhrshim.js', () => ({ default: class {} }));

const STORAGE_KEY = 'puter.auth.token.v2';
const ORIGIN_KEY = 'puter.auth.token.origin.v2';
const b64url = (value) => Buffer.from(value).toString('base64url');
const APP_TOKEN = `${b64url('{"alg":"HS256"}')}.${b64url(JSON.stringify({ t: 'au', v: '2', au: Buffer.alloc(16, 1).toString('base64') }))}.sig`;

const origDefine = customElements.define.bind(customElements);
customElements.define = (name, cls) =>
    customElements.get(name) || origDefine(name, cls);

const origParent = Object.getOwnPropertyDescriptor(globalThis, 'parent');
const origXHR = globalThis.XMLHttpRequest;
class StubXHR {
    open() {}
    setRequestHeader() {}
    addEventListener() {}
    send() {}
}

beforeEach(() => {
    localStorage.clear();
    ioCalls.length = 0;
    Object.defineProperty(globalThis, 'parent', {
        value: globalThis,
        configurable: true,
    });
    globalThis.XMLHttpRequest = StubXHR;
});
afterEach(() => {
    if (origParent) Object.defineProperty(globalThis, 'parent', origParent);
    globalThis.XMLHttpRequest = origXHR;
});

describe('web-env boot with a stored token', () => {
    it('opens only one authenticated socket', async () => {
        localStorage.setItem(STORAGE_KEY, APP_TOKEN);
        localStorage.setItem(ORIGIN_KEY, 'https://api.puter.com');
        history.replaceState(null, '', '/site/index.html');
        vi.resetModules();
        const { Puter } = await import('./index.js');
        ioCalls.length = 0;

        const realProcess = globalThis.process;
        Object.defineProperty(globalThis, 'process', {
            configurable: true,
            get() {
                const caller = (new Error().stack ?? '').split('\n')[2] ?? '';
                return /src\/index\.js:\d+/.test(caller)
                    ? undefined
                    : realProcess;
            },
        });
        let puter;
        try {
            puter = new Puter();
        } finally {
            Object.defineProperty(globalThis, 'process', {
                value: realProcess,
                configurable: true,
                writable: true,
            });
        }

        expect(puter.env).toBe('web');
        expect(puter.authToken).toBe(APP_TOKEN);
        expect(ioCalls).toEqual([
            { origin: 'https://api.puter.com', token: APP_TOKEN },
        ]);
    });
});
