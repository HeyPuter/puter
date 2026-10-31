import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { $SCOPE } from '../lib/xdrpc.js';
import { UtilRPC } from './Util.js';

const { UIModule } = await import('./UI.js');

let messageHandlers;
let parentPostMessage;
let parentWindow;

const listen = (name, handler) => {
    if (name === 'message') messageHandlers.push(handler);
};

const deliver = async (event) => {
    for (const handler of [...messageHandlers]) await handler(event);
};

const quietLogger = () => {
    const logger = { info: () => {}, fields: () => logger };
    return logger;
};

/** A UI module inside a desktop that advertises `features`. */
const makeUI = (features = 'push-status,disable-push') => {
    globalThis.location = { search: `?puter.gui_features=${features}` };
    return new UIModule(
        {
            env: 'app',
            defaultGUIOrigin: 'https://puter.com',
            authToken: 'token-1',
            APIOrigin: 'https://api.test',
            appID: 'app-1',
            logger: quietLogger(),
            util: { rpc: new UtilRPC() },
        },
        { appInstanceID: 'instance-1' },
    );
};

const ipcCalls = (method) =>
    parentPostMessage.mock.calls.filter(
        ([message]) => message?.$ === 'puter-ipc' && message.msg === method,
    );

/** The desktop's reply to the last `method` message. */
const reply = async (method, value) => {
    const [{ uuid }] = ipcCalls(method).at(-1);
    await deliver({
        source: parentWindow,
        origin: 'https://puter.com',
        data: { $SCOPE, id: uuid, args: [value] },
    });
};

beforeEach(() => {
    messageHandlers = [];
    parentPostMessage = vi.fn();
    parentWindow = { postMessage: parentPostMessage };
    globalThis.window = {
        parent: parentWindow,
        focus: vi.fn(),
        addEventListener: listen,
        removeEventListener: () => {},
    };
    globalThis.addEventListener = listen;
    globalThis.document = { addEventListener: vi.fn() };
    globalThis.puter = { defaultGUIOrigin: 'https://puter.com' };
});

afterEach(() => {
    delete globalThis.window;
    delete globalThis.addEventListener;
    delete globalThis.document;
    delete globalThis.puter;
    delete globalThis.location;
});

describe('ui.pushStatus_', () => {
    it('asks the desktop and resolves its answer', async () => {
        const ui = makeUI();
        const result = ui.pushStatus_();
        await vi.waitFor(() => expect(ipcCalls('pushStatus')).toHaveLength(1));
        await reply('pushStatus', { state: 'blocked' });
        await expect(result).resolves.toBe('blocked');
    });

    it('resolves null without asking a desktop that does not list it', async () => {
        const ui = makeUI('enable-push');
        await expect(ui.pushStatus_()).resolves.toBeNull();
        expect(ipcCalls('pushStatus')).toHaveLength(0);
    });
});

describe('ui.disablePush_', () => {
    it('asks the desktop and resolves whether the app held the permission', async () => {
        const ui = makeUI();
        const result = ui.disablePush_();
        await vi.waitFor(() => expect(ipcCalls('disablePush')).toHaveLength(1));
        await reply('disablePush', { removed: true });
        await expect(result).resolves.toBe(true);
    });

    it('rejects with the desktop`s error when the revoke failed', async () => {
        const ui = makeUI();
        const result = ui.disablePush_();
        const rejection = expect(result).rejects.toMatchObject({
            code: 'ipc_handler_failed',
        });
        await vi.waitFor(() => expect(ipcCalls('disablePush')).toHaveLength(1));
        await reply('disablePush', {
            $: 'puter-ipc-error',
            error: {
                code: 'ipc_handler_failed',
                message: 'The request could not be completed.',
            },
        });
        await rejection;
    });

    it('resolves false without asking a desktop that does not list it', async () => {
        const ui = makeUI('enable-push,push-status');
        await expect(ui.disablePush_()).resolves.toBe(false);
        expect(ipcCalls('disablePush')).toHaveLength(0);
    });
});
