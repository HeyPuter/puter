import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { UIModule } = await import('./UI.js');

const postMessage = vi.fn();

/** A signed-out website visitor: no token, `env: 'web'`. */
const makeUI = () =>
    new UIModule(
        { env: 'web', authToken: null, appID: undefined, util: {} },
        {},
    );

/** A promise this test settles by hand, standing in for `signIn()`'s. */
const deferred = () => {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
};

beforeEach(() => {
    globalThis.window = { parent: { postMessage } };
    postMessage.mockReset();
    // `authenticateWithPuter` reads and writes this off the bare global.
    globalThis.puter = {
        puterAuthState: { isPromptOpen: false, authGranted: null, resolvers: [] },
        auth: { signIn: vi.fn() },
        getUser: vi.fn(async () => ({})),
        onAuth: undefined,
    };
});

afterEach(() => {
    delete globalThis.window;
    delete globalThis.puter;
});

describe('authenticateWithPuter with more than one concurrent caller', () => {
    it('settles every queued caller once the prompt resolves, not just the last one', async () => {
        const signIn = deferred();
        globalThis.puter.auth.signIn = vi.fn(() => signIn.promise);
        const ui = makeUI();

        // Only the first opens a prompt; the rest queue behind it.
        const first = ui.authenticateWithPuter();
        const second = ui.authenticateWithPuter();
        const third = ui.authenticateWithPuter();

        expect(globalThis.puter.auth.signIn).toHaveBeenCalledTimes(1);
        expect(globalThis.puter.puterAuthState.resolvers).toHaveLength(2);

        signIn.resolve();
        const results = await Promise.allSettled([first, second, third]);

        expect(results.map((r) => r.status)).toEqual([
            'fulfilled',
            'fulfilled',
            'fulfilled',
        ]);
        expect(globalThis.puter.puterAuthState.resolvers).toHaveLength(0);
    });

    it('rejects every queued caller when the prompt is canceled, not just the last one', async () => {
        const signIn = deferred();
        globalThis.puter.auth.signIn = vi.fn(() => signIn.promise);
        const ui = makeUI();

        const first = ui.authenticateWithPuter();
        const second = ui.authenticateWithPuter();
        const third = ui.authenticateWithPuter();

        signIn.reject(new Error('user closed the popup'));
        const results = await Promise.allSettled([first, second, third]);

        expect(results.map((r) => r.status)).toEqual([
            'rejected',
            'rejected',
            'rejected',
        ]);
    });
});

describe('authenticateWithPuter in a tab the GUI opened', () => {
    it('waits for the handed-over token instead of prompting', async () => {
        const puterArg = { env: 'web', authToken: null, appID: undefined, util: {} };
        const ui = new UIModule(puterArg, {});
        let handOver;
        globalThis.puter.openerLaunch_ = new Promise((resolve) => {
            handOver = resolve;
        });
        const auth = ui.authenticateWithPuter();

        puterArg.authToken = 'app-token';
        globalThis.puter.openerLaunch_ = null;
        handOver();
        await auth;
        expect(globalThis.puter.auth.signIn).not.toHaveBeenCalled();
    });

    it('prompts as usual when no token came', async () => {
        const ui = makeUI();
        globalThis.puter.auth.signIn = vi.fn(async () => {});
        globalThis.puter.openerLaunch_ = Promise.resolve().then(() => {
            globalThis.puter.openerLaunch_ = null;
        });
        await ui.authenticateWithPuter();
        expect(globalThis.puter.auth.signIn).toHaveBeenCalledOnce();
    });
});
