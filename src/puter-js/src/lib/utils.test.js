import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initXhr, makeDriverMethod, setupXhrEventHandlers } from './utils.js';

/**
 * Pins the callback contract of `makeDriverMethod`: driver methods are
 * promise-only. A legacy `error` callback is honored, a legacy `success`
 * callback is consumed but never invoked, and neither ever reaches the wire.
 *
 * The success drop is deliberate, not an oversight — it has never fired, so
 * invoking it now would start double-running handlers in apps that pass one and
 * also await the promise. `puter.fs.*` has its own working implementation
 * (`modules/FileSystem/operations/scaffold.js`) and is unaffected.
 */

// Minimal XHR fake: replays one driver-layer response for every request.
function installFakeXHR (respObj) {
    const requests = [];
    class FakeXHR {
        _listeners = {};
        responseType = '';
        status = 200;
        open (method, url) { this.method = method; this.url = url; }
        setRequestHeader () {}
        addEventListener (type, fn) { (this._listeners[type] ??= []).push(fn); }
        getResponseHeader () { return null; }
        send (body) {
            requests.push(this);
            this.requestBody = body;
            queueMicrotask(() => {
                this.responseText = JSON.stringify(respObj);
                for ( const fn of this._listeners.load ?? [] ) fn.call(this, { target: this });
            });
        }
    }
    globalThis.XMLHttpRequest = FakeXHR;
    return requests;
}

const wireArgs = requests => JSON.parse(requests.at(-1).requestBody).args;

const ok = { success: true, result: 'the-result' };
const driverError = { success: false, error: { code: 'nope' } };

let savedXHR;
beforeEach(() => {
    savedXHR = globalThis.XMLHttpRequest;
    globalThis.puter = { authToken: 'tok', APIOrigin: 'https://api.test', env: 'nodejs' };
});
afterEach(() => {
    globalThis.XMLHttpRequest = savedXHR;
    delete globalThis.puter;
    vi.restoreAllMocks();
});

const makeMethod = () => makeDriverMethod({
    iface: 'test-iface', driver: 'test-driver', method: 'doThing', argNames: ['key'],
});

describe('makeDriverMethod legacy callbacks', () => {
    describe('positional form', () => {
        it('resolves the driver result without invoking a success callback', async () => {
            const requests = installFakeXHR(ok);
            const success = vi.fn();

            await expect(makeMethod()('k', success)).resolves.toBe('the-result');

            expect(success).not.toHaveBeenCalled();
            expect(wireArgs(requests)).toEqual({ key: 'k' });
        });

        it('invokes the error callback that follows the success slot', async () => {
            installFakeXHR(driverError);
            const success = vi.fn();
            const error = vi.fn();

            await expect(makeMethod()('k', success, error)).rejects.toEqual(driverError);

            expect(error).toHaveBeenCalledWith(driverError);
            expect(success).not.toHaveBeenCalled();
        });

        it('still finds the error callback when the success slot is empty', async () => {
            installFakeXHR(driverError);
            const error = vi.fn();

            await expect(makeMethod()('k', undefined, error)).rejects.toEqual(driverError);

            expect(error).toHaveBeenCalledWith(driverError);
        });
    });

    describe('named-parameters form', () => {
        it('resolves the driver result without invoking a success callback', async () => {
            const requests = installFakeXHR(ok);
            const success = vi.fn();

            await expect(makeMethod()({ key: 'k', success })).resolves.toBe('the-result');

            expect(success).not.toHaveBeenCalled();
            // Callbacks must never be serialized into the request.
            expect(wireArgs(requests)).toEqual({ key: 'k' });
        });

        it('invokes the error callback and keeps both callbacks off the wire', async () => {
            const requests = installFakeXHR(driverError);
            const success = vi.fn();
            const error = vi.fn();

            await expect(makeMethod()({ key: 'k', success, error })).rejects.toEqual(driverError);

            expect(error).toHaveBeenCalledWith(driverError);
            expect(success).not.toHaveBeenCalled();
            expect(wireArgs(requests)).toEqual({ key: 'k' });
        });
    });
});

describe('setupXhrEventHandlers', () => {
    it('settles a blob read whose response declares no content type', async () => {
        const listeners = {};
        const xhr = {
            responseType: 'blob',
            status: 200,
            response: new Blob(['bytes']),
            getResponseHeader: () => null,
            addEventListener: (type, fn) => { listeners[type] = fn; },
        };
        const result = new Promise((resolve, reject) => {
            setupXhrEventHandlers(xhr, undefined, undefined, resolve, reject);
        });
        listeners.load.call(xhr, { target: xhr });
        const pending = new Promise(resolve => setTimeout(() => resolve('pending'), 100));
        expect(await Promise.race([result, pending])).toBe(xhr.response);
    });
});

describe('legacy request idle timeout', () => {
    // An XHR that is sent but never answered.
    class SilentXHR extends EventTarget {
        readyState = 0;
        upload = { addEventListener () {} };
        open () { this.readyState = 1; }
        setRequestHeader () {}
        getResponseHeader () { return null; }
        send () {}
        abort () { this.dispatchEvent(new Event('abort')); }
    }

    beforeEach(() => {
        vi.useFakeTimers();
        globalThis.XMLHttpRequest = SilentXHR;
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it.each(['post', 'get'])('rejects a silent %s with request_timeout after 15 min', async (method) => {
        const onError = vi.fn();
        let outcome;
        const xhr = initXhr('/stat', 'https://api.test', 'tok', method);
        const request = new Promise((resolve, reject) => {
            setupXhrEventHandlers(xhr, undefined, onError, resolve, reject);
        });
        (async () => {
            try {
                outcome = { value: await request };
            } catch (error) {
                outcome = { error };
            }
        })();
        xhr.send('{}');

        await vi.advanceTimersByTimeAsync(15 * 60_000 - 1);
        expect(outcome).toBeUndefined();
        await vi.advanceTimersByTimeAsync(1);

        const error = { message: 'Request timed out.', code: 'request_timeout' };
        expect(outcome).toEqual({ error });
        expect(onError).toHaveBeenCalledOnce();
        expect(onError).toHaveBeenCalledWith(error);
        expect(vi.getTimerCount()).toBe(0);
    });
});
