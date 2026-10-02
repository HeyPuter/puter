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

    it('keeps a godmode session token in memory only', async () => {
        const puter = await bootApp(`${LAUNCH}${GUI_TOKEN}`);
        expect(puter.authToken).toBe(GUI_TOKEN);
        expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
        expect(localStorage.getItem(ORIGIN_KEY)).toBeNull();
    });

    it('purges a stored session token without adopting it', async () => {
        localStorage.setItem(STORAGE_KEY, GUI_TOKEN);
        localStorage.setItem(ORIGIN_KEY, 'https://api.puter.com');

        const puter = await bootApp('?puter.app_instance_id=i');
        expect(puter.authToken).toBeNull();
        expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
        expect(localStorage.getItem(ORIGIN_KEY)).toBeNull();
    });

    it('leaves a stored app token alone on a godmode launch', async () => {
        localStorage.setItem(STORAGE_KEY, APP_TOKEN);
        localStorage.setItem(ORIGIN_KEY, 'https://api.puter.com');

        const puter = await bootApp(`${LAUNCH}${GUI_TOKEN}`);
        expect(puter.authToken).toBe(GUI_TOKEN);
        expect(localStorage.getItem(STORAGE_KEY)).toBe(APP_TOKEN);
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

    it('does not touch a query token it never consumed', async () => {
        const puter = await bootWeb('?auth_token=sites-own-param');
        expect(puter.env).toBe('web');
        await afterLoad();
        expect(location.search).toBe('?auth_token=sites-own-param');
    });
});
