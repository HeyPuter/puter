// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://notes.puter.test/doc"}
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { UIModule } = await import('./UI.js');

// jsdom has no top-layer dialogs.
HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
};
HTMLDialogElement.prototype.close = function () {
    this.open = false;
};

const GUI_ORIGIN = 'https://puter.test';
const USER = '0b1c9a52-3f0e-4c7a-9a65-2f6d1e8b7c40';

const pickerFrame = () => document.querySelector('dialog.puter-popup-frame iframe');
const fragment = () => Object.fromEntries(new URLSearchParams(new URL(pickerFrame().src).hash.slice(1)));

const fromFrame = (data, source = pickerFrame().contentWindow) =>
    window.dispatchEvent(new MessageEvent('message', { data, origin: GUI_ORIGIN, source }));

const makeUI = () => new UIModule(
    { env: 'web', authToken: 'token-1', APIOrigin: 'https://api.puter.test', appID: 'app-1', util: {} },
    { appInstanceID: 'instance-1' },
);

const fakePuter = ({ signedIn = true } = {}) => {
    globalThis.puter = {
        defaultGUIOrigin: GUI_ORIGIN,
        whoamiCache_: Promise.resolve({ uuid: USER }),
        trackOpenedWindow_: vi.fn(),
        auth: {
            isSignedIn: () => signedIn,
            getUser: vi.fn(async () => ({ uuid: USER })),
        },
    };
};

const PENDING = Symbol('pending');
const settled = (promise) => Promise.race([promise, new Promise((r) => setTimeout(() => r(PENDING), 0))]);

let popup;

beforeEach(() => {
    document.body.innerHTML = '';
    popup = { closed: false, postMessage: vi.fn() };
    window.open = vi.fn(() => popup);
    Object.defineProperty(navigator, 'userActivation', {
        configurable: true,
        value: { hasBeenActive: true, isActive: true },
    });
    fakePuter();
});

afterEach(() => {
    delete navigator.userActivation;
    delete globalThis.puter;
    vi.useRealTimers();
});

describe('pickers on a signed-in first-party page', () => {
    it('shows the open file picker in a frame and resolves what it picks', async () => {
        const ui = makeUI();
        const result = ui.showOpenFilePicker({ multiple: false, accept: '.txt' });
        await vi.waitFor(() => expect(pickerFrame()).not.toBeNull());
        const url = new URL(pickerFrame().src);
        expect(url.pathname).toBe('/embed/show-open-file-picker');
        expect(fragment()).toEqual({ options: '{"multiple":false,"accept":".txt"}', msg_id: '1', user: USER });

        fromFrame({ msg: 'puterPopupFrame', state: 'ready' });
        fromFrame({
            msg: 'fileOpenPicked',
            original_msg_id: '1',
            items: [{ uid: 'uid-1', name: 'a.txt', path: '~/Desktop/a.txt' }],
        });
        await expect(result).resolves.toMatchObject({ uid: 'uid-1', name: 'a.txt' });
        fromFrame({ msg: 'puterPopupFrame', state: 'closed' });
        expect(pickerFrame()).toBeNull();
        expect(window.open).not.toHaveBeenCalled();
    });

    it('keeps the page token instead of adopting the one the frame sends', async () => {
        makeUI().showDirectoryPicker();
        await vi.waitFor(() => expect(pickerFrame()).not.toBeNull());
        expect(puter.trackOpenedWindow_).not.toHaveBeenCalled();
    });

    it('settles a picker the GUI reports cancelled', async () => {
        const result = makeUI().showDirectoryPicker();
        await vi.waitFor(() => expect(pickerFrame()).not.toBeNull());
        expect(new URL(pickerFrame().src).pathname).toBe('/embed/show-directory-picker');
        fromFrame({ msg: 'directoryOpenCancelled', original_msg_id: '1' });
        fromFrame({ msg: 'puterPopupFrame', state: 'closed' });
        await expect(result.undefinedOnCancel).resolves.toBeUndefined();
        expect(await settled(result)).toBe(PENDING);
    });

    it('settles as cancelled when the frame is dismissed without an answer', async () => {
        vi.useFakeTimers();
        const result = makeUI().showOpenFilePicker();
        await vi.waitFor(() => expect(pickerFrame()).not.toBeNull());
        await vi.advanceTimersByTimeAsync(200);
        document.querySelector('.puter-popup-frame-loading').click();
        await expect(result.undefinedOnCancel).resolves.toBeUndefined();
        expect(pickerFrame()).toBeNull();
    });

    it('hands the file content to the save picker frame, and only to it', async () => {
        const result = makeUI().showSaveFilePicker('hello', 'a.txt');
        await vi.waitFor(() => expect(pickerFrame()).not.toBeNull());
        expect(new URL(pickerFrame().src).pathname).toBe('/embed/show-save-file-picker');
        const frameWindow = pickerFrame().contentWindow;
        const post = vi.spyOn(frameWindow, 'postMessage').mockImplementation(() => {});

        window.dispatchEvent(new MessageEvent('message', { data: { msg: 'sendMeFileData' }, origin: GUI_ORIGIN, source: window }));
        window.dispatchEvent(new MessageEvent('message', { data: { msg: 'sendMeFileData' }, origin: 'https://other.test', source: frameWindow }));
        expect(post).not.toHaveBeenCalled();

        fromFrame({ msg: 'sendMeFileData' });
        expect(post).toHaveBeenCalledWith(
            expect.objectContaining({ msg: 'showSaveFilePickerPopup', content: 'hello', suggestedName: 'a.txt' }),
            GUI_ORIGIN,
        );
        fromFrame({ msg: 'fileSaved', original_msg_id: '1', saved_file: { name: 'a.txt', uid: 'uid-2' } });
        await expect(result).resolves.toMatchObject({ name: 'a.txt' });
    });

    it('hands the file content again to a save picker frame that reloads, until it closes', async () => {
        const result = makeUI().showSaveFilePicker('hello', 'a.txt');
        await vi.waitFor(() => expect(pickerFrame()).not.toBeNull());
        const frameWindow = pickerFrame().contentWindow;
        const post = vi.spyOn(frameWindow, 'postMessage').mockImplementation(() => {});

        fromFrame({ msg: 'sendMeFileData' });
        // The reloaded document asks again.
        fromFrame({ msg: 'sendMeFileData' });
        expect(post).toHaveBeenCalledTimes(2);
        expect(post.mock.calls[1][0]).toMatchObject({ msg: 'showSaveFilePickerPopup', content: 'hello' });

        fromFrame({ msg: 'puterPopupFrame', state: 'closed' });
        await expect(result.undefinedOnCancel).resolves.toBeUndefined();
        fromFrame({ msg: 'sendMeFileData' }, frameWindow);
        expect(post).toHaveBeenCalledTimes(2);
    });

    it('opens the popup instead when the frame cannot serve the user', async () => {
        const ui = makeUI();
        const result = ui.showOpenFilePicker();
        await vi.waitFor(() => expect(pickerFrame()).not.toBeNull());
        fromFrame({ msg: 'puterPopupFrame', state: 'loading' });
        fromFrame({ msg: 'puterPopupFrame', state: 'unavailable' });
        await vi.waitFor(() => expect(window.open).toHaveBeenCalledTimes(1));
        expect(pickerFrame()).toBeNull();
        expect(window.open.mock.calls[0][0]).toContain(`${GUI_ORIGIN}/action/show-open-file-picker?embedded_in_popup=true&msg_id=1`);
        expect(puter.trackOpenedWindow_).toHaveBeenCalledWith(popup);

        // The popup's answer reaches the picker as before.
        window.dispatchEvent(new MessageEvent('message', {
            data: { msg: 'fileOpenPicked', original_msg_id: 1, items: [{ uid: 'uid-1', name: 'a.txt' }] },
            origin: GUI_ORIGIN,
            source: popup,
        }));
        await expect(result).resolves.toMatchObject({ uid: 'uid-1' });
    });

    it('asks for a click before opening the popup once the original click has expired', async () => {
        const result = makeUI().showOpenFilePicker();
        await vi.waitFor(() => expect(pickerFrame()).not.toBeNull());
        Object.defineProperty(navigator, 'userActivation', {
            configurable: true,
            value: { hasBeenActive: true, isActive: false },
        });
        fromFrame({ msg: 'puterPopupFrame', state: 'unavailable' });
        await vi.waitFor(() => expect(document.querySelector('puter-dialog')).not.toBeNull());
        expect(window.open).not.toHaveBeenCalled();
        expect(document.querySelector('puter-dialog').shadowRoot.querySelector('.about').textContent)
            .toBe('This website wants you to choose a file from your Puter account.');

        document.querySelector('puter-dialog').shadowRoot.querySelector('#launch-auth-popup').click();
        expect(window.open).toHaveBeenCalledTimes(1);
        expect(window.open.mock.calls[0][2]).toContain('width=700, height=400');
        expect(document.querySelector('puter-dialog')).toBeNull();

        const cancelled = makeUI().showDirectoryPicker();
        await vi.waitFor(() => expect(pickerFrame()).not.toBeNull());
        fromFrame({ msg: 'puterPopupFrame', state: 'unavailable' });
        await vi.waitFor(() => expect(document.querySelector('puter-dialog')).not.toBeNull());
        expect(document.querySelector('puter-dialog').shadowRoot.querySelector('.about').textContent)
            .toBe('This website wants you to choose a folder from your Puter account.');
        document.querySelector('puter-dialog').shadowRoot.querySelector('#launch-auth-popup-cancel').click();
        await expect(cancelled.undefinedOnCancel).resolves.toBeUndefined();
        expect(document.querySelector('puter-dialog')).toBeNull();
        expect(await settled(result)).toBe(PENDING);
        expect(await settled(result.undefinedOnCancel)).toBe(PENDING);
    });

    it('opens the popup when the page has no user to name', async () => {
        puter.whoamiCache_ = Promise.resolve(null);
        puter.auth.getUser = vi.fn(async () => {
            throw new Error('nope');
        });
        makeUI().showDirectoryPicker();
        await vi.waitFor(() => expect(window.open).toHaveBeenCalledTimes(1));
        expect(pickerFrame()).toBeNull();
    });
});

describe('pickers that keep the popup', () => {
    it('opens it synchronously for a signed-out first-party page', () => {
        fakePuter({ signedIn: false });
        makeUI().showOpenFilePicker();
        expect(window.open).toHaveBeenCalledTimes(1);
        expect(pickerFrame()).toBeNull();
    });

    it('opens it synchronously for a page in a frame of another site', () => {
        Object.defineProperty(window.location, 'ancestorOrigins', { configurable: true, value: ['https://other.test'] });
        try {
            makeUI().showOpenFilePicker();
            expect(window.open).toHaveBeenCalledTimes(1);
            expect(pickerFrame()).toBeNull();
        } finally {
            delete window.location.ancestorOrigins;
        }
    });

    it('opens it synchronously for a page outside the Puter origin', () => {
        globalThis.puter.defaultGUIOrigin = 'https://puter.com';
        makeUI().showSaveFilePicker('x', 'a.txt');
        makeUI().showDirectoryPicker();
        expect(window.open).toHaveBeenCalledTimes(2);
        expect(pickerFrame()).toBeNull();
    });
});
