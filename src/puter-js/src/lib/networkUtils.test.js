import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    dedupe,
    driverCall,
    driverCallEnvelope,
    driverLineStream,
    fetchUrl,
    parseResponse,
    sendWithRetry,
} from './networkUtils.js';

// -- Controllable fake XMLHttpRequest --
// Drives fetchUrl's event handlers deterministically. Each instance plays the
// `program` set on the class, which the test uses to script the response.
function installFakeXHR(program) {
    const instances = [];
    class FakeXHR extends EventTarget {
        constructor() {
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
            this.upload = { addEventListener: vi.fn() };
            instances.push(this);
        }
        open(method, url) {
            this.method = method;
            this.url = url;
        }
        setRequestHeader(name, value) {
            this._reqHeaders[name.toLowerCase()] = String(value);
        }
        getResponseHeader(name) {
            return this._respHeaders[name.toLowerCase()] ?? null;
        }
        abort() {
            this.dispatchEvent(new Event('abort'));
        }
        send(body) {
            this.reqBody = body;
            queueMicrotask(() => program(this));
        }
        // Test helpers the program uses to emit response phases.
        _setHeaders(status, headers = {}) {
            this.status = status;
            this.statusText = String(status);
            for (const [k, v] of Object.entries(headers))
                this._respHeaders[k.toLowerCase()] = v;
        }
        _setReadyState(state) {
            if (this.readyState === state) return;
            this.readyState = state;
            this.onreadystatechange?.();
            this.dispatchEvent(new Event('readystatechange'));
        }
        _headersReceived() {
            this._setReadyState(2);
        }
        _progress(chunk) {
            this.responseText += chunk;
            this._setReadyState(3);
            this.onprogress?.();
            this.dispatchEvent(new Event('progress'));
        }
        _done() {
            this._setReadyState(4);
            this.dispatchEvent(new Event('load'));
        }
        _networkError() {
            this.dispatchEvent(new Event('error'));
        }
    }
    globalThis.XMLHttpRequest = FakeXHR;
    return instances;
}

// A simple buffered JSON/text response.
const respond =
    ({ status = 200, contentType = 'application/json', body = '' }) =>
    (xhr) => {
        xhr._setHeaders(status, { 'content-type': contentType });
        xhr._headersReceived();
        xhr.responseText =
            typeof body === 'string' ? body : JSON.stringify(body);
        xhr._done();
    };

let savedXHR;
beforeEach(() => {
    savedXHR = globalThis.XMLHttpRequest;
});
afterEach(() => {
    globalThis.XMLHttpRequest = savedXHR;
    delete globalThis.puter;
    vi.restoreAllMocks();
});

describe('fetchUrl', () => {
    it('adds a Bearer header from the live puter.authToken when includePuterAuth', async () => {
        globalThis.puter = { authToken: 'tok-123' };
        const xhrs = installFakeXHR(respond({ body: { ok: true } }));
        await fetchUrl('https://api.example/whoami', {
            includePuterAuth: true,
        });
        expect(xhrs[0]._reqHeaders['authorization']).toBe('Bearer tok-123');
    });

    it('sends an explicit authToken instead of the live one', async () => {
        // The migration endpoint sends a token that is about to be replaced.
        globalThis.puter = { authToken: 'live' };
        const xhrs = installFakeXHR(respond({ body: {} }));
        await fetchUrl('https://api.example/migrate', {
            method: 'POST',
            authToken: 'explicit',
        });
        expect(xhrs[0]._reqHeaders['authorization']).toBe('Bearer explicit');
    });

    it('falls back to authToken when there is no live token to read', async () => {
        // Boot-time calls run before `globalThis.puter` is assigned.
        const xhrs = installFakeXHR(respond({ body: {} }));
        await fetchUrl('https://api.example/whoami', {
            includePuterAuth: true,
            authToken: 'from-instance',
        });
        expect(xhrs[0]._reqHeaders['authorization']).toBe(
            'Bearer from-instance',
        );
    });

    it('prefers the live token over the fallback when both are available', async () => {
        globalThis.puter = { authToken: 'live' };
        const xhrs = installFakeXHR(respond({ body: {} }));
        await fetchUrl('https://api.example/whoami', {
            includePuterAuth: true,
            authToken: 'from-instance',
        });
        expect(xhrs[0]._reqHeaders['authorization']).toBe('Bearer live');
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
        for (const status of [404, 500]) {
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
        installFakeXHR((xhr) => xhr._networkError());
        await expect(
            fetchUrl('https://api.example/x', { method: 'POST' }),
        ).rejects.toThrow(/failed/);
    });

    it('exposes text(), json(), and blob() accessors', async () => {
        installFakeXHR(
            respond({
                contentType: 'application/json',
                body: { hello: 'world' },
            }),
        );
        const resp = await fetchUrl('https://api.example/x');
        expect(await resp.text()).toBe('{"hello":"world"}');
        expect(await resp.json()).toEqual({ hello: 'world' });
        const blob = await resp.blob();
        expect(blob).toBeInstanceOf(Blob);
        expect(blob.type).toBe('application/json');
        expect(blob.size).toBe('{"hello":"world"}'.length);
    });

    it('streams parsed NDJSON objects across chunk boundaries', async () => {
        installFakeXHR((xhr) => {
            xhr._setHeaders(200, { 'content-type': 'application/x-ndjson' });
            xhr._headersReceived();
            // A JSON object split across two progress deltas, plus a full line.
            xhr._progress('{"n":1}\n{"n":');
            xhr._progress('2}\n{"n":3}\n');
            xhr._done();
        });
        const resp = await fetchUrl('https://api.example/stream');
        const got = [];
        for await (const obj of resp.stream()) got.push(obj);
        expect(got).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
    });

    describe('401 reauth', () => {
        it('triggers reauth once and replays with the fresh token', async () => {
            const triggerReauth = vi.fn(async () => {
                globalThis.puter.authToken = 'fresh';
            });
            globalThis.puter = {
                authToken: 'stale',
                env: 'web',
                triggerReauth,
            };

            let call = 0;
            installFakeXHR((xhr) => {
                call++;
                if (call === 1) {
                    // first attempt: 401 reauth_required
                    return respond({
                        status: 401,
                        body: {
                            code: 'reauth_required',
                            reason: 'x',
                            auth_id: 'a',
                        },
                    })(xhr);
                }
                // replay carries the fresh token and succeeds
                expect(xhr._reqHeaders['authorization']).toBe('Bearer fresh');
                return respond({ status: 200, body: { ok: true } })(xhr);
            });

            const resp = await fetchUrl('https://api.example/x', {
                includePuterAuth: true,
            });
            expect(triggerReauth).toHaveBeenCalledTimes(1);
            expect(resp.ok).toBe(true);
            expect(await resp.json()).toEqual({ ok: true });
        });

        it('does not loop: a second 401 after replay surfaces as ok:false', async () => {
            const triggerReauth = vi.fn(async () => {});
            globalThis.puter = {
                authToken: 'stale',
                env: 'web',
                triggerReauth,
            };

            installFakeXHR(
                respond({ status: 401, body: { code: 'reauth_required' } }),
            );
            const resp = await fetchUrl('https://api.example/x', {
                includePuterAuth: true,
            });
            // reauth attempted exactly once; replayed request's 401 is returned.
            expect(triggerReauth).toHaveBeenCalledTimes(1);
            expect(resp.ok).toBe(false);
            expect(resp.status).toBe(401);
        });

        it('plain 401 (no reauth code) resolves ok:false without triggering reauth', async () => {
            const triggerReauth = vi.fn();
            globalThis.puter = { authToken: 't', env: 'web', triggerReauth };
            installFakeXHR(
                respond({ status: 401, body: { message: 'Unauthorized' } }),
            );
            const resp = await fetchUrl('https://api.example/x', {
                includePuterAuth: true,
            });
            expect(triggerReauth).not.toHaveBeenCalled();
            expect(resp.ok).toBe(false);
        });

        // A request the user didn't initiate (boot telemetry, cache warmers)
        // must not put a sign-in popup or consent dialog in front of someone who
        // only loaded the page.
        describe('interactiveReauth: false', () => {
            const makePuter = () => ({
                authToken: 'stale',
                env: 'web',
                triggerReauth: vi.fn(),
                resetAuthToken: vi.fn(),
                dropStaleAuthToken: vi.fn(),
                ui: { authenticateWithPuter: vi.fn() },
            });

            it('drops the stale token without raising UI on reauth_required', async () => {
                globalThis.puter = makePuter();
                installFakeXHR(
                    respond({
                        status: 401,
                        body: {
                            code: 'reauth_required',
                            reason: 'session_expired',
                            auth_id: 'a',
                        },
                    }),
                );

                const resp = await fetchUrl('https://api.example/rao', {
                    method: 'POST',
                    includePuterAuth: true,
                    interactiveReauth: false,
                });

                expect(globalThis.puter.triggerReauth).not.toHaveBeenCalled();
                expect(
                    globalThis.puter.ui.authenticateWithPuter,
                ).not.toHaveBeenCalled();
                // Reported with the token it was sent with, so a reauth that
                // completed meanwhile keeps the token it installed.
                expect(
                    globalThis.puter.dropStaleAuthToken,
                ).toHaveBeenCalledWith({
                    reason: 'session_expired',
                    auth_id: 'a',
                    sentToken: 'stale',
                });
                expect(resp.ok).toBe(false);
                expect(resp.status).toBe(401);
            });

            it('drops the stale token without raising UI on token_auth_failed', async () => {
                globalThis.puter = makePuter();
                installFakeXHR(
                    respond({
                        status: 401,
                        body: { code: 'token_auth_failed' },
                    }),
                );

                const resp = await fetchUrl('https://api.example/whoami', {
                    includePuterAuth: true,
                    interactiveReauth: false,
                });

                expect(
                    globalThis.puter.ui.authenticateWithPuter,
                ).not.toHaveBeenCalled();
                expect(globalThis.puter.resetAuthToken).not.toHaveBeenCalled();
                expect(
                    globalThis.puter.dropStaleAuthToken,
                ).toHaveBeenCalledTimes(1);
                expect(resp.ok).toBe(false);
            });

            it('asks the desktop to renew a godmode token, even in the background', async () => {
                const triggerReauth = vi.fn(async () => {
                    globalThis.puter.authToken = 'fresh';
                });
                globalThis.puter = {
                    ...makePuter(),
                    env: 'app',
                    isGodmodeToken_: (token) => token === 'stale',
                    triggerReauth,
                };
                let call = 0;
                installFakeXHR((xhr) => {
                    call++;
                    if (call === 1) {
                        return respond({
                            status: 401,
                            body: { code: 'token_auth_failed' },
                        })(xhr);
                    }
                    expect(xhr._reqHeaders['authorization']).toBe(
                        'Bearer fresh',
                    );
                    return respond({ status: 200, body: { ok: true } })(xhr);
                });

                const resp = await fetchUrl('https://api.example/whoami', {
                    includePuterAuth: true,
                    interactiveReauth: false,
                });

                expect(triggerReauth).toHaveBeenCalledTimes(1);
                expect(
                    globalThis.puter.dropStaleAuthToken,
                ).not.toHaveBeenCalled();
                expect(resp.ok).toBe(true);
            });

            it('leaves an app token on token_auth_failed to the caller', async () => {
                globalThis.puter = {
                    ...makePuter(),
                    env: 'app',
                    isGodmodeToken_: () => false,
                };
                installFakeXHR(
                    respond({
                        status: 401,
                        body: { code: 'token_auth_failed' },
                    }),
                );

                const resp = await fetchUrl('https://api.example/x', {
                    includePuterAuth: true,
                });

                expect(globalThis.puter.triggerReauth).not.toHaveBeenCalled();
                expect(resp.ok).toBe(false);
            });

            it('leaves a successful background request alone', async () => {
                // The flag only governs the prompt: a 200 is unaffected.
                globalThis.puter = makePuter();
                installFakeXHR(respond({ status: 200, body: { ok: true } }));
                const resp = await fetchUrl('https://api.example/rao', {
                    method: 'POST',
                    includePuterAuth: true,
                    interactiveReauth: false,
                });
                expect(resp.ok).toBe(true);
                expect(
                    globalThis.puter.dropStaleAuthToken,
                ).not.toHaveBeenCalled();
            });
        });
    });

    describe('API call logging', () => {
        const makeLogger = () => ({
            isEnabled: () => true,
            logRequest: vi.fn(),
        });

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
            installFakeXHR(
                respond({ status: 404, body: { code: 'not_found' } }),
            );
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
                logContext: {
                    service: 'auth',
                    operation: 'whoami',
                    params: {},
                },
            });
            const entry = apiCallLogger.logRequest.mock.calls[0][0];
            expect(entry).toMatchObject({
                service: 'auth',
                operation: 'whoami',
            });
            expect(entry.result).toEqual({ u: 1 });
        });
    });
});

// Play a scripted response per attempt (retries create fresh XHR instances).
const sequence = (...steps) => {
    let i = 0;
    return (xhr) => steps[Math.min(i++, steps.length - 1)](xhr);
};
const netError = () => (xhr) => xhr._networkError();

describe('transient retry', () => {
    beforeEach(() => {
        globalThis.puter = {};
    });

    it('retries a GET on 503 then resolves the success', async () => {
        vi.useFakeTimers();
        const xhrs = installFakeXHR(
            sequence(
                respond({ status: 503, body: {} }),
                respond({ status: 200, body: { ok: 1 } }),
            ),
        );
        const p = fetchUrl('https://api.example/x'); // GET → retry-safe
        await vi.advanceTimersByTimeAsync(60_000);
        const resp = await p;
        expect(resp.status).toBe(200);
        expect(xhrs.length).toBe(2);
        vi.useRealTimers();
    });

    it('does not retry a POST by default', async () => {
        const xhrs = installFakeXHR(
            sequence(respond({ status: 503, body: {} })),
        );
        const resp = await fetchUrl('https://api.example/x', {
            method: 'POST',
        });
        expect(resp.status).toBe(503);
        expect(xhrs.length).toBe(1);
    });

    it('retries a POST when retry:true (read-style opt-in)', async () => {
        vi.useFakeTimers();
        const xhrs = installFakeXHR(
            sequence(
                respond({ status: 503, body: {} }),
                respond({ status: 200, body: { ok: 1 } }),
            ),
        );
        const p = fetchUrl('https://api.example/x', {
            method: 'POST',
            retry: true,
        });
        await vi.advanceTimersByTimeAsync(60_000);
        expect((await p).status).toBe(200);
        expect(xhrs.length).toBe(2);
        vi.useRealTimers();
    });

    it('retry:false disables retry even for a GET', async () => {
        const xhrs = installFakeXHR(
            sequence(respond({ status: 503, body: {} })),
        );
        const resp = await fetchUrl('https://api.example/x', { retry: false });
        expect(resp.status).toBe(503);
        expect(xhrs.length).toBe(1);
    });

    it('does not retry a non-retryable status (400)', async () => {
        const xhrs = installFakeXHR(
            sequence(respond({ status: 400, body: {} })),
        );
        const resp = await fetchUrl('https://api.example/x'); // GET
        expect(resp.status).toBe(400);
        expect(xhrs.length).toBe(1);
    });

    // A 429 comes from a gate that runs before the handler, so nothing was
    // applied and a write is as safe to replay as a read. Uploads and bursts
    // of driver writes are the callers this matters to.
    it('retries a POST on 429 even though 503 would not', async () => {
        vi.useFakeTimers();
        const xhrs = installFakeXHR(
            sequence(
                respond({ status: 429, body: {} }),
                respond({ status: 200, body: { ok: 1 } }),
            ),
        );
        const p = fetchUrl('https://api.example/x', { method: 'POST' });
        await vi.advanceTimersByTimeAsync(60_000);
        expect((await p).status).toBe(200);
        expect(xhrs.length).toBe(2);
        vi.useRealTimers();
    });

    it('gives up on 429 after the retry schedule is spent', async () => {
        vi.useFakeTimers();
        const xhrs = installFakeXHR(respond({ status: 429, body: {} }));
        const p = fetchUrl('https://api.example/x', { method: 'POST' });
        await vi.advanceTimersByTimeAsync(60_000);
        expect((await p).status).toBe(429);
        expect(xhrs.length).toBe(9); // 1 initial + 8 scheduled retries
        vi.useRealTimers();
    });

    // Waiting on the account's own requests to finish takes longer than a rate
    // window, so `credits_reserved` backs off exponentially past 2s.
    it('backs off exponentially on a credits_reserved 429', async () => {
        vi.useFakeTimers();
        const reserved = respond({
            status: 429,
            body: { code: 'too_many_requests', errorCode: 'credits_reserved' },
        });
        const xhrs = installFakeXHR(reserved);
        const p = fetchUrl('https://api.example/x', { method: 'POST' });
        // 1 + 2 + 4 + 8 + 16 + 30s: the gate schedule would have given up.
        await vi.advanceTimersByTimeAsync(61_000);
        expect(xhrs.length).toBe(7);
        await vi.advanceTimersByTimeAsync(120_000);
        expect((await p).status).toBe(429);
        expect(xhrs.length).toBe(9); // 1 initial + 8 scheduled retries
        vi.useRealTimers();
    });

    it('honors retry:false on a 429', async () => {
        const xhrs = installFakeXHR(
            sequence(respond({ status: 429, body: {} })),
        );
        const resp = await fetchUrl('https://api.example/x', {
            method: 'POST',
            retry: false,
        });
        expect(resp.status).toBe(429);
        expect(xhrs.length).toBe(1);
    });

    it('honors the autoRetry kill switch on a 429', async () => {
        globalThis.puter = { config: { autoRetry: false } };
        const xhrs = installFakeXHR(
            sequence(respond({ status: 429, body: {} })),
        );
        const resp = await fetchUrl('https://api.example/x', {
            method: 'POST',
        });
        expect(resp.status).toBe(429);
        expect(xhrs.length).toBe(1);
    });

    it('respects the autoRetry kill switch', async () => {
        globalThis.puter = { config: { autoRetry: false } };
        const xhrs = installFakeXHR(
            sequence(respond({ status: 503, body: {} })),
        );
        const resp = await fetchUrl('https://api.example/x'); // GET, but retry off
        expect(resp.status).toBe(503);
        expect(xhrs.length).toBe(1);
    });

    it('retries a network error for a read, then rejects after the cap', async () => {
        vi.useFakeTimers();
        const xhrs = installFakeXHR(netError()); // every attempt fails
        const p = fetchUrl('https://api.example/x').catch((e) => e); // GET
        await vi.advanceTimersByTimeAsync(60_000); // clears the ~11.75s schedule
        const err = await p;
        expect(err).toBeInstanceOf(TypeError);
        expect(xhrs.length).toBe(9); // 1 initial + 8 scheduled retries
        vi.useRealTimers();
    });

    it('rejects a write network error immediately (no retry)', async () => {
        const xhrs = installFakeXHR(netError());
        await expect(
            fetchUrl('https://api.example/x', { method: 'POST' }),
        ).rejects.toThrow(/failed/);
        expect(xhrs.length).toBe(1);
    });

    it('gives up on a 2s retry when the clock jumps (sleep/drift guard)', async () => {
        // Fake only the timers, not Date — a manual `clock` drives Date.now so we
        // can simulate the machine sleeping during a 2s ceiling wait.
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
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
        expect(xhrs.length).toBe(4); // stopped after the drifted 2s wait, before attempt 5
        vi.useRealTimers();
    });
});

describe('idle timeout', () => {
    const READ_MS = 60_000;
    const LONG_MS = 15 * 60_000;
    const silent = () => {}; // never answers
    const settledWith = async (promise) => {
        try {
            return { value: await promise };
        } catch (error) {
            return { error };
        }
    };
    const PENDING = Symbol('pending');
    const peek = (promise) => Promise.race([promise, Promise.resolve(PENDING)]);

    beforeEach(() => {
        globalThis.puter = {
            authToken: 'tok',
            APIOrigin: 'https://api.example',
            env: 'nodejs',
        };
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('times out a silent read after 60 s and replays it once', async () => {
        const xhrs = installFakeXHR(silent);
        const result = settledWith(fetchUrl('https://api.example/x'));

        await vi.advanceTimersByTimeAsync(READ_MS - 1);
        expect(await peek(result)).toBe(PENDING);
        await vi.advanceTimersByTimeAsync(1);
        await vi.advanceTimersByTimeAsync(250); // backoff before the replay
        expect(xhrs.length).toBe(2);

        await vi.advanceTimersByTimeAsync(READ_MS + 10_000);
        const { error } = await result;
        expect(error).toBeInstanceOf(TypeError);
        expect(error.code).toBe('request_timeout');
        expect(xhrs.length).toBe(2);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('gives a write 15 min and never replays it', async () => {
        const xhrs = installFakeXHR(silent);
        const result = settledWith(
            fetchUrl('https://api.example/x', { method: 'POST', body: '{}' }),
        );

        await vi.advanceTimersByTimeAsync(LONG_MS - 1);
        expect(await peek(result)).toBe(PENDING);
        await vi.advanceTimersByTimeAsync(1);

        const { error } = await result;
        expect(error).toMatchObject({ code: 'request_timeout' });
        await vi.advanceTimersByTimeAsync(LONG_MS);
        expect(xhrs.length).toBe(1);
    });

    it('rejects a driver call with request_timeout and never replays it', async () => {
        const xhrs = installFakeXHR(silent);
        const result = settledWith(
            driverCall({ iface: 'puter-chat-completion', method: 'complete', args: {} }),
        );

        await vi.advanceTimersByTimeAsync(LONG_MS - 1);
        expect(await peek(result)).toBe(PENDING);
        await vi.advanceTimersByTimeAsync(1);

        expect((await result).error).toEqual({
            message: 'Request timed out.',
            code: 'request_timeout',
        });
        await vi.advanceTimersByTimeAsync(LONG_MS);
        expect(xhrs.length).toBe(1);
    });

    it('replays a timed-out readonly driver call once', async () => {
        const xhrs = installFakeXHR(silent);
        const result = settledWith(
            driverCall(
                { iface: 'puter-kvstore', method: 'get', args: { key: 'k' } },
                { readonly: true },
            ),
        );

        await vi.advanceTimersByTimeAsync(2 * READ_MS + 10_000);
        expect((await result).error).toMatchObject({ code: 'request_timeout' });
        expect(xhrs.length).toBe(2);
    });

    it('keeps a read alive while its body makes progress', async () => {
        const xhrs = installFakeXHR(silent);
        const result = settledWith(fetchUrl('https://api.example/x'));
        const [xhr] = xhrs;

        await vi.advanceTimersByTimeAsync(READ_MS - 10_000);
        xhr._setHeaders(200, { 'content-type': 'application/json' });
        xhr._headersReceived();
        for (let i = 0; i < 5; i++) {
            xhr._progress(' ');
            await vi.advanceTimersByTimeAsync(READ_MS - 10_000);
        }
        xhr.responseText = '{"ok":true}';
        xhr._done();

        expect((await result).value.status).toBe(200);
        expect(xhrs.length).toBe(1);
    });

    it('times out a read whose body stalls once progress was seen', async () => {
        const xhrs = installFakeXHR((xhr) => {
            xhr._setHeaders(200, { 'content-type': 'application/json' });
            xhr._headersReceived();
            xhr._progress('{');
        });
        const result = settledWith(fetchUrl('https://api.example/x'));

        await vi.advanceTimersByTimeAsync(READ_MS);
        expect(xhrs[0]._puterTimedOut).toBe(true);
        await vi.advanceTimersByTimeAsync(250 + READ_MS);
        expect((await result).error.code).toBe('request_timeout');
    });

    // The node/workerd shim reports no progress for a buffered body, so a
    // read can't be held to 60 s once its headers are in.
    it('moves a read to 15 min after headers until body progress is seen', async () => {
        const xhrs = installFakeXHR((xhr) => {
            xhr._setHeaders(200, { 'content-type': 'application/octet-stream' });
            xhr._headersReceived();
        });
        const result = settledWith(fetchUrl('https://api.example/big'));

        await vi.advanceTimersByTimeAsync(LONG_MS - 1);
        expect(await peek(result)).toBe(PENDING);
        expect(xhrs.length).toBe(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(xhrs[0]._puterTimedOut).toBe(true);

        // The replay finishes this time.
        await vi.advanceTimersByTimeAsync(250);
        xhrs[1].responseText = 'bytes';
        xhrs[1]._done();
        expect((await result).value.status).toBe(200);
    });

    it('gives a stream 15 min of silence before failing it', async () => {
        installFakeXHR((xhr) => {
            xhr._setHeaders(200, { 'content-type': 'application/x-ndjson' });
            xhr._headersReceived();
            xhr._progress('{"text":"a"}\n');
        });
        const response = await fetchUrl('https://api.example/stream');
        const stream = response.stream();
        expect((await stream.next()).value.text).toBe('a');

        const read = settledWith(stream.next());
        await vi.advanceTimersByTimeAsync(LONG_MS - 1);
        expect(await peek(read)).toBe(PENDING);
        await vi.advanceTimersByTimeAsync(1);
        expect((await read).error).toEqual({
            message: 'Request timed out.',
            code: 'request_timeout',
        });
    });

    it('lets upload progress reset the clock on a request with a bearer', async () => {
        const xhrs = installFakeXHR(silent);
        const result = settledWith(
            fetchUrl('https://api.example/upload', {
                method: 'POST',
                includePuterAuth: true,
                body: 'payload',
                timeout: 1000,
            }),
        );
        const [, onUpload] = xhrs[0].upload.addEventListener.mock.calls[0];

        await vi.advanceTimersByTimeAsync(900);
        onUpload();
        await vi.advanceTimersByTimeAsync(900);
        expect(await peek(result)).toBe(PENDING);
        await vi.advanceTimersByTimeAsync(100);
        expect((await result).error.code).toBe('request_timeout');
    });

    // A listener on `xhr.upload` would turn the driver call's simple CORS
    // request into a preflighted one.
    it('leaves upload progress alone on a driver call', async () => {
        const xhrs = installFakeXHR(
            respond({ body: { success: true, result: 1 } }),
        );
        await driverCall({ iface: 'puter-kvstore', method: 'get', args: {} });
        expect(xhrs[0].upload.addEventListener).not.toHaveBeenCalled();
    });

    it('turns the clock off with timeout: 0', async () => {
        installFakeXHR(silent);
        const result = settledWith(
            fetchUrl('https://api.example/x', { timeout: 0 }),
        );
        await vi.advanceTimersByTimeAsync(2 * LONG_MS);
        expect(await peek(result)).toBe(PENDING);
        expect(vi.getTimerCount()).toBe(0);
    });

    // The XHR shim marks a failed fetch DONE before dispatching `error`, and
    // has no headers to read then.
    it('settles a transport failure that reaches DONE without headers', async () => {
        globalThis.puter.config = { autoRetry: false };
        const xhrs = installFakeXHR((xhr) => {
            xhr.getResponseHeader = () => {
                throw new TypeError('no headers');
            };
            xhr._setReadyState(4);
            xhr._networkError();
        });
        const result = settledWith(fetchUrl('https://api.example/x'));
        expect((await result).error).toBeInstanceOf(TypeError);
        expect(xhrs.length).toBe(1);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('clears the clock when a request settles', async () => {
        installFakeXHR(respond({ body: { ok: true } }));
        await fetchUrl('https://api.example/x');
        expect(vi.getTimerCount()).toBe(0);
    });

    it('clears the clock when a request is cancelled', async () => {
        installFakeXHR(silent);
        const controller = new AbortController();
        const result = settledWith(
            fetchUrl('https://api.example/x', { signal: controller.signal }),
        );
        controller.abort();
        expect((await result).error).toMatchObject({ name: 'AbortError' });
        expect(vi.getTimerCount()).toBe(0);
    });
});

describe('abort listeners on a reused signal', () => {
    /** An AbortSignal that counts its live `abort` listeners. */
    const trackedSignal = () => {
        const signal = new AbortController().signal;
        const live = new Set();
        const add = signal.addEventListener.bind(signal);
        const remove = signal.removeEventListener.bind(signal);
        signal.addEventListener = (type, fn, opts) => {
            if (type === 'abort') live.add(fn);
            add(type, fn, opts);
        };
        signal.removeEventListener = (type, fn, opts) => {
            if (type === 'abort') live.delete(fn);
            remove(type, fn, opts);
        };
        return { signal, live };
    };

    beforeEach(() => {
        globalThis.puter = {};
    });

    it('removes every listener once a retried request settles', async () => {
        vi.useFakeTimers();
        const { signal, live } = trackedSignal();
        installFakeXHR(
            sequence(
                respond({ status: 503, body: {} }),
                respond({ status: 503, body: {} }),
                respond({ status: 200, body: {} }),
                respond({ status: 503, body: {} }),
                respond({ status: 200, body: {} }),
            ),
        );
        for (let i = 0; i < 2; i++) {
            const p = fetchUrl('https://api.example/x', { signal });
            await vi.advanceTimersByTimeAsync(60_000);
            expect((await p).status).toBe(200);
        }
        expect(live.size).toBe(0);
        vi.useRealTimers();
    });

    it('still aborts a retry wait', async () => {
        vi.useFakeTimers();
        const controller = new AbortController();
        const xhrs = installFakeXHR(respond({ status: 503, body: {} }));
        const p = fetchUrl('https://api.example/x', {
            signal: controller.signal,
        });
        let error;
        try {
            await vi.advanceTimersByTimeAsync(100);
            controller.abort();
            await p;
        } catch (e) {
            error = e;
        }
        expect(error).toMatchObject({ name: 'AbortError' });
        expect(xhrs.length).toBe(1);
        vi.useRealTimers();
    });
});

describe('parseResponse', () => {
    const blobXhr = ({ status = 200, contentType = null, body = '' }) => ({
        responseType: 'blob',
        status,
        response: new Blob([body]),
        getResponseHeader: (name) =>
            name.toLowerCase() === 'content-type' ? contentType : null,
    });

    it('returns the body of a success that declares no content type', async () => {
        const xhr = blobXhr({ body: 'bytes' });
        expect(await parseResponse(xhr)).toBe(xhr.response);
    });

    it('reads an error body that declares no content type', async () => {
        expect(
            await parseResponse(
                blobXhr({ status: 502, body: '{"code":"bad_gateway"}' }),
            ),
        ).toEqual({ code: 'bad_gateway' });
        expect(
            await parseResponse(blobXhr({ status: 502, body: 'Bad Gateway' })),
        ).toBe('Bad Gateway');
    });

    it('keeps the typed blob branches', async () => {
        const octet = blobXhr({ contentType: 'application/octet-stream' });
        expect(await parseResponse(octet)).toBe(octet.response);
        const png = blobXhr({ contentType: 'image/png' });
        expect(await parseResponse(png)).toEqual({
            success: true,
            result: png.response,
        });
    });
});

describe('dedupe', () => {
    it('coalesces concurrent identical requests into one call', async () => {
        let calls = 0;
        const factory = () => {
            calls++;
            return new Promise((r) => setTimeout(() => r({ v: calls }), 5));
        };
        const [a, b] = await Promise.all([
            dedupe('k', factory),
            dedupe('k', factory),
        ]);
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
        const factory = () =>
            new Promise((r) => setTimeout(() => r(++calls), 5));
        await Promise.all([dedupe('a', factory), dedupe('b', factory)]);
        expect(calls).toBe(2);
    });
});

describe('driverCall', () => {
    const call = { iface: 'puter-kvstore', method: 'get', args: { key: 'k' } };

    beforeEach(() => {
        globalThis.puter = {
            authToken: 'tok',
            APIOrigin: 'https://api.example',
            env: 'nodejs',
        };
    });

    it('posts the driver envelope and resolves the unwrapped result', async () => {
        const xhrs = installFakeXHR(
            respond({ body: { success: true, result: 'v' } }),
        );
        const result = await driverCall(call);
        expect(result).toBe('v');
        expect(xhrs[0].method).toBe('POST');
        expect(xhrs[0].url).toBe('https://api.example/drivers/call');
        expect(xhrs[0]._reqHeaders['content-type']).toBe(
            'text/plain;actually=json',
        );
        expect(JSON.parse(xhrs[0].reqBody)).toEqual({
            interface: 'puter-kvstore',
            method: 'get',
            args: { key: 'k' },
            auth_token: 'tok',
        });
    });

    it('sends driver and test_mode only when the caller sets them', async () => {
        const xhrs = installFakeXHR(
            respond({ body: { success: true, result: {} } }),
        );
        await driverCall({ ...call, driver: 'ai-chat', testMode: false });
        expect(JSON.parse(xhrs[0].reqBody)).toMatchObject({
            driver: 'ai-chat',
            test_mode: false,
        });
    });

    it('resolves a blob response that declares no content type', async () => {
        installFakeXHR((xhr) => {
            xhr._setHeaders(200);
            xhr._headersReceived();
            xhr.response = new Blob(['image']);
            xhr._done();
        });
        const result = await driverCall(
            { iface: 'puter-image-generation', method: 'generate', args: {} },
            { responseType: 'blob' },
        );
        expect(result).toBeInstanceOf(Blob);
    });

    it('resolves the whole response when the driver returns no result field', async () => {
        installFakeXHR(respond({ body: { success: true, models: [] } }));
        expect(await driverCall(call)).toEqual({ success: true, models: [] });
    });

    it('applies transform to a successful result', async () => {
        installFakeXHR(respond({ body: { success: true, result: 2 } }));
        const result = await driverCall(call, {
            transform: async (n) => n * 21,
        });
        expect(result).toBe(42);
    });

    it('rejects the driver error payload and notifies onError', async () => {
        installFakeXHR(
            respond({
                body: { success: false, error: { code: 'key_too_large' } },
            }),
        );
        const onError = vi.fn();
        await expect(driverCall(call, { onError })).rejects.toEqual({
            success: false,
            error: { code: 'key_too_large' },
        });
        expect(onError).toHaveBeenCalledWith({
            success: false,
            error: { code: 'key_too_large' },
        });
    });

    it('rejects a leftover 401 as Unauthorized', async () => {
        installFakeXHR(respond({ status: 401, body: {} }));
        await expect(driverCall(call)).rejects.toEqual({
            status: 401,
            message: 'Unauthorized',
        });
    });

    it('rejects auth_canceled when a signed-out visitor dismisses the prompt', async () => {
        globalThis.puter = {
            authToken: null,
            APIOrigin: 'https://api.example',
            env: 'web',
            ui: {
                authenticateWithPuter: async () => {
                    throw new Error('dismissed');
                },
            },
        };
        const xhrs = installFakeXHR(
            respond({ body: { success: true, result: 'v' } }),
        );
        await expect(driverCall(call)).rejects.toEqual({
            error: {
                code: 'auth_canceled',
                message: 'Authentication canceled',
            },
        });
        expect(xhrs.length).toBe(0); // no request without a token
    });

    it('resolves an NDJSON response as an iterator of lines that stringify to their text', async () => {
        installFakeXHR((xhr) => {
            xhr._setHeaders(200, { 'content-type': 'application/x-ndjson' });
            xhr._headersReceived();
            xhr._progress('{"text":"he"}\n{"text":"llo"}\n');
            xhr._done();
        });
        const parts = [];
        for await (const part of await driverCall(call)) parts.push(`${part}`);
        expect(parts).toEqual(['he', 'llo']);
    });

    it('retries a readonly method on a transient failure', async () => {
        vi.useFakeTimers();
        const xhrs = installFakeXHR(
            sequence(
                respond({ status: 503, body: {} }),
                respond({ body: { success: true, result: 'v' } }),
            ),
        );
        const p = driverCall(call, { readonly: true });
        await vi.advanceTimersByTimeAsync(60_000);
        await expect(p).resolves.toBe('v');
        expect(xhrs.length).toBe(2);
        vi.useRealTimers();
    });

    describe('upgrade prompts inside an app', () => {
        let requestUpgrade;
        beforeEach(() => {
            // The desktop opens its upgrade window and never answers the
            // callback, which is what a real desktop does.
            requestUpgrade = vi.fn(() => new Promise(() => {}));
            globalThis.puter = {
                authToken: 'tok',
                APIOrigin: 'https://api.example',
                env: 'app',
                ui: { requestUpgrade },
            };
        });

        it('reports a plan-gated 402 with the method and its own wording, then rejects', async () => {
            installFakeXHR(
                respond({
                    status: 402,
                    body: {
                        error: 'A subscription is required for this action',
                        message: 'A subscription is required for this action',
                        code: 'subscription_required',
                        subscription: 'free',
                    },
                }),
            );
            await expect(
                driverCall(call, {
                    upgradePrompt: {
                        method: 'puter.kv.get',
                        subscriptionMessage: 'Reading keys requires a subscription.',
                    },
                }),
            ).rejects.toMatchObject({ code: 'subscription_required' });
            expect(requestUpgrade).toHaveBeenCalledWith({
                reason: 'subscription',
                method: 'puter.kv.get',
                message: 'Reading keys requires a subscription.',
            });
        });

        it('names an unannotated method by its wire interface and method', async () => {
            installFakeXHR(
                respond({
                    status: 402,
                    body: { code: 'insufficient_funds', message: 'Insufficient credits' },
                }),
            );
            await expect(driverCall(call)).rejects.toMatchObject({
                code: 'insufficient_funds',
            });
            expect(requestUpgrade).toHaveBeenCalledWith({
                reason: 'funds',
                method: 'puter-kvstore::get',
                message:
                    'Your account does not have enough funding to complete this request.',
            });
        });

        it('still prompts on a 200 driver envelope that carries the refusal', async () => {
            installFakeXHR(
                respond({
                    body: {
                        success: false,
                        error: { code: 'insufficient_funds', message: 'x' },
                    },
                }),
            );
            await expect(driverCall(call)).rejects.toMatchObject({
                success: false,
            });
            expect(requestUpgrade).toHaveBeenCalledTimes(1);
            expect(requestUpgrade.mock.calls[0][0].reason).toBe('funds');
        });

        it('prompts once per refused stream line without stalling the stream', async () => {
            installFakeXHR((xhr) => {
                xhr._setHeaders(200, {
                    'content-type': 'application/x-ndjson',
                });
                xhr._headersReceived();
                xhr._progress(
                    '{"text":"he"}\n{"error":{"code":"insufficient_funds"}}\n{"text":"llo"}\n',
                );
                xhr._done();
            });
            const parts = [];
            for await (const part of await driverCall(call)) parts.push(part);
            expect(parts).toHaveLength(3);
            expect(requestUpgrade).toHaveBeenCalledTimes(1);
        });

        it('leaves other failures alone', async () => {
            installFakeXHR(
                respond({ status: 403, body: { code: 'forbidden' } }),
            );
            await expect(driverCall(call)).rejects.toMatchObject({
                code: 'forbidden',
            });
            expect(requestUpgrade).not.toHaveBeenCalled();
        });

        it('resolves a completion cut short by the balance, and prompts', async () => {
            installFakeXHR(
                respond({
                    body: {
                        success: true,
                        result: { message: { content: 'partial' } },
                        metadata: { usage_limited: true },
                    },
                }),
            );
            await expect(driverCall(call)).resolves.toEqual({
                message: { content: 'partial' },
            });
            expect(requestUpgrade).toHaveBeenCalledTimes(1);
            expect(requestUpgrade.mock.calls[0][0].reason).toBe('funds');
        });

        it('prompts on a stream whose usage line says the balance ran out', async () => {
            installFakeXHR((xhr) => {
                xhr._setHeaders(200, {
                    'content-type': 'application/x-ndjson',
                });
                xhr._headersReceived();
                xhr._progress(
                    '{"type":"text","text":"part"}\n{"type":"usage","usage":{"output_tokens":9},"metadata":{"usage_limited":true}}\n',
                );
                xhr._done();
            });
            const parts = [];
            for await (const part of await driverCall(call)) parts.push(part);
            expect(parts).toHaveLength(2);
            expect(requestUpgrade).toHaveBeenCalledTimes(1);
        });

        it('waits out a credits_reserved 429 without prompting', async () => {
            vi.useFakeTimers();
            const xhrs = installFakeXHR(
                sequence(
                    respond({
                        status: 429,
                        body: {
                            code: 'too_many_requests',
                            errorCode: 'credits_reserved',
                        },
                    }),
                    respond({ body: { success: true, result: 'v' } }),
                ),
            );
            const p = driverCall(call);
            await vi.advanceTimersByTimeAsync(1000);
            expect(await p).toBe('v');
            expect(xhrs.length).toBe(2);
            expect(requestUpgrade).not.toHaveBeenCalled();
            vi.useRealTimers();
        });
    });
});

describe('driverCallEnvelope', () => {
    const call = { iface: 'ipgeo', method: 'ipgeo', args: { ip: '1.2.3.4' } };

    beforeEach(() => {
        globalThis.puter = {
            authToken: 'tok',
            APIOrigin: 'https://api.example',
            env: 'nodejs',
        };
    });

    it('resolves the envelope as the backend sent it', async () => {
        installFakeXHR(
            respond({ body: { success: true, result: { country: 'US' } } }),
        );
        expect(await driverCallEnvelope(call)).toEqual({
            success: true,
            result: { country: 'US' },
        });
    });

    it('resolves rather than rejects on a driver-level failure', async () => {
        installFakeXHR(
            respond({ body: { success: false, error: { code: 'not_found' } } }),
        );
        expect(await driverCallEnvelope(call)).toEqual({
            success: false,
            error: { code: 'not_found' },
        });
    });

    it('reads a response with no declared content type as JSON', async () => {
        installFakeXHR((xhr) => {
            xhr._setHeaders(200);
            xhr._headersReceived();
            xhr.responseText = '{"success":true,"result":[1,2]}';
            xhr._done();
        });
        expect(await driverCallEnvelope(call)).toEqual({
            success: true,
            result: [1, 2],
        });
    });

    it('throws on a content type it cannot read', async () => {
        installFakeXHR(respond({ contentType: 'text/html', body: '<html>' }));
        await expect(driverCallEnvelope(call)).rejects.toThrow(
            'unrecognized content type: text/html',
        );
    });
});

describe('driverLineStream', () => {
    const fakePuter = { env: 'node' };

    const collect = async (lines) => {
        const out = [];
        for await (const line of driverLineStream(lines, fakePuter, {})) {
            out.push(line);
        }
        return out;
    };

    it('gives a text chunk a toString() that returns its text', async () => {
        const [line] = await collect([{ type: 'text', text: 'hello' }]);
        expect(String(line)).toBe('hello');
        expect(Object.keys(line)).toEqual(['type', 'text']); // toString stays non-enumerable
    });

    it.each([
        'reasoning_start',
        'reasoning_detail',
        'tool_use_start',
        'tool_input_delta',
        'server_tool',
        'safeguard_results',
    ])('gives a %s chunk a toString() that returns empty string', async (type) => {
        const [line] = await collect([{ type, extra: 'payload' }]);
        expect(String(line)).toBe('');
    });

    it('leaves an unrecognized chunk type with the default Object toString', async () => {
        const [line] = await collect([{ type: 'usage', usage: {} }]);
        expect(String(line)).toBe('[object Object]');
    });
});


describe('NDJSON stream termination', () => {
    const start = async (signal) => {
        const xhrs = installFakeXHR((xhr) => {
            xhr._setHeaders(200, { 'content-type': 'application/x-ndjson' });
            xhr._headersReceived();
            xhr._progress('{"type":"text","text":"partial"}\n');
        });
        const response = await fetchUrl('https://api.example/stream', { signal });
        const stream = response.stream();
        expect((await stream.next()).value.text).toBe('partial');
        return { xhr: xhrs[0], stream };
    };

    it('rejects a pending read when the transport fails after headers', async () => {
        const { xhr, stream } = await start();
        const read = stream.next();
        xhr._networkError();
        await expect(read).rejects.toMatchObject({ code: 'network_error' });
    });

    it('rejects a pending read on cancellation after headers', async () => {
        const controller = new AbortController();
        const { stream } = await start(controller.signal);
        const read = stream.next();
        controller.abort();
        await expect(read).rejects.toMatchObject({ name: 'AbortError' });
    });

    it('aborts the request when the consumer stops iteration', async () => {
        const { xhr, stream } = await start();
        const abort = vi.spyOn(xhr, 'abort');
        await stream.return();
        expect(abort).toHaveBeenCalledOnce();
    });
    it('cancels a ReadableStream adapter while its pump is waiting', async () => {
        const { xhr, stream: lines } = await start();
        const stream = driverLineStream(lines, {}, undefined);
        const readable = new ReadableStream(stream);
        const reader = readable.getReader();
        const abort = vi.spyOn(xhr, 'abort');
        await reader.cancel();
        expect(abort).toHaveBeenCalledOnce();
        expect((await reader.read()).done).toBe(true);
    });
    it('errors the ReadableStream adapter on a transport failure', async () => {
        const { xhr, stream: lines } = await start();
        const reader = new ReadableStream(driverLineStream(lines, {}, undefined)).getReader();
        const read = reader.read();
        xhr._networkError();
        await expect(read).rejects.toMatchObject({ code: 'network_error' });
    });
    it('rejects a pending read on timeout after headers', async () => {
        const { xhr, stream } = await start();
        const read = stream.next();
        xhr.dispatchEvent(new Event('timeout'));
        await expect(read).rejects.toMatchObject({ code: 'request_timeout' });
    });

});
