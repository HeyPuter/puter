import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchUrl } from './networkUtils.js';

// -- Controllable fake XMLHttpRequest --
// Drives fetchUrl's event handlers deterministically. Each instance plays the
// `program` set on the class, which the test uses to script the response.
function installFakeXHR (program) {
    const instances = [];
    class FakeXHR extends EventTarget {
        constructor () {
            super();
            this.readyState = 0;
            this.status = 0;
            this.statusText = '';
            this.responseText = '';
            this.response = null;
            this.responseType = '';
            this.responseURL = '';
            this.withCredentials = false;
            this._reqHeaders = {};
            this._respHeaders = {};
            this.onreadystatechange = null;
            this.onprogress = null;
            instances.push(this);
        }
        open (method, url) { this.method = method; this.url = url; }
        setRequestHeader (name, value) { this._reqHeaders[name.toLowerCase()] = String(value); }
        getResponseHeader (name) { return this._respHeaders[name.toLowerCase()] ?? null; }
        abort () { this.dispatchEvent(new Event('abort')); }
        send (body) {
            this.reqBody = body;
            queueMicrotask(() => program(this));
        }
        // Test helpers the program uses to emit response phases.
        _setHeaders (status, headers = {}) {
            this.status = status;
            this.statusText = String(status);
            for ( const [ k, v ] of Object.entries(headers) ) this._respHeaders[k.toLowerCase()] = v;
        }
        _headersReceived () { this.readyState = 2; this.onreadystatechange?.(); }
        _progress (chunk) { this.responseText += chunk; this.readyState = 3; this.onprogress?.(); }
        _done () { this.readyState = 4; this.onreadystatechange?.(); this.dispatchEvent(new Event('load')); }
        _networkError () { this.dispatchEvent(new Event('error')); }
    }
    globalThis.XMLHttpRequest = FakeXHR;
    return instances;
}

// A simple buffered JSON/text response.
const respond = ({ status = 200, contentType = 'application/json', body = '' }) => xhr => {
    xhr._setHeaders(status, { 'content-type': contentType });
    xhr._headersReceived();
    xhr.responseText = typeof body === 'string' ? body : JSON.stringify(body);
    xhr._done();
};

let savedXHR;
beforeEach(() => { savedXHR = globalThis.XMLHttpRequest; });
afterEach(() => {
    globalThis.XMLHttpRequest = savedXHR;
    delete globalThis.puter;
    vi.restoreAllMocks();
});

describe('fetchUrl', () => {
    it('adds a Bearer header from the live puter.authToken when includePuterAuth', async () => {
        globalThis.puter = { authToken: 'tok-123' };
        const xhrs = installFakeXHR(respond({ body: { ok: true } }));
        await fetchUrl('https://api.example/whoami', { includePuterAuth: true });
        expect(xhrs[0]._reqHeaders['authorization']).toBe('Bearer tok-123');
    });

    it('omits the Bearer header when includePuterAuth is false', async () => {
        globalThis.puter = { authToken: 'tok-123' };
        const xhrs = installFakeXHR(respond({ body: {} }));
        await fetchUrl('https://api.example/public');
        expect(xhrs[0]._reqHeaders['authorization']).toBeUndefined();
    });

    it('passes through custom headers and body, skipping nullish header values', async () => {
        const xhrs = installFakeXHR(respond({ body: {} }));
        await fetchUrl('https://api.example/x', {
            method: 'POST',
            headers: { 'puter-auth': 'w-tok', 'x-skip': undefined },
            body: 'payload',
        });
        expect(xhrs[0].method).toBe('POST');
        expect(xhrs[0]._reqHeaders['puter-auth']).toBe('w-tok');
        expect('x-skip' in xhrs[0]._reqHeaders).toBe(false);
        expect(xhrs[0].reqBody).toBe('payload');
    });

    it('resolves ok:true on 200', async () => {
        installFakeXHR(respond({ status: 200, body: { a: 1 } }));
        const resp = await fetchUrl('https://api.example/x');
        expect(resp.ok).toBe(true);
        expect(resp.status).toBe(200);
        expect(await resp.json()).toEqual({ a: 1 });
    });

    it('resolves (not rejects) with ok:false on 404 and 500', async () => {
        for ( const status of [ 404, 500 ] ) {
            installFakeXHR(respond({ status, body: { error: 'nope' } }));
            const resp = await fetchUrl('https://api.example/x');
            expect(resp.ok).toBe(false);
            expect(resp.status).toBe(status);
            expect(await resp.json()).toEqual({ error: 'nope' });
        }
    });

    it('rejects on a network error', async () => {
        installFakeXHR(xhr => xhr._networkError());
        await expect(fetchUrl('https://api.example/x')).rejects.toThrow(/failed/);
    });

    it('exposes text(), json(), and blob() accessors', async () => {
        installFakeXHR(respond({ contentType: 'application/json', body: { hello: 'world' } }));
        const resp = await fetchUrl('https://api.example/x');
        expect(await resp.text()).toBe('{"hello":"world"}');
        expect(await resp.json()).toEqual({ hello: 'world' });
        const blob = await resp.blob();
        expect(blob).toBeInstanceOf(Blob);
        expect(blob.type).toBe('application/json');
        expect(blob.size).toBe('{"hello":"world"}'.length);
    });

    it('streams parsed NDJSON objects across chunk boundaries', async () => {
        installFakeXHR(xhr => {
            xhr._setHeaders(200, { 'content-type': 'application/x-ndjson' });
            xhr._headersReceived();
            // A JSON object split across two progress deltas, plus a full line.
            xhr._progress('{"n":1}\n{"n":');
            xhr._progress('2}\n{"n":3}\n');
            xhr._done();
        });
        const resp = await fetchUrl('https://api.example/stream');
        const got = [];
        for await ( const obj of resp.stream() ) got.push(obj);
        expect(got).toEqual([ { n: 1 }, { n: 2 }, { n: 3 } ]);
    });

    describe('401 reauth', () => {
        it('triggers reauth once and replays with the fresh token', async () => {
            const triggerReauth = vi.fn(async () => { globalThis.puter.authToken = 'fresh'; });
            globalThis.puter = { authToken: 'stale', env: 'web', triggerReauth };

            let call = 0;
            installFakeXHR(xhr => {
                call++;
                if ( call === 1 ) {
                    // first attempt: 401 reauth_required
                    return respond({ status: 401, body: { code: 'reauth_required', reason: 'x', auth_id: 'a' } })(xhr);
                }
                // replay carries the fresh token and succeeds
                expect(xhr._reqHeaders['authorization']).toBe('Bearer fresh');
                return respond({ status: 200, body: { ok: true } })(xhr);
            });

            const resp = await fetchUrl('https://api.example/x', { includePuterAuth: true });
            expect(triggerReauth).toHaveBeenCalledTimes(1);
            expect(resp.ok).toBe(true);
            expect(await resp.json()).toEqual({ ok: true });
        });

        it('does not loop: a second 401 after replay surfaces as ok:false', async () => {
            const triggerReauth = vi.fn(async () => {});
            globalThis.puter = { authToken: 'stale', env: 'web', triggerReauth };

            installFakeXHR(respond({ status: 401, body: { code: 'reauth_required' } }));
            const resp = await fetchUrl('https://api.example/x', { includePuterAuth: true });
            // reauth attempted exactly once; replayed request's 401 is returned.
            expect(triggerReauth).toHaveBeenCalledTimes(1);
            expect(resp.ok).toBe(false);
            expect(resp.status).toBe(401);
        });

        it('plain 401 (no reauth code) resolves ok:false without triggering reauth', async () => {
            const triggerReauth = vi.fn();
            globalThis.puter = { authToken: 't', env: 'web', triggerReauth };
            installFakeXHR(respond({ status: 401, body: { message: 'Unauthorized' } }));
            const resp = await fetchUrl('https://api.example/x', { includePuterAuth: true });
            expect(triggerReauth).not.toHaveBeenCalled();
            expect(resp.ok).toBe(false);
        });
    });

    describe('API call logging', () => {
        const makeLogger = () => ({ isEnabled: () => true, logRequest: vi.fn() });

        it('logs on success when the logger is enabled', async () => {
            const apiCallLogger = makeLogger();
            globalThis.puter = { apiCallLogger };
            installFakeXHR(respond({ status: 200, body: {} }));
            await fetchUrl('https://api.example/x');
            expect(apiCallLogger.logRequest).toHaveBeenCalledTimes(1);
            expect(apiCallLogger.logRequest.mock.calls[0][0].error).toBeNull();
        });

        it('logs an error entry on a 4xx', async () => {
            const apiCallLogger = makeLogger();
            globalThis.puter = { apiCallLogger };
            installFakeXHR(respond({ status: 404, body: { code: 'not_found' } }));
            await fetchUrl('https://api.example/x');
            expect(apiCallLogger.logRequest).toHaveBeenCalledTimes(1);
            const entry = apiCallLogger.logRequest.mock.calls[0][0];
            expect(entry.error).toMatchObject({ code: 'not_found' });
            expect(entry.result).toBeNull();
        });

        it('uses logContext for semantic service/operation when provided', async () => {
            const apiCallLogger = makeLogger();
            globalThis.puter = { apiCallLogger };
            installFakeXHR(respond({ status: 200, body: { u: 1 } }));
            await fetchUrl('https://api.example/whoami', {
                logContext: { service: 'auth', operation: 'whoami', params: {} },
            });
            const entry = apiCallLogger.logRequest.mock.calls[0][0];
            expect(entry).toMatchObject({ service: 'auth', operation: 'whoami' });
            expect(entry.result).toEqual({ u: 1 });
        });
    });
});
