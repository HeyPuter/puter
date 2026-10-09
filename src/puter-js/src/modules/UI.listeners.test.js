import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { $SCOPE } from '../lib/xdrpc.js';
import { UtilRPC } from './Util.js';

const { AppConnection, UIModule } = await import('./UI.js');

let messageHandlers;
let parentPostMessage;
let parentWindow;

const listen = (name, handler) => {
    if (name === 'message') messageHandlers.push(handler);
};

/** Deliver one message event to every listener registered so far. */
const deliver = async (event) => {
    for (const handler of [...messageHandlers]) await handler(event);
};

/** A logger whose every chain ends quietly. */
const quietLogger = () => {
    const logger = { info: () => {}, fields: () => logger };
    return logger;
};

const makePuter = () => ({
    env: 'app',
    authToken: 'token-1',
    APIOrigin: 'https://api.test',
    appID: 'app-1',
    logger: quietLogger(),
    util: { rpc: new UtilRPC() },
});

const makeUI = () => new UIModule(makePuter(), { appInstanceID: 'instance-1' });

beforeEach(() => {
    messageHandlers = [];
    parentPostMessage = vi.fn();
    parentWindow = { postMessage: parentPostMessage };
    globalThis.window = {
        parent: parentWindow,
        focus: vi.fn(),
        addEventListener: listen,
        removeEventListener: (name, handler) => {
            if (name !== 'message') return;
            const i = messageHandlers.indexOf(handler);
            if (i !== -1) messageHandlers.splice(i, 1);
        },
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
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('AppConnection', () => {
    const connect = (puter = makePuter()) =>
        new AppConnection(puter, {
            target: 'child-1',
            usesSDK: true,
            messageTarget: parentWindow,
            appInstanceID: 'instance-1',
        });

    const fromChild = (data) => ({
        source: parentWindow,
        data: {
            appInstanceID: 'child-1',
            targetAppInstanceID: 'instance-1',
            ...data,
        },
    });

    it('stops listening once the target app closes', async () => {
        const puter = makePuter();
        const before = messageHandlers.length;
        const conn = connect(puter);
        expect(messageHandlers.length).toBe(before + 1);

        const onClose = vi.fn();
        const onMessage = vi.fn();
        conn.on('close', onClose);
        conn.on('message', onMessage);

        await deliver(fromChild({ msg: 'messageToApp', contents: 'hi' }));
        await deliver(fromChild({ msg: 'appClosed', statusCode: 0 }));
        await deliver(fromChild({ msg: 'appClosed', statusCode: 0 }));
        await deliver(fromChild({ msg: 'messageToApp', contents: 'late' }));

        expect(onMessage.mock.calls).toEqual([['hi']]);
        expect(onClose).toHaveBeenCalledOnce();
        expect(onClose).toHaveBeenCalledWith({
            appInstanceID: 'child-1',
            statusCode: 0,
        });
        expect(messageHandlers.length).toBe(before);
    });

    it('keeps listening when another app closes', async () => {
        const conn = connect();
        const count = messageHandlers.length;
        const onClose = vi.fn();
        conn.on('close', onClose);

        await deliver(
            fromChild({ msg: 'appClosed', appInstanceID: 'child-2' }),
        );

        expect(onClose).not.toHaveBeenCalled();
        expect(messageHandlers.length).toBe(count);
    });
});

describe('host replies (env: app)', () => {
    it('frees an IPC reply callback once the reply arrives', async () => {
        const ui = makeUI();
        const { callbackManager } = ui.util.rpc;
        const before = callbackManager.callbacks.size;

        const result = ui.exitPictureInPicture();
        // The stub registers its callback after a tick.
        await vi.waitFor(() => expect(parentPostMessage).toHaveBeenCalled());
        const { uuid } = parentPostMessage.mock.calls.at(-1)[0];

        await deliver({
            source: parentWindow,
            data: { $SCOPE, id: uuid, args: [{ wasOpen: true }] },
        });

        await expect(result).resolves.toBe(true);
        expect(callbackManager.callbacks.size).toBe(before);
    });

    // A settled reply's id must not keep catching later messages ahead of the
    // branches below the reply dispatch.
    it.each([
        ['instancesOpenSucceeded', { instancesOpen: 2 }],
        ['getAppDataSucceeded', { item: { uid: 'u' } }],
        ['readAppDataFileSucceeded', { item: { uid: 'u' } }],
        ['readAppDataFileFailed', {}],
    ])('settles a %s reply once', async (msg, fields) => {
        const ui = makeUI();
        ui.instancesOpen();
        const { uuid } = parentPostMessage.mock.calls.at(-1)[0];
        const onLocale = vi.fn();
        ui.on('localeChanged', onLocale);

        await deliver({
            source: parentWindow,
            data: { msg, original_msg_id: uuid, ...fields },
        });
        await deliver({
            source: parentWindow,
            data: {
                msg: 'broadcast',
                name: 'localeChanged',
                data: { language: 'fr' },
                original_msg_id: uuid,
            },
        });

        expect(onLocale).toHaveBeenCalledWith({ language: 'fr' });
    });

    it('reports an error reply instead of rejecting the listener', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        makeUI();
        const failure = { code: 'method_removed', message: 'gone' };

        await expect(
            deliver({
                source: parentWindow,
                data: { msg: 'error', original_msg_id: 1, error: failure },
            }),
        ).resolves.toBeUndefined();
        expect(error).toHaveBeenCalledWith(failure);
    });

    it('survives a malformed message', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.stubGlobal('location', { search: '' });
        const ui = makeUI();
        ui.onItemsOpened(() => {});

        await expect(
            deliver({
                source: parentWindow,
                data: { msg: 'itemsOpened', msg_id: 1 },
            }),
        ).resolves.toBeUndefined();
        expect(error).toHaveBeenCalled();
    });
});
