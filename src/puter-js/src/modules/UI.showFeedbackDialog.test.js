// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://notes.puter.test/doc"}
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { UIModule } = await import('./UI.js');

// jsdom has no top-layer dialogs.
HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
};

const GUI_ORIGIN = 'https://puter.test';
const USER = '0b1c9a52-3f0e-4c7a-9a65-2f6d1e8b7c40';

const makeUI = () => new UIModule(
    { env: 'web', authToken: 'token-1', APIOrigin: 'https://api.puter.test', util: {} },
    {},
);

const embedFrame = () => document.querySelector('dialog.puter-feedback-embed iframe');

const fromEmbed = (data) => window.dispatchEvent(new MessageEvent('message', {
    data, origin: GUI_ORIGIN, source: embedFrame().contentWindow,
}));

let popup;

const fakePuter = ({ guiOrigin = GUI_ORIGIN, signedIn = true } = {}) => {
    globalThis.puter = {
        defaultGUIOrigin: guiOrigin,
        auth: {
            isSignedIn: () => signedIn,
            getUser: vi.fn(async () => ({ uuid: USER })),
        },
    };
};

beforeEach(() => {
    document.body.innerHTML = '';
    popup = { closed: false, close: vi.fn() };
    window.open = vi.fn(() => popup);
    Object.defineProperty(navigator, 'userActivation', {
        configurable: true,
        value: { hasBeenActive: true, isActive: true },
    });
    fakePuter();
});

describe('ui.showFeedbackDialog on a first-party page', () => {
    it('shows the dialog in a frame instead of a popup', async () => {
        const result = makeUI().showFeedbackDialog();
        await vi.waitFor(() => expect(embedFrame()).not.toBeNull());
        fromEmbed({ msg: 'feedbackEmbed', state: 'ready' });
        fromEmbed({ msg: 'feedbackDialogClosed', sent: true });
        await expect(result).resolves.toBe(true);
        expect(window.open).not.toHaveBeenCalled();
    });

    it('names the user puter.js already knows, without asking the API again', async () => {
        globalThis.puter.whoamiCache_ = Promise.resolve({ uuid: USER });
        const result = makeUI().showFeedbackDialog();
        await vi.waitFor(() => expect(embedFrame()).not.toBeNull());
        expect(new URLSearchParams(new URL(embedFrame().src).hash.slice(1)).get('user')).toBe(USER);
        expect(globalThis.puter.auth.getUser).not.toHaveBeenCalled();
        fromEmbed({ msg: 'feedbackDialogClosed', sent: false });
        await expect(result).resolves.toBe(false);
    });

    it('uses the popup when the embed cannot serve the user', async () => {
        const result = makeUI().showFeedbackDialog();
        await vi.waitFor(() => expect(embedFrame()).not.toBeNull());
        fromEmbed({ msg: 'feedbackEmbed', state: 'unavailable' });
        await vi.waitFor(() => expect(window.open).toHaveBeenCalledTimes(1));
        const url = new URL(window.open.mock.calls[0][0]);
        expect(url.origin + url.pathname).toBe(`${GUI_ORIGIN}/action/send-feedback`);

        window.dispatchEvent(new MessageEvent('message', {
            data: { msg: 'feedbackDialogClosed', sent: true, original_msg_id: url.searchParams.get('msg_id') },
            origin: GUI_ORIGIN,
            source: popup,
        }));
        await expect(result).resolves.toBe(true);
    });

    it('answers false to a second call while the framed dialog is open', async () => {
        const ui = makeUI();
        const first = ui.showFeedbackDialog();
        await vi.waitFor(() => expect(embedFrame()).not.toBeNull());
        await expect(ui.showFeedbackDialog()).resolves.toBe(false);
        expect(document.querySelectorAll('dialog.puter-feedback-embed')).toHaveLength(1);
        fromEmbed({ msg: 'feedbackDialogClosed', sent: false });
        await expect(first).resolves.toBe(false);
    });

    it('goes straight to the popup, which can sign in, when the page is signed out', async () => {
        fakePuter({ signedIn: false });
        makeUI().showFeedbackDialog();
        await vi.waitFor(() => expect(window.open).toHaveBeenCalledTimes(1));
        expect(embedFrame()).toBeNull();
    });
});

describe('ui.showFeedbackDialog on a third-party page', () => {
    it('uses the popup', async () => {
        fakePuter({ guiOrigin: 'https://other-puter.test' });
        makeUI().showFeedbackDialog();
        await vi.waitFor(() => expect(window.open).toHaveBeenCalledTimes(1));
        expect(embedFrame()).toBeNull();
        expect(globalThis.puter.auth.getUser).not.toHaveBeenCalled();
    });
});
