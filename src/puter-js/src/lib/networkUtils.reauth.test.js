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
vi.mock('./polyfills/localStorage.js', () => ({ default: {} }));
vi.mock('./polyfills/xhrshim.js', () => ({ default: class {} }));

const STORAGE_KEY = 'puter.auth.token.v2';
const b64url = (value) => Buffer.from(value).toString('base64url');
const jwt = (payload) =>
    `${b64url('{"alg":"HS256"}')}.${b64url(JSON.stringify(payload))}.sig`;
const APP_TOKEN = jwt({
    t: 'au',
    v: '2',
    au: Buffer.alloc(16, 1).toString('base64'),
});

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

let parentPost;
beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    parentPost = vi.fn();
    Object.defineProperty(globalThis, 'parent', {
        value: { postMessage: parentPost },
        configurable: true,
    });
    Object.defineProperty(document, 'readyState', {
        value: 'loading',
        configurable: true,
    });
    globalThis.XMLHttpRequest = StubXHR;
});
afterEach(() => {
    vi.useRealTimers();
    if (origParent) Object.defineProperty(globalThis, 'parent', origParent);
    delete document.readyState;
    globalThis.XMLHttpRequest = origXHR;
    vi.restoreAllMocks();
});

describe('reauth_required in a non-godmode app', () => {
    it('rejects promptly without asking the desktop to renew a regular app token', async () => {
        history.replaceState(
            null,
            '',
            `/app/index.html?puter.app_instance_id=i&puter.auth.token=${APP_TOKEN}`,
        );
        vi.resetModules();
        const { puter } = await import('../index.js');
        const { resolveReauth } = await import('./networkUtils.js');
        expect(puter.env).toBe('app');
        expect(puter.authToken).toBe(APP_TOKEN);
        parentPost.mockClear();

        vi.useFakeTimers();
        let settled;
        const pending = resolveReauth(
            { code: 'reauth_required', reason: 'session_revoked' },
            { interactive: true, sentToken: APP_TOKEN },
        ).then((v) => {
            settled = v;
        });

        await pending;
        expect(parentPost).not.toHaveBeenCalled();
        expect(puter.authToken).toBe(APP_TOKEN);
        expect(settled).toMatchObject({
            action: 'reject',
            error: { code: 'reauth_required' },
        });
    });
});

describe('token_auth_failed for a request sent before a sign-in finished (web)', () => {
    it('replays with the fresh token without opening another sign-in', async () => {
        vi.resetModules();
        const { resolveReauth } = await import('./networkUtils.js');
        globalThis.puter = {
            env: 'web',
            // Another call's sign-in already installed this one.
            authToken: 'fresh',
            resetAuthToken: vi.fn(() => {
                globalThis.puter.authToken = null;
            }),
            ui: {
                authenticateWithPuter: vi.fn(async () => {
                    globalThis.puter.authToken = 'second';
                }),
            },
        };
        const verdict = await resolveReauth(
            { code: 'token_auth_failed' },
            { interactive: true, sentToken: 'stale' },
        );
        expect(verdict).toEqual({ action: 'replay' });
        expect(globalThis.puter.resetAuthToken).not.toHaveBeenCalled();
        expect(
            globalThis.puter.ui.authenticateWithPuter,
        ).not.toHaveBeenCalled();
        delete globalThis.puter;
    });
});
