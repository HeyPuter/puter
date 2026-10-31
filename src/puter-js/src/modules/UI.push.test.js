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
const makeUI = (features = 'push-status') => {
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
