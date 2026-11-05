// @vitest-environment jsdom
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

// No token, so the already-held check answers false without a request.
const makeUI = () =>
    new UIModule(
        { env: 'web', authToken: null, APIOrigin: 'https://api.test', appID: 'app-1', util: {} },
        { appInstanceID: 'instance-1' },
    );

const lastUrl = () => new URL(window.open.mock.calls.at(-1)[0]);
const continueButton = () =>
    document.querySelector('puter-dialog').shadowRoot.querySelector('#launch-auth-popup');

let popup;

beforeEach(() => {
    globalThis.puter = { defaultGUIOrigin: GUI_ORIGIN };
    popup = { closed: false };
    window.open = vi.fn(() => popup);
    Object.defineProperty(navigator, 'userActivation', {
        configurable: true,
        value: { hasBeenActive: true, isActive: true },
    });
    document.body.innerHTML = '';
});

afterEach(() => {
    delete navigator.userActivation;
    delete globalThis.puter;
});

describe('ui.requestPermission popup launch on a website', () => {
    it('opens the popup directly under a user gesture, with no dialog', async () => {
        const ui = makeUI();
        const result = ui.requestPermission({ permission: 'backgroundEvents' });
        await vi.waitFor(() => expect(window.open).toHaveBeenCalledTimes(1));
        expect(document.querySelector('puter-dialog')).toBeNull();

        const msg_id = lastUrl().searchParams.get('msg_id');
        window.dispatchEvent(new MessageEvent('message', {
            data: { msg: 'permissionGranted', granted: true, original_msg_id: msg_id },
            origin: GUI_ORIGIN,
            source: popup,
        }));
        await expect(result).resolves.toBe(true);
    });

    // iOS home-screen apps report activation after awaited work but return no window.
    it('falls back to the Continue dialog when the popup comes back null despite activation', async () => {
        window.open = vi.fn().mockReturnValueOnce(null).mockReturnValue(popup);
        const ui = makeUI();
        const result = ui.requestPermission({ permission: 'backgroundEvents' });
        await vi.waitFor(() => expect(document.querySelector('puter-dialog')).not.toBeNull());
        expect(window.open).toHaveBeenCalledTimes(1);

        continueButton().click();
        expect(window.open).toHaveBeenCalledTimes(2);
        const [firstUrl, firstName] = window.open.mock.calls[0];
        const [secondUrl, secondName] = window.open.mock.calls[1];
        expect(secondUrl).toBe(firstUrl);
        expect(secondName).toBe(firstName);

        const msg_id = lastUrl().searchParams.get('msg_id');
        let settled = false;
        result.then(() => {
            settled = true;
        });
        // Pinned to the popup the Continue click opened.
        window.dispatchEvent(new MessageEvent('message', {
            data: { msg: 'permissionGranted', granted: false, original_msg_id: msg_id },
            origin: GUI_ORIGIN,
            source: { other: true },
        }));
        await new Promise((r) => setTimeout(r, 10));
        expect(settled).toBe(false);
        window.dispatchEvent(new MessageEvent('message', {
            data: { msg: 'permissionGranted', granted: true, original_msg_id: msg_id },
            origin: GUI_ORIGIN,
            source: popup,
        }));
        await expect(result).resolves.toBe(true);
        expect(document.querySelector('puter-dialog')).toBeNull();
    });

    it('resolves false when the Continue click is blocked too', async () => {
        window.open = vi.fn(() => null);
        const ui = makeUI();
        const result = ui.requestPermission({ permission: 'backgroundEvents' });
        await vi.waitFor(() => expect(document.querySelector('puter-dialog')).not.toBeNull());

        continueButton().click();
        await expect(result).resolves.toBe(false);
        expect(document.querySelector('puter-dialog')).toBeNull();
    });
});
