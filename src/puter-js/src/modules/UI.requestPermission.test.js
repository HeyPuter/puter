import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The permission check goes through the shared request helper, so mocking it
// needs no server.
const mockReq = vi.fn();
vi.mock('./perms/lib/req.js', () => ({ req: (...args) => mockReq(...args) }));

const { UIModule } = await import('./UI.js');

const CHECK_ROUTE = '/auth/check-permissions';

/** Answer the mocked helper with what is held, and nothing else. */
const held = (permissions = {}) => {
    mockReq.mockImplementation(async (_puter, route) => {
        if ( route === CHECK_ROUTE ) return { permissions };
        throw new Error(`unexpected route: ${route}`);
    });
};

const postMessage = vi.fn();

/** A UI module in one environment, with the GUI it posts to stubbed. */
const makeUI = ({ env = 'app', authToken = 'token-1' } = {}) =>
    new UIModule({
        env,
        authToken,
        APIOrigin: 'https://api.test',
        appID: 'app-1',
        util: {},
    }, { appInstanceID: 'instance-1' });

/** The messages sent to the GUI, ignoring the constructor's READY. */
const promptCalls = () =>
    postMessage.mock.calls.filter(([msg]) => msg?.msg === 'requestPermission');

beforeEach(() => {
    globalThis.window = { parent: { postMessage } };
    mockReq.mockReset();
    postMessage.mockReset();
    held();
});

afterEach(() => {
    delete globalThis.window;
});

describe('ui.requestPermission on access that is already held', () => {
    it('resolves true without prompting the user', async () => {
        held({ 'fs:/alice/Documents:read': true });
        const ui = makeUI();

        await expect(ui.requestPermission({
            permission: 'fs:/alice/Documents:read',
        })).resolves.toBe(true);

        expect(promptCalls()).toHaveLength(0);
        expect(mockReq).toHaveBeenCalledWith(ui.puter, CHECK_ROUTE, {
            permissions: ['fs:/alice/Documents:read'],
        });
    });

    it('resolves true for a whole multi-scope request', async () => {
        held({ 'apps-of-user:u-1:read': true, 'user:u-1:email:read': true });
        const ui = makeUI();

        await expect(ui.requestPermission({
            permissions: ['apps-of-user:u-1:read', 'user:u-1:email:read'],
        })).resolves.toBe(true);

        expect(promptCalls()).toHaveLength(0);
    });

    it('answers a third-party site the same way, with no popup', async () => {
        held({ 'driver:puter-image-generation:generate': true });
        const ui = makeUI({ env: 'web' });

        await expect(ui.requestPermission({
            permission: 'driver:puter-image-generation:generate',
        })).resolves.toBe(true);
    });
});

describe('ui.requestPermission when the check does not settle it', () => {
    // One prompt is one decision, so partly-held still has something to ask.
    it('prompts for a partly-held set', async () => {
        held({ 'apps-of-user:u-1:read': true });
        const ui = makeUI();

        ui.requestPermission({
            permissions: ['apps-of-user:u-1:read', 'user:u-1:email:read'],
        });

        await vi.waitFor(() => expect(promptCalls()).toHaveLength(1));
    });

    it('prompts when nothing is held', async () => {
        const ui = makeUI();

        ui.requestPermission({ permission: 'user:u-1:email:read' });

        await vi.waitFor(() => expect(promptCalls()).toHaveLength(1));
    });

    // Not a grant, and not a refusal either: the prompt is where this went before.
    it('prompts when the check fails', async () => {
        mockReq.mockImplementation(async () => ({
            error: true,
            code: 'internal_error',
        }));
        const ui = makeUI();

        ui.requestPermission({ permission: 'user:u-1:email:read' });

        await vi.waitFor(() => expect(promptCalls()).toHaveLength(1));
    });

    // The request is spending a user gesture while it waits.
    it('prompts rather than waiting out a stalled check', async () => {
        mockReq.mockImplementation(() => new Promise(() => {}));
        const ui = makeUI();

        ui.requestPermission({ permission: 'user:u-1:email:read' });

        await vi.waitFor(() => expect(promptCalls()).toHaveLength(1), { timeout: 10_000 });
    }, 15_000);

    it('does not ask the server when there is no token to ask with', async () => {
        const ui = makeUI({ authToken: null });

        ui.requestPermission({ permission: 'user:u-1:email:read' });

        await vi.waitFor(() => expect(promptCalls()).toHaveLength(1));
        expect(mockReq).not.toHaveBeenCalled();
    });
});

describe('ui.requestPermission where no prompt can be raised', () => {
    // This environment has always answered false, and a check run as the user —
    // who holds far more than the app would — must not turn that into a grant.
    it('keeps answering false in the GUI, without a check', async () => {
        held({ 'user:u-1:email:read': true });
        const ui = makeUI({ env: 'gui' });

        await expect(ui.requestPermission({
            permission: 'user:u-1:email:read',
        })).resolves.toBe(false);

        expect(mockReq).not.toHaveBeenCalled();
    });
});
