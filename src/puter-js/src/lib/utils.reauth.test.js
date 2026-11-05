import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initXhr, setupXhrEventHandlers } from './utils.js';

/**
 * A legacy XHR request refused with `token_auth_failed` signs the user in and
 * replays once with the fresh token. A refusal that survives the replay reaches
 * the caller without a second sign-in.
 */

// Minimal XHR fake: answers each request from a queue of { status, body }.
function installFakeXHR (responses) {
    const requests = [];
    class FakeXHR {
        _listeners = {};
        _headers = {};
        responseType = '';
        status = 200;
        open (method, url) { this.method = method; this.url = url; }
        setRequestHeader (name, value) { this._headers[name.toLowerCase()] = value; }
        addEventListener (type, fn) { (this._listeners[type] ??= []).push(fn); }
        getResponseHeader () { return null; }
        send (body) {
            requests.push(this);
            const next = responses.shift();
            queueMicrotask(() => {
                this.status = next.status;
                this.responseText = JSON.stringify(next.body);
                for ( const fn of this._listeners.load ?? [] ) fn.call(this, { target: this });
            });
        }
    }
    globalThis.XMLHttpRequest = FakeXHR;
    return requests;
}

const send = () => new Promise((resolve, reject) => {
    const xhr = initXhr('/whoami', 'https://api.test', 'stale', 'get');
    setupXhrEventHandlers(xhr, undefined, undefined, resolve, reject);
    xhr.send();
});

const authFailed = { status: 401, body: { code: 'token_auth_failed' } };
const ok = { status: 200, body: { username: 'u' } };

let savedXHR;
beforeEach(() => {
    savedXHR = globalThis.XMLHttpRequest;
    globalThis.puter = {
        authToken: 'stale',
        APIOrigin: 'https://api.test',
        env: 'web',
        resetAuthToken: vi.fn(() => {
            globalThis.puter.authToken = null;
        }),
        ui: {
            authenticateWithPuter: vi.fn(async () => {
                globalThis.puter.authToken = 'fresh';
            }),
        },
    };
});
afterEach(() => {
    globalThis.XMLHttpRequest = savedXHR;
    delete globalThis.puter;
    vi.restoreAllMocks();
});

describe('token_auth_failed on a legacy XHR request', () => {
    it('signs in and replays once with the fresh token', async () => {
        const requests = installFakeXHR([authFailed, ok]);
        await expect(send()).resolves.toEqual({ username: 'u' });
        expect(puter.ui.authenticateWithPuter).toHaveBeenCalledTimes(1);
        expect(requests).toHaveLength(2);
        expect(requests[1]._headers.authorization).toBe('Bearer fresh');
    });

    it('rejects a 401 that survives the replay without signing in again', async () => {
        const requests = installFakeXHR([authFailed, authFailed]);
        await expect(send()).rejects.toEqual({ status: 401, message: 'Unauthorized' });
        expect(puter.ui.authenticateWithPuter).toHaveBeenCalledTimes(1);
        expect(puter.resetAuthToken).toHaveBeenCalledTimes(1);
        expect(requests).toHaveLength(2);
        // The token from the sign-in is kept.
        expect(puter.authToken).toBe('fresh');
    });
});
