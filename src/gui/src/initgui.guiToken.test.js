// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://puter.test/"}
/*
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

// A signed-in dashboard boot with the real SDK (env `gui`), globals.js,
// helpers.js and initgui.js; fetch, XHR and sockets are answered locally and
// every request is recorded in order.
import { Blob as NodeBlob } from 'node:buffer';
import { webcrypto } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import jQuery from './lib/jquery-3.6.1/jquery-3.6.1.min.js';
import { tokenClaimsDigest } from './helpers/guiToken.js';

// Each boot loads the SDK and the GUI's modules afresh.
vi.setConfig({ testTimeout: 30_000 });

const { sockets, dashboard } = vi.hoisted(() => ({ sockets: [], dashboard: { calls: [] } }));

vi.mock('socket.io-client', () => ({
    io: (origin, opts) => {
        const s = {
            origin,
            token: opts?.auth?.auth_token,
            active: true,
            on () {},
            off () {},
            emit () {},
            disconnect () {
                s.active = false;
            },
        };
        sockets.push(s);
        return s;
    },
}));
vi.mock('../../puter-js/src/lib/polyfills/localStorage.js', () => ({ default: {} }));
vi.mock('../../puter-js/src/lib/polyfills/xhrshim.js', () => ({ default: class {} }));
vi.mock('./UI/Dashboard/UIDashboard.js', () => ({
    default: vi.fn(async () => {
        dashboard.calls.push(dashboard.onRender?.());
        return null;
    }),
}));
vi.mock('./UI/Dashboard/TabApps.js', () => ({ default: {} }));
vi.mock('./UI/UIDesktop.js', () => ({ default: vi.fn(async () => null) }));
vi.mock('./UI/UIAlert.js', () => ({ default: vi.fn(async () => undefined) }));
vi.mock('./UI/UIItem.js', () => ({ default: vi.fn() }));
vi.mock('./UI/UIWindow.js', () => ({ default: vi.fn(async () => null) }));
vi.mock('./UI/UIComponentWindow.js', () => ({ default: class {} }));
vi.mock('./UI/UIWindowProgress.js', () => ({ default: vi.fn() }));
vi.mock('./UI/UIWindowSaveAccount.js', () => ({ default: vi.fn() }));
vi.mock('./UI/Auth/UIAuthLogin.js', () => ({ default: vi.fn(async () => false) }));
vi.mock('./UI/Auth/UIAuthAccountPicker.js', () => ({ default: vi.fn(async () => true) }));
vi.mock('./helpers/updateUsernameInGui.js', () => ({ default: vi.fn() }));

const GUI = 'https://puter.test';
const API = 'https://api.puter.test';
const USER = { uuid: '5d4adce0-a381-4982-9c02-6e2540026238', username: 'alice', email: 'a@x.test', email_confirmed: true, is_temp: false };
const OTHER = 'a1b2c3d4-0000-4000-8000-00000000beef';
const SESSION = '6f1e2d3c-0000-4000-8000-000000000001';

const b64 = (hex) => Buffer.from(hex.replace(/-/g, ''), 'hex').toString('base64');
const b64url = (v) => Buffer.from(v).toString('base64url');
let iat = 1_800_000_000;
/** A GUI token as the server signs it: a fresh `iat`, so a new string per call. */
const guiToken = ({ session = SESSION, user = USER.uuid } = {}) => `${b64url('{"alg":"HS256","typ":"JWT","kid":"v2"}')}.${b64url(JSON.stringify({
    t: 'gui', v: '2', u: b64(session), su: b64(session), uu: b64(user), ai: b64(user), iat: ++iat,
}))}.sig${iat}`;

const STORED = guiToken();
const DESKTOP = '/alice/Desktop';
const LAST_VALID_TS = 'last_valid_ts';

let requests;
let routes;

// Each test loads the page's modules afresh into the same window.
const defineElement = customElements.define.bind(customElements);
customElements.define = (name, ...rest) => {
    if ( ! customElements.get(name) ) defineElement(name, ...rest);
};

const record = (method, url) => {
    const u = new URL(url, GUI);
    requests.push(`${method.toUpperCase()} ${u.origin === GUI ? 'gui' : 'api'}${u.pathname}`);
    return u;
};
const answer = (u) => (routes[u.pathname] ?? (() => [200, {}]))();

class RecordingXHR {
    _l = {};
    status = 200;
    readyState = 0;
    responseType = '';
    upload = { addEventListener () {} };
    open (method, url) {
        this._u = record(method, url);
    }
    setRequestHeader () {}
    addEventListener (t, f) {
        (this._l[t] ??= []).push(f);
    }
    getResponseHeader (n) {
        return n.toLowerCase() === 'content-type' ? 'application/json' : null;
    }
    abort () {}
    send () {
        const [status, body, delay = 1] = answer(this._u);
        setTimeout(() => {
            this.status = status;
            this.responseText = body === null ? '' : JSON.stringify(body);
            this.response = this.responseType === 'blob'
                ? new NodeBlob([this.responseText], { type: 'application/json' })
                : this.responseText;
            this.readyState = 4;
            if ( this._u.pathname === '/cache/last-change-timestamp' ) dashboard.timestampAnswered = true;
            for ( const f of this._l.readystatechange ?? [] ) f.call(this);
            for ( const f of this._l.load ?? [] ) f.call(this, { target: this });
        }, delay);
    }
}

const recordingFetch = async (input, init = {}) => {
    const u = record(init.method ?? 'GET', typeof input === 'string' ? input : input.url);
    const [status, body, delay = 1] = answer(u);
    await new Promise((r) => setTimeout(r, delay));
    return new Response(body === null ? null : JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
    });
};

const settle = async () => {
    for ( let i = 0; i < 80; i++ ) await new Promise((r) => setTimeout(r, 2));
};

const count = (entry) => requests.filter((r) => r === entry).length;
const apiSockets = () => sockets.filter((s) => s.origin === API);

/**
 * Loads the page and runs `initgui` the way a signed-in dashboard visit does.
 * `navigation` is the page's Navigation Timing entry; `guiParams` what the
 * shell rendered.
 */
const boot = async ({ guiParams = {}, navigation = { type: 'navigate', transferSize: 4096 }, beforeInit } = {}) => {
    // The previous test's page keeps its timers; they write the local cache mark.
    globalThis.puter?.fs?.stopCacheUpdateTimer?.();
    clearInterval(globalThis.puter?.guiFSCacheTimer_);
    vi.resetModules();
    localStorage.clear();
    sockets.length = 0;
    dashboard.calls.length = 0;
    dashboard.timestampAnswered = false;
    history.replaceState(null, '', '/');

    globalThis.$ = jQuery;
    globalThis.jQuery = jQuery;
    globalThis.i18n = (k) => k;
    globalThis.html_encode = (v) => jQuery('<div>').text(v).html();
    globalThis.def = globalThis.def ?? ((v) => v);
    globalThis.use = globalThis.use ?? (() => class {});
    globalThis.isMobile = { phone: false, tablet: false };
    globalThis.service_script_api_promise = { resolve () {} };
    globalThis.XMLHttpRequest = RecordingXHR;
    globalThis.fetch = recordingFetch;
    globalThis.PUTER_API_ORIGIN = API;
    if ( ! globalThis.crypto?.subtle ) {
        Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
    }
    performance.getEntriesByType = (type) => (type === 'navigation' && navigation ? [navigation] : []);
    window.matchMedia = () => ({ matches: false, addEventListener () {} });
    window.close = () => {};
    window.open = () => ({ close () {} });

    window.puter_gui_enabled = true;
    window.gui_origin = GUI;
    window.api_origin = API;
    window.gui_params = guiParams;
    window.icons = {};
    window.ipc_handlers = {};
    localStorage.setItem('auth_token_v2', STORED);
    localStorage.setItem('user', JSON.stringify(USER));
    localStorage.setItem('logged_in_users', JSON.stringify([{ ...USER, auth_token: STORED }]));
    localStorage.setItem('has_visited_before', 'true');
    await import('./globals.js');

    // Hide `process` from the SDK's environment probe only.
    const realProcess = globalThis.process;
    Object.defineProperty(globalThis, 'process', {
        configurable: true,
        get () {
            const caller = (new Error().stack ?? '').split('\n')[2] ?? '';
            return /puter-js\/src\/index\.js:\d+/.test(caller) ? undefined : realProcess;
        },
    });
    let puter;
    try {
        ({ puter } = await import('../../puter-js/src/index.js'));
    } finally {
        Object.defineProperty(globalThis, 'process', { value: realProcess, configurable: true, writable: true });
    }
    globalThis.puter = puter;
    await import('./helpers.js');
    window.available_templates = () => {};
    await import('./initgui.js');

    // What an earlier visit cached under this token, persisted across reloads.
    puter._cache.set(puter.fsCacheKey('item', DESKTOP), { uid: 'uid-desktop', path: DESKTOP });
    dashboard.onRender = () => ({
        staleDesktopCached: !!puter._cache.get(puter.fsCacheKey('item', DESKTOP)),
        timestampAnswered: dashboard.timestampAnswered,
    });
    beforeInit?.(puter);

    requests = [];
    await window.initgui({});
    await settle();
    return puter;
};

beforeEach(() => {
    routes = {
        '/get-gui-token': () => [200, { token: guiToken() }],
        '/whoami': () => [200, { ...USER }],
        '/session/sync-cookie': () => [204, null],
        '/cache/last-change-timestamp': () => [200, { timestamp: 1 }],
        '/drivers/call': () => [200, { success: true, result: null }],
        '/readdir': () => [200, []],
    };
});

describe('/get-gui-token at boot', () => {
    it('keeps the stored token when it hands over one for the same session', async () => {
        const puter = await boot();

        expect(count('GET gui/get-gui-token')).toBe(1);
        expect(localStorage.getItem('auth_token_v2')).toBe(STORED);
        expect(puter.authToken).toBe(STORED);
        // The FS socket opened with the stored token at load is the only one.
        expect(apiSockets().map((s) => s.token)).toEqual([STORED]);
        expect(count('GET api/whoami')).toBe(2);
        expect(count('GET api/cache/last-change-timestamp')).toBe(1);
        // A cookie boot still renders from an empty FS cache.
        expect(dashboard.calls.map((c) => c.staleDesktopCached)).toEqual([false]);
    });

    it('replaces the stored token when the cookie is for another session', async () => {
        const cookieToken = guiToken({ session: 'b0b0b0b0-0000-4000-8000-000000000002', user: OTHER });
        routes['/get-gui-token'] = () => [200, { token: cookieToken }];
        const puter = await boot();

        expect(localStorage.getItem('auth_token_v2')).toBe(cookieToken);
        expect(puter.authToken).toBe(cookieToken);
        expect(apiSockets().at(-1).token).toBe(cookieToken);
        expect(dashboard.calls.map((c) => c.staleDesktopCached)).toEqual([false]);
    });

    it('replaces the stored token when any claim but iat differs', async () => {
        const extra = STORED.split('.');
        const claims = JSON.parse(Buffer.from(extra[1], 'base64url').toString());
        const cookieToken = `${extra[0]}.${b64url(JSON.stringify({ ...claims, iat: claims.iat + 1, x: 1 }))}.sig`;
        routes['/get-gui-token'] = () => [200, { token: cookieToken }];
        const puter = await boot();

        expect(puter.authToken).toBe(cookieToken);
        expect(localStorage.getItem('auth_token_v2')).toBe(cookieToken);
    });
});

describe('the shell naming the session cookie', () => {
    it('skips /get-gui-token when it names the stored token', async () => {
        const puter = await boot({ guiParams: { guiTokenDigest: await tokenClaimsDigest(STORED, webcrypto.subtle) } });

        expect(count('GET gui/get-gui-token')).toBe(0);
        expect(puter.authToken).toBe(STORED);
        expect(apiSockets().map((s) => s.token)).toEqual([STORED]);
        expect(dashboard.calls.map((c) => c.staleDesktopCached)).toEqual([false]);
    });

    it('asks /get-gui-token when it names another session', async () => {
        const cookieToken = guiToken({ session: 'b0b0b0b0-0000-4000-8000-000000000002', user: OTHER });
        routes['/get-gui-token'] = () => [200, { token: cookieToken }];
        const puter = await boot({ guiParams: { guiTokenDigest: await tokenClaimsDigest(cookieToken, webcrypto.subtle) } });

        expect(count('GET gui/get-gui-token')).toBe(1);
        expect(puter.authToken).toBe(cookieToken);
    });

    it('asks /get-gui-token when the page may be a cached copy', async () => {
        await boot({
            guiParams: { guiTokenDigest: await tokenClaimsDigest(STORED, webcrypto.subtle) },
            navigation: { type: 'back_forward', transferSize: 0 },
        });
        expect(count('GET gui/get-gui-token')).toBe(1);

        await boot({ guiParams: { guiTokenDigest: null }, navigation: { type: 'navigate', transferSize: 0 } });
        expect(count('GET gui/get-gui-token')).toBe(1);
    });

    it('skips /get-gui-token when there is no session cookie', async () => {
        const puter = await boot({ guiParams: { guiTokenDigest: null } });

        expect(count('GET gui/get-gui-token')).toBe(0);
        expect(puter.authToken).toBe(STORED);
    });

    it('signs out a kept token the server refuses, through the invalid-session path', async () => {
        routes['/whoami'] = () => [401, { code: 'token_auth_failed' }];
        const { default: UIAlert } = await import('./UI/UIAlert.js');
        UIAlert.mockClear();
        await boot({ guiParams: { guiTokenDigest: await tokenClaimsDigest(STORED, webcrypto.subtle) } });

        expect(count('GET gui/get-gui-token')).toBe(0);
        expect(UIAlert.mock.calls[0]?.[0]?.message).toBe('Your session is invalid. You will be logged out.');
        // Nothing stored, so the next boot asks /get-gui-token again.
        expect(localStorage.getItem('auth_token_v2')).toBe(null);
        expect(dashboard.calls).toEqual([]);
    });
});

describe('a boot that keeps the persisted FS cache', () => {
    // Changed on the server after this browser last held a live cache.
    const changedSince = () => {
        localStorage.setItem(LAST_VALID_TS, String(Date.now() - 60_000));
        routes['/cache/last-change-timestamp'] = () => [200, { timestamp: Date.now() }, 60];
    };

    it('purges it before the first render when there is no session cookie', async () => {
        routes['/get-gui-token'] = () => [401, { code: 'token_auth_failed' }];
        await boot({ beforeInit: changedSince });

        expect(dashboard.calls).toEqual([{ staleDesktopCached: false, timestampAnswered: true }]);
    });

    it('purges it before the first render when the shell says there is no session cookie', async () => {
        await boot({ guiParams: { guiTokenDigest: null }, beforeInit: changedSince });

        expect(count('GET gui/get-gui-token')).toBe(0);
        expect(dashboard.calls).toEqual([{ staleDesktopCached: false, timestampAnswered: true }]);
    });
});
