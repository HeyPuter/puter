import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initXhr, setupXhrEventHandlers } from './utils.js';

/**
 * A filesystem request refused by a 403 account-verification gate asks the
 * hosting desktop to walk the user through it, then replays once. Everywhere
 * else, and whenever the user backs out, the refusal reaches the caller as-is.
 */

// Minimal XHR fake: answers each request from a queue of { status, body }.
function installFakeXHR (responses) {
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
    const xhr = initXhr('/share', 'https://api.test', 'tok');
    setupXhrEventHandlers(xhr, undefined, undefined, resolve, reject);
    xhr.send('{}');
});

const gate = {
    status: 403,
    body: {
        code: 'phone_verification_required',
        message: 'Please verify your phone number to continue',
        factors: ['phone', 'card'],
    },
};
const ok = { status: 200, body: { status: 'success', results: [] } };

let savedXHR;
beforeEach(() => {
    savedXHR = globalThis.XMLHttpRequest;
    globalThis.puter = {
        authToken: 'tok',
        APIOrigin: 'https://api.test',
        env: 'app',
        ui: { requestVerificationGate: vi.fn(async () => true) },
    };
});
afterEach(() => {
    globalThis.XMLHttpRequest = savedXHR;
    delete globalThis.puter;
    vi.restoreAllMocks();
});

describe('verification gate on a filesystem request', () => {
    it('asks the desktop with the accepted factors and replays once cleared', async () => {
        const requests = installFakeXHR([gate, ok]);
        await expect(send()).resolves.toMatchObject({ status: 'success' });
        expect(puter.ui.requestVerificationGate).toHaveBeenCalledWith(
            'phone_verification_required',
            { factors: ['phone', 'card'] },
        );
        expect(requests).toHaveLength(2);
    });

    it('rejects with the refusal unchanged when the user backs out', async () => {
        puter.ui.requestVerificationGate.mockResolvedValue(false);
        const requests = installFakeXHR([gate]);
        await expect(send()).rejects.toMatchObject(gate.body);
        expect(requests).toHaveLength(1);
    });

    it('replays once, and does not prompt again for a refused replay', async () => {
        const requests = installFakeXHR([gate, gate]);
        await expect(send()).rejects.toMatchObject({ code: 'phone_verification_required' });
        expect(requests).toHaveLength(2);
        expect(puter.ui.requestVerificationGate).toHaveBeenCalledTimes(1);
    });

    it('does not prompt outside the desktop', async () => {
        globalThis.puter.env = 'web';
        installFakeXHR([gate]);
        await expect(send()).rejects.toMatchObject(gate.body);
        expect(puter.ui.requestVerificationGate).not.toHaveBeenCalled();
    });

    it('leaves other 403s alone', async () => {
        installFakeXHR([{ status: 403, body: { code: 'forbidden' } }]);
        await expect(send()).rejects.toMatchObject({ code: 'forbidden' });
        expect(puter.ui.requestVerificationGate).not.toHaveBeenCalled();
    });
});
