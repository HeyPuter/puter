import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { UIModule } = await import('./UI.js');

const GUI_ORIGIN = 'https://puter.com';

let messageHandlers;
let openedPopups;
let parentPostMessage;
let parentWindow;

/** The `window` the SDK sees: enough of one for the module's listeners. */
const makeWindow = () => ({
    parent: parentWindow,
    focus: vi.fn(),
    addEventListener: (name, handler) => {
        if ( name === 'message' ) messageHandlers.push(handler);
    },
    removeEventListener: (name, handler) => {
        if ( name !== 'message' ) return;
        const i = messageHandlers.indexOf(handler);
        if ( i !== -1 ) messageHandlers.splice(i, 1);
    },
    // Named windows, so a repeated picker gets the same object back.
    open: (url, name) => {
        const popup = openedPopups.get(name) ?? { name, postMessage: vi.fn(), closed: false };
        openedPopups.set(name, popup);
        return popup;
    },
});

const makeUI = (env) =>
    new UIModule({
        env,
        authToken: 'token-1',
        APIOrigin: 'https://api.test',
        appID: 'app-1',
        util: {},
    }, { appInstanceID: 'instance-1' });

/** Deliver one message event to every listener the module registered. */
const deliver = async (event) => {
    for ( const handler of [...messageHandlers] ) await handler(event);
};

const filePicked = (msg_id) => ({
    msg: 'fileOpenPicked',
    original_msg_id: msg_id,
    items: [{ uid: 'uid-1', name: 'a.txt', path: '/alice/Desktop/a.txt' }],
});

/** Resolved value, or the marker if the promise is still pending. */
const PENDING = Symbol('pending');
const settled = (promise) =>
    Promise.race([promise, Promise.resolve(PENDING)]);

beforeEach(() => {
    messageHandlers = [];
    openedPopups = new Map();
    parentPostMessage = vi.fn();
    parentWindow = { postMessage: parentPostMessage };
    globalThis.window = makeWindow();
    globalThis.document = { addEventListener: vi.fn() };
    globalThis.screen = { width: 1600, height: 900 };
    globalThis.open = globalThis.window.open;
    globalThis.puter = { defaultGUIOrigin: GUI_ORIGIN };
});

afterEach(() => {
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.screen;
    delete globalThis.open;
    delete globalThis.puter;
});

// PUT-1867: the clickjacking guard pinned `event.source` to `messageTarget`,
// which only exists in `app` env, so it dropped every popup reply on a
// third-party site and left the picker promises pending forever.
describe('picker replies on a third-party site (env: web)', () => {
    it('settles showOpenFilePicker from the popup it opened', async () => {
        const ui = makeUI('web');
        const promise = ui.showOpenFilePicker();
        const popup = openedPopups.get('Puter: Open File');
        expect(popup).toBeDefined();

        await deliver({ source: popup, origin: GUI_ORIGIN, data: filePicked(1) });

        await expect(promise).resolves.toMatchObject({ name: 'a.txt' });
    });

    it('settles showDirectoryPicker from the popup it opened', async () => {
        const ui = makeUI('web');
        const promise = ui.showDirectoryPicker();
        const popup = openedPopups.get('Puter: Open Directory');

        await deliver({
            source: popup,
            origin: GUI_ORIGIN,
            data: {
                msg: 'directoryPicked',
                original_msg_id: 1,
                items: [{ uid: 'uid-2', fsentry_name: 'Docs', path: '/alice/Docs' }],
            },
        });

        await expect(promise).resolves.toMatchObject({ name: 'Docs', isDirectory: true });
    });

    it('settles showSaveFilePicker from the popup it opened', async () => {
        const createObjectURL = URL.createObjectURL;
        URL.createObjectURL = () => 'blob:test';
        try {
            const ui = makeUI('web');
            const promise = ui.showSaveFilePicker('hello', 'a.txt');
            const popup = openedPopups.get('Puter: Save File');

            await deliver({
                source: popup,
                origin: GUI_ORIGIN,
                data: {
                    msg: 'fileSaved',
                    original_msg_id: 1,
                    saved_file: { uid: 'uid-3', name: 'a.txt', path: '/alice/Desktop/a.txt' },
                },
            });

            await expect(promise).resolves.toMatchObject({ name: 'a.txt' });
        } finally {
            URL.createObjectURL = createObjectURL;
        }
    });

    it('still accepts the reply when the popup closed itself first', async () => {
        // The picker calls window.close() right after posting, and a
        // discarded browsing context can leave `event.source` null.
        const ui = makeUI('web');
        const promise = ui.showOpenFilePicker();

        await deliver({ source: null, origin: GUI_ORIGIN, data: filePicked(1) });

        await expect(promise).resolves.toMatchObject({ name: 'a.txt' });
    });

    it('ignores a reply from a page that framed us', async () => {
        const ui = makeUI('web');
        const promise = ui.showOpenFilePicker();
        const attacker = { postMessage: vi.fn() };

        await deliver({ source: attacker, origin: 'https://evil.test', data: filePicked(1) });

        await expect(settled(promise)).resolves.toBe(PENDING);
    });

    it('ignores a reply from a window on the GUI origin that we did not open', async () => {
        const ui = makeUI('web');
        const promise = ui.showOpenFilePicker();
        const other = { postMessage: vi.fn() };

        await deliver({ source: other, origin: GUI_ORIGIN, data: filePicked(1) });

        await expect(settled(promise)).resolves.toBe(PENDING);
    });

    it('ignores everything when no picker is open', async () => {
        makeUI('web');

        await deliver({ source: null, origin: GUI_ORIGIN, data: filePicked(1) });

        // Nothing to assert beyond not throwing: no callback is registered.
        expect(messageHandlers.length).toBeGreaterThan(0);
    });
});

// The clickjacking fix this regressed from: an app iframe must only take
// messages from its host frame, whatever origin that frame is served on.
describe('host messages inside the desktop (env: app)', () => {
    it('accepts a reply from the host frame', async () => {
        const ui = makeUI('app');
        const promise = ui.showOpenFilePicker();

        await deliver({ source: parentWindow, origin: 'https://self-hosted.test', data: filePicked(1) });

        await expect(promise).resolves.toMatchObject({ name: 'a.txt' });
        expect(parentPostMessage).toHaveBeenCalledWith(
            expect.objectContaining({ msg: 'showOpenFilePicker' }), '*');
    });

    it('rejects a reply from a sibling frame, even on the GUI origin', async () => {
        const ui = makeUI('app');
        const promise = ui.showOpenFilePicker();
        const sibling = { postMessage: vi.fn() };

        await deliver({ source: sibling, origin: GUI_ORIGIN, data: filePicked(1) });

        await expect(settled(promise)).resolves.toBe(PENDING);
    });
});
