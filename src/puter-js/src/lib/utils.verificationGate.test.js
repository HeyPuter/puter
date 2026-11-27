import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initXhr, setupXhrEventHandlers } from './utils.js';

/**
 * A filesystem request refused by a 403 account-verification gate asks the
 * hosting desktop to walk the user through it, then replays once. A website
 * opens the sign-in window for a gate set on the account. Everywhere else, and
 * whenever the user backs out, the refusal reaches the caller as-is.
 */

// Minimal XHR fake: answers each request from a queue of { status, body }.
function installFakeXHR (responses) {
    const requests = [];
    class FakeXHR {
        _listeners = {};
        responseType = '';
        status = 200;
        open (method, url) { this.method = method; this.url = url; }
        headers = {};
        setRequestHeader (name, value) { this.headers[name] = value; }
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
// Set on the account itself, so it names no factors.
const accountGate = {
    status: 403,
    body: {
        code: 'phone_verification_required',
        message: 'Please verify your phone number to continue',
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

    it('asks for each gate, rather than sharing one answer between them', async () => {
        const emailGate = {
            status: 403,
            body: {
                code: 'email_confirmation_required',
                message: 'Please confirm your email to continue',
            },
        };
        // Two requests, two different gates, in flight together.
        installFakeXHR([emailGate, gate, ok, ok]);
        await Promise.all([send(), send()]);

        const asked = puter.ui.requestVerificationGate.mock.calls.map(
            (c) => c[0],
        );
        expect(new Set(asked)).toEqual(
            new Set([
                'email_confirmation_required',
                'phone_verification_required',
            ]),
        );
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

    it('replays with no bearer when the user signed out during the gate', async () => {
        puter.ui.requestVerificationGate.mockImplementation(async () => {
            puter.authToken = null;
            return true;
        });
        const requests = installFakeXHR([gate, ok]);
        await send();
        expect(requests[0].headers.Authorization).toBe('Bearer tok');
        expect(requests[1].headers.Authorization).toBeUndefined();
    });

    it('does not prompt in an environment with no window to show', async () => {
        globalThis.puter.env = 'worker';
        installFakeXHR([accountGate]);
        await expect(send()).rejects.toMatchObject(accountGate.body);
        expect(puter.ui.requestVerificationGate).not.toHaveBeenCalled();
    });

    it('leaves other 403s alone', async () => {
        installFakeXHR([{ status: 403, body: { code: 'forbidden' } }]);
        await expect(send()).rejects.toMatchObject({ code: 'forbidden' });
        expect(puter.ui.requestVerificationGate).not.toHaveBeenCalled();
    });
});

describe('verification gate on a website', () => {
    let clock = Date.parse('2026-11-26T00:00:00Z');
    beforeEach(() => {
        // Each test starts past the quiet period an earlier one began.
        clock += 10 * 60_000;
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(clock);
        Object.assign(globalThis.puter, {
            env: 'web',
            whoami: { uuid: 'user-a' },
            getUser: vi.fn(async () => ({ uuid: 'user-a' })),
            auth: { signIn: vi.fn(async () => ({ success: true })) },
        });
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('opens the sign-in window for a gate on the account and replays once cleared', async () => {
        const requests = installFakeXHR([accountGate, ok]);
        await expect(send()).resolves.toMatchObject({ status: 'success' });
        expect(puter.auth.signIn).toHaveBeenCalledWith();
        expect(puter.ui.requestVerificationGate).not.toHaveBeenCalled();
        expect(requests).toHaveLength(2);
    });

    it('replays with the token the sign-in handed back', async () => {
        puter.auth.signIn.mockImplementation(async () => {
            puter.authToken = 'fresh';
        });
        const requests = installFakeXHR([accountGate, ok]);
        await send();
        expect(requests[1].headers.Authorization).toBe('Bearer fresh');
    });

    it('does not replay when the window signed another account in', async () => {
        puter.getUser.mockResolvedValue({ uuid: 'user-b' });
        const requests = installFakeXHR([accountGate]);
        await expect(send()).rejects.toMatchObject(accountGate.body);
        expect(requests).toHaveLength(1);
    });

    it('opens nothing when it does not know whose call was refused', async () => {
        puter.whoami = undefined;
        installFakeXHR([accountGate]);
        await expect(send()).rejects.toMatchObject(accountGate.body);
        expect(puter.auth.signIn).not.toHaveBeenCalled();
    });

    it('opens one window for requests refused together, whichever gate each met', async () => {
        const cardGate = {
            status: 403,
            body: { code: 'card_verification_required', message: 'Card' },
        };
        installFakeXHR([accountGate, cardGate, ok, ok]);
        await Promise.all([send(), send()]);
        expect(puter.auth.signIn).toHaveBeenCalledTimes(1);
    });

    it('opens nothing for an unconfirmed email', async () => {
        const emailGate = {
            status: 403,
            body: { code: 'email_confirmation_required', message: 'Email' },
        };
        installFakeXHR([emailGate]);
        await expect(send()).rejects.toMatchObject(emailGate.body);
        expect(puter.auth.signIn).not.toHaveBeenCalled();
    });

    it('opens nothing for a route that asks for a verified factor', async () => {
        installFakeXHR([gate]);
        await expect(send()).rejects.toMatchObject(gate.body);
        expect(puter.auth.signIn).not.toHaveBeenCalled();
    });

    it('opens nothing on a cross-origin isolated page', async () => {
        vi.stubGlobal('crossOriginIsolated', true);
        installFakeXHR([accountGate]);
        await expect(send()).rejects.toMatchObject(accountGate.body);
        expect(puter.auth.signIn).not.toHaveBeenCalled();
    });

    it('opens nothing for a request that may not prompt', async () => {
        installFakeXHR([accountGate]);
        const refused = new Promise((resolve, reject) => {
            const xhr = initXhr('/share', 'https://api.test', 'tok');
            xhr._puterReq.interactiveReauth = false;
            setupXhrEventHandlers(xhr, undefined, undefined, resolve, reject);
            xhr.send('{}');
        });
        await expect(refused).rejects.toMatchObject(accountGate.body);
        expect(puter.auth.signIn).not.toHaveBeenCalled();
    });

    it('rejects with the refusal when the user closes the window, then stays quiet for a minute', async () => {
        puter.auth.signIn.mockRejectedValue({ error: 'auth_window_closed' });
        installFakeXHR([accountGate, accountGate, accountGate, ok]);
        await expect(send()).rejects.toMatchObject(accountGate.body);
        await expect(send()).rejects.toMatchObject(accountGate.body);
        expect(puter.auth.signIn).toHaveBeenCalledTimes(1);

        vi.setSystemTime(clock + 61_000);
        puter.auth.signIn.mockResolvedValue({ success: true });
        await expect(send()).resolves.toMatchObject({ status: 'success' });
        expect(puter.auth.signIn).toHaveBeenCalledTimes(2);
    });

    it('stays quiet for a minute after a window that cleared nothing', async () => {
        // Sign-in completes, the replay is refused again, and so is the next call.
        installFakeXHR([accountGate, accountGate, accountGate]);
        await expect(send()).rejects.toMatchObject(accountGate.body);
        await expect(send()).rejects.toMatchObject(accountGate.body);
        expect(puter.auth.signIn).toHaveBeenCalledTimes(1);
    });
});
