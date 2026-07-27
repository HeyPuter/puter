import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dedupe, driverCall, driverCallEnvelope, fetchUrl, sendWithRetry } from './networkUtils.js';

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

    it('rejects on a network error (write — no retry)', async () => {
        // A write never auto-retries, so the network error surfaces immediately.
        // Read retry-then-reject is covered in the transient-retry suite.
        installFakeXHR(xhr => xhr._networkError());
        await expect(fetchUrl('https://api.example/x', { method: 'POST' })).rejects.toThrow(/failed/);
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

// Play a scripted response per attempt (retries create fresh XHR instances).
const sequence = (...steps) => {
    let i = 0;
    return xhr => steps[Math.min(i++, steps.length - 1)](xhr);
};
const netError = () => xhr => xhr._networkError();

describe('transient retry', () => {
    beforeEach(() => { globalThis.puter = {}; });

    it('retries a GET on 503 then resolves the success', async () => {
        vi.useFakeTimers();
        const xhrs = installFakeXHR(sequence(
            respond({ status: 503, body: {} }),
            respond({ status: 200, body: { ok: 1 } }),
        ));
        const p = fetchUrl('https://api.example/x'); // GET → retry-safe
        await vi.advanceTimersByTimeAsync(60_000);
        const resp = await p;
        expect(resp.status).toBe(200);
        expect(xhrs.length).toBe(2);
        vi.useRealTimers();
    });

    it('does not retry a POST by default', async () => {
        const xhrs = installFakeXHR(sequence(respond({ status: 503, body: {} })));
        const resp = await fetchUrl('https://api.example/x', { method: 'POST' });
        expect(resp.status).toBe(503);
        expect(xhrs.length).toBe(1);
    });

    it('retries a POST when retry:true (read-style opt-in)', async () => {
        vi.useFakeTimers();
        const xhrs = installFakeXHR(sequence(
            respond({ status: 503, body: {} }),
            respond({ status: 200, body: { ok: 1 } }),
        ));
        const p = fetchUrl('https://api.example/x', { method: 'POST', retry: true });
        await vi.advanceTimersByTimeAsync(60_000);
        expect((await p).status).toBe(200);
        expect(xhrs.length).toBe(2);
        vi.useRealTimers();
    });

    it('retry:false disables retry even for a GET', async () => {
        const xhrs = installFakeXHR(sequence(respond({ status: 503, body: {} })));
        const resp = await fetchUrl('https://api.example/x', { retry: false });
        expect(resp.status).toBe(503);
        expect(xhrs.length).toBe(1);
    });

    it('does not retry a non-retryable status (400)', async () => {
        const xhrs = installFakeXHR(sequence(respond({ status: 400, body: {} })));
        const resp = await fetchUrl('https://api.example/x'); // GET
        expect(resp.status).toBe(400);
        expect(xhrs.length).toBe(1);
    });

    it('respects the autoRetry kill switch', async () => {
        globalThis.puter = { config: { autoRetry: false } };
        const xhrs = installFakeXHR(sequence(respond({ status: 503, body: {} })));
        const resp = await fetchUrl('https://api.example/x'); // GET, but retry off
        expect(resp.status).toBe(503);
        expect(xhrs.length).toBe(1);
    });

    it('retries a network error for a read, then rejects after the cap', async () => {
        vi.useFakeTimers();
        const xhrs = installFakeXHR(netError()); // every attempt fails
        const p = fetchUrl('https://api.example/x').catch(e => e); // GET
        await vi.advanceTimersByTimeAsync(60_000); // clears the ~11.75s schedule
        const err = await p;
        expect(err).toBeInstanceOf(TypeError);
        expect(xhrs.length).toBe(9); // 1 initial + 8 scheduled retries
        vi.useRealTimers();
    });

    it('rejects a write network error immediately (no retry)', async () => {
        const xhrs = installFakeXHR(netError());
        await expect(fetchUrl('https://api.example/x', { method: 'POST' })).rejects.toThrow(/failed/);
        expect(xhrs.length).toBe(1);
    });

    it('gives up on a 2s retry when the clock jumps (sleep/drift guard)', async () => {
        // Fake only the timers, not Date — a manual `clock` drives Date.now so we
        // can simulate the machine sleeping during a 2s ceiling wait.
        vi.useFakeTimers({ toFake: [ 'setTimeout', 'clearTimeout' ] });
        let clock = 0;
        vi.spyOn(Date, 'now').mockImplementation(() => clock);
        const xhrs = installFakeXHR(respond({ status: 503, body: {} })); // always retryable
        const p = fetchUrl('https://api.example/x'); // GET → read-safe

        // Ramp (250+500+1000) → 4 attempts, then paused in the first 2s wait.
        // Sub-2s waits aren't drift-guarded, so the clock needn't move here.
        await vi.advanceTimersByTimeAsync(1750);
        // Simulate the laptop sleeping through the 2s wait: the clock leaps ahead.
        clock += 2000 + 60_000;
        await vi.advanceTimersByTimeAsync(2000);

        const resp = await p;
        expect(resp.status).toBe(503); // failed with the last outcome — no further retry
        expect(xhrs.length).toBe(4);   // stopped after the drifted 2s wait, before attempt 5
        vi.useRealTimers();
    });
});

describe('dedupe', () => {
    it('coalesces concurrent identical requests into one call', async () => {
        let calls = 0;
        const factory = () => { calls++; return new Promise(r => setTimeout(() => r({ v: calls }), 5)); };
        const [ a, b ] = await Promise.all([ dedupe('k', factory), dedupe('k', factory) ]);
        expect(calls).toBe(1);
        expect(a).toBe(b); // shared resolved value by reference
    });

    it('re-issues after the in-flight request settles', async () => {
        let calls = 0;
        const factory = () => Promise.resolve(++calls);
        await dedupe('k2', factory);
        await dedupe('k2', factory);
        expect(calls).toBe(2);
    });

    it('does not collide across distinct keys', async () => {
        let calls = 0;
        const factory = () => new Promise(r => setTimeout(() => r(++calls), 5));
        await Promise.all([ dedupe('a', factory), dedupe('b', factory) ]);
        expect(calls).toBe(2);
    });
});

describe('driver permission-grant replay (regression)', () => {
    it('replays exactly once after a grant, preserving the rebuilt request', async () => {
        // Before the fix, the driver permission replay dropped arguments; here we
        // assert one prompt, one replay, and the same body on the retry.
        // requestPermission resolves to a boolean (its real contract).
        const requestPermission = vi.fn(async () => true);
        globalThis.puter = { ui: { requestPermission } };
        const xhrs = installFakeXHR(sequence(
            respond({ status: 200, body: { success: false, error: { code: 'permission_denied' } } }),
            respond({ status: 200, body: { success: true, result: 'ok' } }),
        ));
        const spec = {
            url: 'https://api.example/drivers/call',
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;actually=json' },
            buildBody: () => JSON.stringify({ interface: 'iface', method: 'm', args: { a: 1 } }),
        };
        const result = await sendWithRetry(spec, {
            permission: 'driver:iface:m',
            shapeStream: () => {},
            shape: outcome => outcome.parsed,
        });
        expect(requestPermission).toHaveBeenCalledTimes(1);
        expect(requestPermission).toHaveBeenCalledWith({ permission: 'driver:iface:m' });
        expect(xhrs.length).toBe(2);
        expect(xhrs[1].reqBody).toBe(JSON.stringify({ interface: 'iface', method: 'm', args: { a: 1 } }));
        expect(result).toEqual({ success: true, result: 'ok' });
    });

    it('does not loop when the grant still yields permission_denied', async () => {
        // Legacy `{granted}` object shape is still tolerated.
        const requestPermission = vi.fn(async () => ({ granted: true }));
        globalThis.puter = { ui: { requestPermission } };
        const denied = respond({ status: 200, body: { success: false, error: { code: 'permission_denied' } } });
        const xhrs = installFakeXHR(sequence(denied, denied, denied));
        const spec = { url: 'https://api.example/drivers/call', method: 'POST', headers: {}, buildBody: () => '{}' };
        const result = await sendWithRetry(spec, {
            permission: 'driver:iface:m',
            shapeStream: () => {},
            shape: outcome => outcome.parsed,
        });
        expect(requestPermission).toHaveBeenCalledTimes(1); // one-shot
        expect(xhrs.length).toBe(2);
        expect(result.error.code).toBe('permission_denied');
    });
});

describe('driverCall', () => {
    const call = { iface: 'puter-kvstore', method: 'get', args: { key: 'k' } };

    beforeEach(() => {
        globalThis.puter = { authToken: 'tok', APIOrigin: 'https://api.example', env: 'nodejs' };
    });

    it('posts the driver envelope and resolves the unwrapped result', async () => {
        const xhrs = installFakeXHR(respond({ body: { success: true, result: 'v' } }));
        const result = await driverCall(call);
        expect(result).toBe('v');
        expect(xhrs[0].method).toBe('POST');
        expect(xhrs[0].url).toBe('https://api.example/drivers/call');
        expect(xhrs[0]._reqHeaders['content-type']).toBe('text/plain;actually=json');
        expect(JSON.parse(xhrs[0].reqBody)).toEqual({
            interface: 'puter-kvstore',
            method: 'get',
            args: { key: 'k' },
            auth_token: 'tok',
        });
    });

    it('sends driver and test_mode only when the caller sets them', async () => {
        const xhrs = installFakeXHR(respond({ body: { success: true, result: {} } }));
        await driverCall({ ...call, driver: 'ai-chat', testMode: false });
        expect(JSON.parse(xhrs[0].reqBody)).toMatchObject({ driver: 'ai-chat', test_mode: false });
    });

    it('resolves the whole response when the driver returns no result field', async () => {
        installFakeXHR(respond({ body: { success: true, models: [] } }));
        expect(await driverCall(call)).toEqual({ success: true, models: [] });
    });

    it('applies transform to a successful result', async () => {
        installFakeXHR(respond({ body: { success: true, result: 2 } }));
        const result = await driverCall(call, { transform: async n => n * 21 });
        expect(result).toBe(42);
    });

    it('rejects the driver error payload and notifies onError', async () => {
        installFakeXHR(respond({ body: { success: false, error: { code: 'key_too_large' } } }));
        const onError = vi.fn();
        await expect(driverCall(call, { onError })).rejects.toEqual({
            success: false, error: { code: 'key_too_large' },
        });
        expect(onError).toHaveBeenCalledWith({ success: false, error: { code: 'key_too_large' } });
    });

    it('rejects a leftover 401 as Unauthorized', async () => {
        installFakeXHR(respond({ status: 401, body: {} }));
        await expect(driverCall(call)).rejects.toEqual({ status: 401, message: 'Unauthorized' });
    });

    it('rejects auth_canceled when a signed-out visitor dismisses the prompt', async () => {
        globalThis.puter = {
            authToken: null,
            APIOrigin: 'https://api.example',
            env: 'web',
            ui: { authenticateWithPuter: async () => { throw new Error('dismissed'); } },
        };
        const xhrs = installFakeXHR(respond({ body: { success: true, result: 'v' } }));
        await expect(driverCall(call)).rejects.toEqual({
            error: { code: 'auth_canceled', message: 'Authentication canceled' },
        });
        expect(xhrs.length).toBe(0); // no request without a token
    });

    it('resolves an NDJSON response as an iterator of lines that stringify to their text', async () => {
        installFakeXHR(xhr => {
            xhr._setHeaders(200, { 'content-type': 'application/x-ndjson' });
            xhr._headersReceived();
            xhr._progress('{"text":"he"}\n{"text":"llo"}\n');
            xhr._done();
        });
        const parts = [];
        for await ( const part of await driverCall(call) ) parts.push(`${part}`);
        expect(parts).toEqual([ 'he', 'llo' ]);
    });

    it('retries a readonly method on a transient failure', async () => {
        vi.useFakeTimers();
        const xhrs = installFakeXHR(sequence(
            respond({ status: 503, body: {} }),
            respond({ body: { success: true, result: 'v' } }),
        ));
        const p = driverCall(call, { readonly: true });
        await vi.advanceTimersByTimeAsync(60_000);
        await expect(p).resolves.toBe('v');
        expect(xhrs.length).toBe(2);
        vi.useRealTimers();
    });
});

describe('driverCallEnvelope', () => {
    const call = { iface: 'ipgeo', method: 'ipgeo', args: { ip: '1.2.3.4' } };

    beforeEach(() => {
        globalThis.puter = { authToken: 'tok', APIOrigin: 'https://api.example', env: 'nodejs' };
    });

    it('resolves the envelope as the backend sent it', async () => {
        installFakeXHR(respond({ body: { success: true, result: { country: 'US' } } }));
        expect(await driverCallEnvelope(call)).toEqual({ success: true, result: { country: 'US' } });
    });

    it('resolves rather than rejects on a driver-level failure', async () => {
        installFakeXHR(respond({ body: { success: false, error: { code: 'not_found' } } }));
        expect(await driverCallEnvelope(call)).toEqual({ success: false, error: { code: 'not_found' } });
    });

    it('reads a response with no declared content type as JSON', async () => {
        installFakeXHR(xhr => {
            xhr._setHeaders(200);
            xhr._headersReceived();
            xhr.responseText = '{"success":true,"result":[1,2]}';
            xhr._done();
        });
        expect(await driverCallEnvelope(call)).toEqual({ success: true, result: [ 1, 2 ] });
    });

    it('throws on a content type it cannot read', async () => {
        installFakeXHR(respond({ contentType: 'text/html', body: '<html>' }));
        await expect(driverCallEnvelope(call)).rejects.toThrow('unrecognized content type: text/html');
    });
});
