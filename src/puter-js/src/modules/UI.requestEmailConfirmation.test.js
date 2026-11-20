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

const frameDialog = () => document.querySelector('dialog.puter-popup-frame');
const confirmFrame = () => frameDialog()?.querySelector('iframe') ?? null;
const fragment = () => Object.fromEntries(new URLSearchParams(new URL(confirmFrame().src).hash.slice(1)));

const fromFrame = (data) => window.dispatchEvent(new MessageEvent('message', {
    data, origin: GUI_ORIGIN, source: confirmFrame().contentWindow,
}));

const makeUI = (env = 'web') => new UIModule(
    { env, authToken: 'token-1', APIOrigin: 'https://api.puter.test', appID: 'app-1', util: {} },
    { appInstanceID: 'instance-1' },
);

const fakePuter = ({ signedIn = true, guiOrigin = GUI_ORIGIN } = {}) => {
    globalThis.puter = {
        defaultGUIOrigin: guiOrigin,
        whoamiCache_: Promise.resolve({ uuid: USER }),
        auth: {
            isSignedIn: () => signedIn,
            getUser: vi.fn(async () => ({ uuid: USER })),
        },
    };
};

const PENDING = Symbol('pending');
const settled = (promise) => Promise.race([promise, new Promise((r) => setTimeout(() => r(PENDING), 0))]);

beforeEach(() => {
    document.body.innerHTML = '';
    window.open = vi.fn(() => ({ closed: false }));
    fakePuter();
});

afterEach(() => {
    delete globalThis.puter;
    vi.restoreAllMocks();
});

describe('ui.requestEmailConfirmation on a signed-in first-party page', () => {
    it('shows the confirmation in a frame over the page and resolves whether the email is confirmed', async () => {
        const result = makeUI().requestEmailConfirmation();
        await vi.waitFor(() => expect(confirmFrame()).not.toBeNull());

        expect(new URL(confirmFrame().src).pathname).toBe('/embed/request-email-confirmation');
        expect(fragment()).toEqual({ user: USER });
        // It covers the page, and the window inside draws the scrim.
        expect(frameDialog().querySelector('.puter-popup-frame-box')).toBeNull();
        expect(frameDialog().querySelector('.puter-popup-frame-close')).toBeNull();

        fromFrame({ msg: 'puterPopupFrame', state: 'loading' });
        fromFrame({ msg: 'puterPopupFrame', state: 'ready' });
        expect(frameDialog().open).toBe(true);
        fromFrame({ msg: 'puterPopupFrame', state: 'closed', confirmed: true });

        await expect(result).resolves.toEqual({ response: true });
        expect(confirmFrame()).toBeNull();
        expect(window.open).not.toHaveBeenCalled();
    });

    it('resolves true without a frame when the page knows the email is confirmed', async () => {
        puter.whoamiCache_ = Promise.resolve({ uuid: USER, email_confirmed: true });
        const ui = makeUI();
        const result = ui.requestEmailConfirmation();
        // Mounted only after the user lookup, so a frame would be in the DOM by now.
        await expect(result).resolves.toEqual({ response: true });
        expect(frameDialog()).toBeNull();
        expect(window.open).not.toHaveBeenCalled();
        // The next call looks again rather than reusing the settled one.
        expect(ui.requestEmailConfirmation()).not.toBe(result);
    });

    it('resolves true without showing the frame when the GUI finds the email already confirmed', async () => {
        const result = makeUI().requestEmailConfirmation();
        await vi.waitFor(() => expect(confirmFrame()).not.toBeNull());
        fromFrame({ msg: 'puterPopupFrame', state: 'loading' });
        fromFrame({ msg: 'puterPopupFrame', state: 'closed', confirmed: true });

        await expect(result).resolves.toEqual({ response: true });
        expect(frameDialog()).toBeNull();
    });

    it('resolves the next call true without a frame once the user has confirmed in one', async () => {
        const ui = makeUI();
        const first = ui.requestEmailConfirmation();
        await vi.waitFor(() => expect(confirmFrame()).not.toBeNull());
        fromFrame({ msg: 'puterPopupFrame', state: 'ready' });
        fromFrame({ msg: 'puterPopupFrame', state: 'closed', confirmed: true });
        await expect(first).resolves.toEqual({ response: true });

        await expect(ui.requestEmailConfirmation()).resolves.toEqual({ response: true });
        expect(frameDialog()).toBeNull();
    });

    it('resolves false when the user closes it without confirming', async () => {
        const result = makeUI().requestEmailConfirmation();
        await vi.waitFor(() => expect(confirmFrame()).not.toBeNull());
        fromFrame({ msg: 'puterPopupFrame', state: 'ready' });
        // The frame's own close() reports no result.
        fromFrame({ msg: 'puterPopupFrame', state: 'closed' });
        await expect(result).resolves.toEqual({ response: false });
    });

    it('resolves false when Escape on the page dismisses it', async () => {
        const result = makeUI().requestEmailConfirmation();
        await vi.waitFor(() => expect(confirmFrame()).not.toBeNull());
        fromFrame({ msg: 'puterPopupFrame', state: 'ready' });
        frameDialog().dispatchEvent(new Event('cancel', { cancelable: true }));
        await expect(result).resolves.toEqual({ response: false });
        expect(confirmFrame()).toBeNull();
    });

    it('settles a call made while it shows with it, without replacing it', async () => {
        const ui = makeUI();
        const first = ui.requestEmailConfirmation();
        await vi.waitFor(() => expect(confirmFrame()).not.toBeNull());
        const frame = confirmFrame();

        const second = ui.requestEmailConfirmation();

        expect(second).toBe(first);
        expect(document.querySelectorAll('dialog.puter-popup-frame')).toHaveLength(1);
        fromFrame({ msg: 'puterPopupFrame', state: 'ready' });
        fromFrame({ msg: 'puterPopupFrame', state: 'closed' });
        await expect(second).resolves.toEqual({ response: false });

        // A later call shows a new one.
        ui.requestEmailConfirmation();
        await vi.waitFor(() => expect(confirmFrame()).not.toBeNull());
        expect(confirmFrame()).not.toBe(frame);
    });

    it('resolves false when the frame cannot show it', async () => {
        const result = makeUI().requestEmailConfirmation();
        await vi.waitFor(() => expect(confirmFrame()).not.toBeNull());
        fromFrame({ msg: 'puterPopupFrame', state: 'loading' });
        fromFrame({ msg: 'puterPopupFrame', state: 'unavailable' });

        await expect(result).resolves.toEqual({ response: false });
        expect(confirmFrame()).toBeNull();
        expect(window.open).not.toHaveBeenCalled();
    });

    it('resolves false when the page has no user to name', async () => {
        puter.whoamiCache_ = Promise.resolve(null);
        puter.auth.getUser = vi.fn(async () => {
            throw new Error('nope');
        });
        await expect(makeUI().requestEmailConfirmation()).resolves.toEqual({ response: false });
        expect(confirmFrame()).toBeNull();
    });
});

describe('ui.requestEmailConfirmation elsewhere', () => {
    it('asks the desktop inside an app and resolves its answer', async () => {
        const post = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
        const result = makeUI('app').requestEmailConfirmation();

        expect(post).toHaveBeenCalledWith(expect.objectContaining({
            msg: 'requestEmailConfirmation',
            env: 'app',
            appInstanceID: 'instance-1',
        }), '*');
        expect(confirmFrame()).toBeNull();

        const { uuid } = post.mock.calls.find(([data]) => data.msg === 'requestEmailConfirmation')[0];
        window.dispatchEvent(new MessageEvent('message', {
            data: { msg: 'requestEmailConfirmationResponded', original_msg_id: uuid, response: true },
            origin: GUI_ORIGIN,
            source: window,
        }));
        await expect(result).resolves.toMatchObject({ response: true });
    });

    it.each([
        ['a signed-out first-party page', { signedIn: false }],
        ['a page outside the Puter origin', { guiOrigin: 'https://puter.com' }],
    ])('does not frame on %s', async (_label, options) => {
        fakePuter(options);
        const result = makeUI().requestEmailConfirmation();
        expect(await settled(result)).toBe(PENDING);
        expect(confirmFrame()).toBeNull();
    });
});
