import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { $SCOPE } from '../lib/xdrpc.js';
import FSItem from './FSItem.js';
import { UtilRPC } from './Util.js';

const { AppConnection, UIModule } = await import('./UI.js');

const GUI_ORIGIN = 'https://puter.com';

let messageHandlers;
let hostPostMessage;
let host;

const listen = (name, handler) => {
    if ( name === 'message' ) messageHandlers.push(handler);
};

/** Deliver one message from the desktop to every listener registered so far. */
const fromHost = async (data) => {
    const event = { source: host, origin: GUI_ORIGIN, data };
    for ( const handler of [...messageHandlers] ) await handler(event);
};

/** A logger whose every chain ends quietly. */
const quietLogger = () => {
    const logger = { info: () => {}, fields: () => logger };
    return logger;
};

const makePuter = (overrides = {}) => ({
    env: 'app',
    defaultGUIOrigin: GUI_ORIGIN,
    authToken: null,
    APIOrigin: 'https://api.test',
    appID: 'app-1',
    logger: quietLogger(),
    util: { rpc: new UtilRPC() },
    ...overrides,
});

const makeUI = (instance = {}) =>
    new UIModule(makePuter(), { appInstanceID: 'instance-1', ...instance });

const posted = (name) => hostPostMessage.mock.calls.findLast(([message]) => message.msg === name)?.[0];

/** Waits for an IPC call, which posts a tick after it is made, then answers it. */
const answerIpc = async (method, value) => {
    await vi.waitFor(() => expect(posted(method)).toBeDefined());
    const message = posted(method);
    await fromHost({ $SCOPE, id: message.uuid, args: [value] });
    return message;
};

beforeEach(() => {
    messageHandlers = [];
    hostPostMessage = vi.fn();
    host = { postMessage: hostPostMessage };
    globalThis.window = {
        parent: host,
        focus: vi.fn(),
        addEventListener: listen,
        removeEventListener: (name, handler) => {
            const i = messageHandlers.indexOf(handler);
            if ( name === 'message' && i !== -1 ) messageHandlers.splice(i, 1);
        },
    };
    globalThis.addEventListener = listen;
    globalThis.document = { addEventListener: vi.fn() };
    globalThis.puter = { defaultGUIOrigin: GUI_ORIGIN, appName: 'notes' };
});

afterEach(() => {
    delete globalThis.window;
    delete globalThis.addEventListener;
    delete globalThis.document;
    delete globalThis.puter;
    vi.restoreAllMocks();
});

describe('AppConnection', () => {
    const connect = ({ usesSDK = true, puter = makePuter() } = {}) =>
        new AppConnection(puter, {
            target: 'child-1',
            usesSDK,
            messageTarget: host,
            appInstanceID: 'instance-1',
        });

    const messageToApp = (fields = {}) => ({
        msg: 'messageToApp',
        appInstanceID: 'child-1',
        targetAppInstanceID: 'instance-1',
        contents: 'hi',
        ...fields,
    });

    it('posts a message for the desktop to relay to the target app', () => {
        connect().postMessage({ text: 'hi' });

        expect(hostPostMessage).toHaveBeenCalledWith({
            msg: 'messageToApp',
            appInstanceID: 'instance-1',
            targetAppInstanceID: 'child-1',
            targetAppOrigin: '*',
            contents: { text: 'hi' },
            transfer: [],
        }, GUI_ORIGIN, []);
    });

    it.each([
        ['an array', (buffer) => [buffer]],
        ['an options object', (buffer) => ({ transfer: [buffer] })],
    ])('transfers the objects listed in %s', (_form, list) => {
        const buffer = new ArrayBuffer(8);
        connect().postMessage({ buffer }, list(buffer));

        const [message, origin, transfer] = hostPostMessage.mock.calls.at(-1);
        expect(message.transfer).toEqual([buffer]);
        expect(origin).toBe(GUI_ORIGIN);
        expect(transfer).toEqual([buffer]);
    });

    it('throws for a transfer list that is not an array', () => {
        const conn = connect();
        let thrown;
        try {
            conn.postMessage('hi', { transfer: 'buffer' });
        } catch (e) {
            thrown = e;
        }

        expect(thrown).toEqual({
            message: 'transfer must be an array of transferable objects',
            code: 'invalid_transfer_list',
        });
        expect(hostPostMessage).not.toHaveBeenCalled();
    });

    it('reports whether the target app uses the SDK, and posts nothing to one that does not', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const conn = connect({ usesSDK: false });

        expect(conn.usesSDK).toBe(false);
        conn.postMessage('hi');

        expect(hostPostMessage).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalledWith('Trying to post message to a non-SDK app');
        expect(connect().usesSDK).toBe(true);
    });

    it('asks the desktop to close the target app', () => {
        connect().close();

        expect(hostPostMessage).toHaveBeenCalledWith({
            msg: 'closeApp',
            appInstanceID: 'instance-1',
            targetAppInstanceID: 'child-1',
        }, GUI_ORIGIN);
    });

    it('posts nothing once the target app has closed', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const conn = connect();
        await fromHost({ msg: 'appClosed', appInstanceID: 'child-1', statusCode: 0 });

        conn.postMessage('late');
        conn.close();

        expect(hostPostMessage).not.toHaveBeenCalled();
        expect(warn.mock.calls).toEqual([
            ['Trying to post message on a closed AppConnection'],
            ['Trying to close an app on a closed AppConnection'],
        ]);
    });

    it('ignores a message from the app on another connection', async () => {
        const onMessage = vi.fn();
        connect().on('message', onMessage);

        await fromHost(messageToApp({ appInstanceID: 'child-2' }));

        expect(onMessage).not.toHaveBeenCalled();
    });

    it('drops a message addressed to another app', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const onMessage = vi.fn();
        connect().on('message', onMessage);

        await fromHost(messageToApp({ targetAppInstanceID: 'instance-2' }));

        expect(onMessage).not.toHaveBeenCalled();
        expect(error).toHaveBeenCalledOnce();
    });

    it('ignores an event that carries no data', async () => {
        const onMessage = vi.fn();
        const onClose = vi.fn();
        const conn = connect();
        conn.on('message', onMessage);
        conn.on('close', onClose);

        await fromHost(undefined);

        expect(onMessage).not.toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();
    });

    it('trusts no message when the configured GUI origin is not a URL', async () => {
        const onMessage = vi.fn();
        connect({ puter: makePuter({ defaultGUIOrigin: 'not a url' }) }).on('message', onMessage);

        await fromHost(messageToApp());

        expect(onMessage).not.toHaveBeenCalled();
    });
});

describe('launching and connecting to apps', () => {
    const appInfo = { appInstanceID: 'child-1', usesSDK: true, response: { launchResult: { launched: true } } };

    it('launches an app by name and resolves to a connection to it', async () => {
        const ui = makeUI();
        const callback = vi.fn();
        const result = ui.launchApp('editor', { file: 'a.txt' }, callback);

        const message = await answerIpc('launchApp', appInfo);
        expect(message.parameters).toMatchObject({ app_name: 'editor', args: { file: 'a.txt' } });

        const conn = await result;
        expect(conn).toBeInstanceOf(AppConnection);
        expect(conn.usesSDK).toBe(true);
        expect(conn.response).toEqual({ launchResult: { launched: true } });
        expect(callback).toHaveBeenCalledWith(appInfo);

        conn.postMessage('ping');
        expect(posted('messageToApp')).toMatchObject({
            appInstanceID: 'instance-1',
            targetAppInstanceID: 'child-1',
            contents: 'ping',
        });
    });

    it('reads every launch setting from an options object', async () => {
        const ui = makeUI();
        const callback = vi.fn();
        const item = new FSItem({
            uid: 'uid-1',
            name: 'a.txt',
            path: '/alice/a.txt',
            readURL: 'https://api.test/file?uid=uid-1',
        });
        const signature = { uid: 'uid-2', path: '/alice/b.txt' };
        const result = ui.launchApp({
            name: 'editor',
            args: { readOnly: true },
            file_paths: ['/alice/c.txt'],
            items: [item, signature],
            pseudonym: 'viewer',
            background: true,
            callback,
        });

        const { parameters } = await answerIpc('launchApp', appInfo);
        expect(parameters).toEqual({
            app_name: 'editor',
            args: { readOnly: true },
            file_paths: ['/alice/c.txt'],
            items: [
                expect.objectContaining({
                    uid: 'uid-1',
                    path: '/alice/a.txt',
                    fsentry_name: 'a.txt',
                    read_url: 'https://api.test/file?uid=uid-1',
                }),
                signature,
            ],
            pseudonym: 'viewer',
            background: true,
        });
        await result;
        expect(callback).toHaveBeenCalledWith(appInfo);
    });

    it('accepts the legacy app_name option', async () => {
        makeUI().launchApp({ app_name: 'editor' });

        const { parameters } = await answerIpc('launchApp', appInfo);
        expect(parameters.app_name).toBe('editor');
    });

    it('sends no items when the option is not a list', async () => {
        makeUI().launchApp({ name: 'editor', items: 'a.txt' });

        const { parameters } = await answerIpc('launchApp', appInfo);
        expect(parameters.items).toEqual([]);
    });

    it('splits a pseudonym off the app name', async () => {
        makeUI().launchApp('editor#(as)viewer');

        const { parameters } = await answerIpc('launchApp', appInfo);
        expect(parameters).toMatchObject({ app_name: 'editor', pseudonym: 'viewer' });
    });

    it('launches another instance of this app when no name is given', async () => {
        makeUI().launchApp();

        const { parameters } = await answerIpc('launchApp', appInfo);
        expect(parameters.app_name).toBe('notes');
    });

    it('connects to a running instance of an app', async () => {
        const result = makeUI().connectToInstance('editor');

        const { parameters } = await answerIpc('connectToInstance', { appInstanceID: 'child-9', usesSDK: false });
        expect(parameters).toEqual({ app_name: 'editor' });

        const conn = await result;
        expect(conn).toBeInstanceOf(AppConnection);
        expect(conn.usesSDK).toBe(false);
    });
});

describe('the app that launched this one', () => {
    it('is null for an app the user opened', () => {
        expect(makeUI().parentApp()).toBeNull();
    });

    it('is a connection to the parent app', async () => {
        const ui = makeUI({ parentInstanceID: 'parent-1' });
        const parent = ui.parentApp();
        const onMessage = vi.fn();
        parent.on('message', onMessage);

        parent.postMessage('ready');
        expect(posted('messageToApp')).toMatchObject({
            appInstanceID: 'instance-1',
            targetAppInstanceID: 'parent-1',
            contents: 'ready',
        });

        await fromHost({
            msg: 'messageToApp',
            appInstanceID: 'parent-1',
            targetAppInstanceID: 'instance-1',
            contents: 'go',
        });
        expect(onMessage).toHaveBeenCalledWith('go');
    });
});

describe('an app asking to connect to this one', () => {
    const request = { msg: 'connection', appInstanceID: 'peer-1', response: { topic: 'sync' } };

    it('hands the listener a connection to the requester', async () => {
        const ui = makeUI();
        const onConnection = vi.fn();
        ui.on('connection', onConnection);

        await fromHost({ ...request });

        const { conn } = onConnection.mock.calls[0][0];
        expect(conn).toBeInstanceOf(AppConnection);
        expect(conn.usesSDK).toBe(true);
        expect(conn.response).toEqual({ topic: 'sync' });

        conn.postMessage('hello');
        expect(posted('messageToApp')).toMatchObject({ targetAppInstanceID: 'peer-1', contents: 'hello' });
    });

    it.each([
        ['accept', true],
        ['reject', false],
    ])('%s() answers the requester with a value', async (answer, accepted) => {
        const ui = makeUI();
        const onConnection = vi.fn();
        ui.on('connection', onConnection);
        await fromHost({ ...request });

        onConnection.mock.calls[0][0][answer]({ reason: 'busy' });

        expect(hostPostMessage).toHaveBeenLastCalledWith({
            $: 'connection-resp',
            connection: 'peer-1',
            accept: accepted,
            value: { reason: 'busy' },
        }, '*');
    });
});
