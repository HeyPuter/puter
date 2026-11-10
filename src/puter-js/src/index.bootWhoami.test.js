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
vi.mock('./lib/polyfills/localStorage.js', () => ({ default: {} }));
vi.mock('./lib/polyfills/xhrshim.js', () => ({ default: class {} }));

const origDefine = customElements.define.bind(customElements);
customElements.define = (name, cls) =>
    customElements.get(name) || origDefine(name, cls);

const USERS = {
    'tok-a': { uuid: 'u-a', username: 'alice' },
    'tok-b': { uuid: 'u-b', username: 'bob' },
};

/** Every `/whoami` sent, held until `answer()` replies to it. */
const whoamis = [];

class HeldXHR {
    _listeners = {};
    _headers = {};
    status = 0;
    readyState = 0;
    responseType = '';
    upload = { addEventListener() {} };
    open(method, url) {
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
    send() {
        if (!this.url.endsWith('/whoami')) return;
        const token = this._headers.authorization?.replace(/^Bearer /, '');
        whoamis.push({ token, xhr: this, answered: false });
    }
    reply(status, body) {
        this.status = status;
        this.responseText = JSON.stringify(body);
        this.response = this.responseText;
        this.readyState = 4;
        for (const fn of this._listeners.readystatechange ?? []) fn.call(this);
        for (const fn of this._listeners.load ?? [])
            fn.call(this, { target: this });
    }
}

const flush = async () => {
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};

/** Replies to every unanswered `/whoami`, as the server would for its token. */
const answer = async ({ refuse = false } = {}) => {
    for (const req of whoamis.filter((r) => !r.answered)) {
        req.answered = true;
        const user = USERS[req.token];
        if (user && !refuse) req.xhr.reply(200, { ...user });
        else req.xhr.reply(401, { code: 'token_auth_failed' });
    }
    await flush();
};

/** Fails every unanswered `/whoami` as a network error, without waiting. */
const failNetwork = () => {
    for (const req of whoamis.filter((r) => !r.answered)) {
        req.answered = true;
        req.xhr.readyState = 4;
        for (const fn of req.xhr._listeners.error ?? []) fn.call(req.xhr);
    }
};

const origParent = Object.getOwnPropertyDescriptor(globalThis, 'parent');
const origXHR = globalThis.XMLHttpRequest;

beforeEach(() => {
    localStorage.clear();
    whoamis.length = 0;
    Object.defineProperty(globalThis, 'parent', {
        value: globalThis,
        configurable: true,
    });
    globalThis.XMLHttpRequest = HeldXHR;
});
afterEach(() => {
    if (origParent) Object.defineProperty(globalThis, 'parent', origParent);
    globalThis.XMLHttpRequest = origXHR;
    vi.restoreAllMocks();
});

/** The SDK's own instance, booted as a top-level web page with no token. */
const bootWeb = async () => {
    history.replaceState(null, '', '/site/index.html');
    vi.resetModules();
    const realProcess = globalThis.process;
    Object.defineProperty(globalThis, 'process', {
        configurable: true,
        get() {
            const caller = (new Error().stack ?? '').split('\n')[2] ?? '';
            return /src\/index\.js:\d+/.test(caller) ? undefined : realProcess;
        },
    });
    try {
        const { puter } = await import('./index.js');
        expect(puter.env).toBe('web');
        return puter;
    } finally {
        Object.defineProperty(globalThis, 'process', {
            value: realProcess,
            configurable: true,
            writable: true,
        });
    }
};

describe.each([
    ['puter.auth.getUser()', (puter) => puter.auth.getUser()],
    ['puter.auth.whoami()', (puter) => puter.auth.whoami()],
    ['puter.getUser()', (puter) => puter.getUser()],
])('%s', (_label, readUser) => {
    it('joins the boot lookup instead of sending its own', async () => {
        const puter = await bootWeb();
        puter.setAuthToken('tok-a');
        const user = readUser(puter);
        await flush();
        expect(whoamis.map((r) => r.token)).toEqual(['tok-a']);

        await answer();
        await expect(user).resolves.toEqual(USERS['tok-a']);
        expect(whoamis).toHaveLength(1);
    });

    it('hands each caller its own copy of the user', async () => {
        const puter = await bootWeb();
        puter.setAuthToken('tok-a');
        const first = readUser(puter);
        const second = readUser(puter);
        await answer();

        const a = await first;
        const b = await second;
        expect(whoamis).toHaveLength(1);
        expect(a).not.toBe(b);
        expect(a).not.toBe(puter.whoami);
        a.username = 'changed';
        expect(puter.whoami.username).toBe('alice');
        expect(b.username).toBe('alice');
    });

    it('sends its own request once the boot lookup has finished', async () => {
        const puter = await bootWeb();
        puter.setAuthToken('tok-a');
        await answer();
        expect(puter.whoami).toEqual(USERS['tok-a']);

        const user = readUser(puter);
        await flush();
        expect(whoamis.map((r) => r.token)).toEqual(['tok-a', 'tok-a']);
        await answer();
        await expect(user).resolves.toEqual(USERS['tok-a']);
    });

    it('resends with its token, and asks the user to sign in, when the boot lookup is refused', async () => {
        const puter = await bootWeb();
        const signIn = vi
            .spyOn(puter.ui, 'authenticateWithPuter')
            .mockRejectedValue(new Error('closed'));
        puter.setAuthToken('tok-a');
        const failure = Promise.resolve()
            .then(() => readUser(puter))
            .then(
                () => null,
                (error) => error,
            );
        await flush();
        expect(whoamis).toHaveLength(1);

        await answer({ refuse: true });
        expect(puter.authToken).toBeNull();
        expect(whoamis.map((r) => r.token)).toEqual(['tok-a', 'tok-a']);
        expect(signIn).not.toHaveBeenCalled();

        await answer({ refuse: true });
        expect(await failure).toBeTruthy();
        expect(signIn).toHaveBeenCalledTimes(1);
    });

    it('sends its own request when copying the joined user fails', async () => {
        const puter = await bootWeb();
        puter.setAuthToken('tok-a');
        const user = readUser(puter);
        await flush();
        vi.spyOn(globalThis, 'structuredClone').mockImplementationOnce(() => {
            throw new DOMException('Cannot clone', 'DataCloneError');
        });

        await answer();
        expect(whoamis.map((r) => r.token)).toEqual(['tok-a', 'tok-a']);
        await answer();
        await expect(user).resolves.toEqual(USERS['tok-a']);
    });

    it('resends once the boot lookup gives up on a network failure', async () => {
        const puter = await bootWeb();
        let user;
        vi.useFakeTimers();
        try {
            puter.setAuthToken('tok-a');
            user = readUser(puter);
            // The boot lookup retries a network failure with backoff first.
            for (let attempt = 0; attempt < 9; attempt++) {
                await vi.advanceTimersByTimeAsync(0);
                failNetwork();
                await vi.advanceTimersByTimeAsync(2000);
            }
        } finally {
            vi.useRealTimers();
        }
        expect(whoamis.filter((r) => r.answered)).toHaveLength(9);
        expect(whoamis.filter((r) => !r.answered).map((r) => r.token)).toEqual([
            'tok-a',
        ]);

        await answer();
        await expect(user).resolves.toEqual(USERS['tok-a']);
    });

    it('does not join a lookup sent for a token that has since changed', async () => {
        const puter = await bootWeb();
        puter.setAuthToken('tok-a');
        const joined = readUser(puter);
        await flush();
        expect(whoamis).toHaveLength(1);

        // Read during the switch, before the new token's own lookup starts.
        let late;
        const stop = puter.onAuthStateChanged(() => {
            late ??= readUser(puter);
        });
        puter.setAuthToken('tok-b');
        stop();
        await flush();
        expect(whoamis.map((r) => r.token)).toEqual([
            'tok-a',
            'tok-b',
            'tok-b',
        ]);

        await answer();
        await answer();
        await expect(late).resolves.toEqual(USERS['tok-b']);
        await expect(joined).resolves.toEqual(USERS['tok-b']);
    });

    it('does not join a lookup sent to another API origin', async () => {
        const puter = await bootWeb();
        puter.setAuthToken('tok-a');
        await flush();
        expect(whoamis).toHaveLength(1);

        puter.setAPIOrigin('http://other-origin.test');
        const user = readUser(puter);
        await flush();
        expect(whoamis).toHaveLength(2);
        expect(whoamis[1].xhr.url).toBe('http://other-origin.test/whoami');

        await answer();
        await expect(user).resolves.toEqual(USERS['tok-a']);
    });
});

describe.each([
    ['puter.auth.getUser', (puter) => puter.auth.getUser],
    ['puter.getUser', (puter) => puter.getUser.bind(puter)],
])('%s(success, error)', (_label, getUser) => {
    it('calls success with the joined user, once', async () => {
        const puter = await bootWeb();
        puter.setAuthToken('tok-a');
        const success = vi.fn();
        const error = vi.fn();
        const user = getUser(puter)(success, error);
        await answer();

        expect(await user).toEqual(USERS['tok-a']);
        expect(whoamis).toHaveLength(1);
        expect(success).toHaveBeenCalledTimes(1);
        expect(success).toHaveBeenCalledWith(USERS['tok-a']);
        expect(success.mock.calls[0][0]).not.toBe(puter.whoami);
        expect(error).not.toHaveBeenCalled();
    });
});
