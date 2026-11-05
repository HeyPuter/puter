import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fsRequest } from '../modules/FileSystem/operations/scaffold.js';
import { driverCallEnvelope } from './networkUtils.js';

function installFakeXHR(responses) {
    const requests = [];
    class FakeXHR {
        _listeners = {};
        _headers = {};
        responseType = '';
        status = 200;
        readyState = 0;
        upload = { addEventListener() {} };
        open(method, url) {
            this.method = method;
            this.url = url;
        }
        setRequestHeader(name, value) {
            this._headers[name.toLowerCase()] = value;
        }
        addEventListener(type, fn) {
            (this._listeners[type] ??= []).push(fn);
        }
        getResponseHeader(name) {
            return name.toLowerCase() === 'content-type'
                ? 'application/json'
                : null;
        }
        abort() {}
        send(body) {
            this.body = body;
            requests.push(this);
            const next = responses.shift();
            queueMicrotask(() => {
                this.status = next.status;
                this.responseText = JSON.stringify(next.body);
                this.response = this.responseText;
                this.readyState = 4;
                this.onreadystatechange?.();
                for (const fn of this._listeners.readystatechange ?? [])
                    fn.call(this);
                for (const fn of this._listeners.load ?? [])
                    fn.call(this, { target: this });
            });
        }
    }
    globalThis.XMLHttpRequest = FakeXHR;
    return requests;
}

const authFailed = { status: 401, body: { code: 'token_auth_failed' } };

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

describe('reauth replay of body-token requests', () => {
    it('fs /stat rebuilds its body token after sign-in', async () => {
        const requests = installFakeXHR([
            authFailed,
            { status: 200, body: { success: true, result: 'ok' } },
        ]);
        const fsModule = {
            APIOrigin: 'https://api.test',
            get authToken() {
                return puter.authToken;
            },
        };
        await expect(
            fsRequest.call(fsModule, {
                endpoint: '/stat',
                authHeader: false,
                body: { path: '/u/x', auth_token: fsModule.authToken },
            }),
        ).resolves.toEqual({ success: true, result: 'ok' });

        expect(puter.ui.authenticateWithPuter).toHaveBeenCalledTimes(1);
        expect(puter.authToken).toBe('fresh');
        expect(requests).toHaveLength(2);
        expect(JSON.parse(requests[1].body).auth_token).toBe('fresh');
        expect(requests[1]._headers.authorization).toBeUndefined();
    });

    it('puter.drivers.call rebuilds its body token after sign-in', async () => {
        const requests = installFakeXHR([
            authFailed,
            { status: 200, body: { success: true, result: 'ok' } },
        ]);
        const result = await driverCallEnvelope({
            puter: globalThis.puter,
            iface: 'puter-kvstore',
            method: 'get',
            args: { key: 'k' },
        });

        expect(puter.ui.authenticateWithPuter).toHaveBeenCalledTimes(1);
        expect(requests).toHaveLength(2);
        expect(JSON.parse(requests[1].body).auth_token).toBe('fresh');
        expect(result).toEqual({ success: true, result: 'ok' });
    });
});
