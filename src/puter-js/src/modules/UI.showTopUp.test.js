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
const TOP_UP_TAB = 'https://puter.com/dashboard/?topup=#usage';

const topUpDialog = () => document.querySelector('dialog.puter-popup-frame');
const topUpFrame = () => topUpDialog()?.querySelector('iframe') ?? null;
const fragment = () => Object.fromEntries(new URLSearchParams(new URL(topUpFrame().src).hash.slice(1)));

const fromFrame = (data) => window.dispatchEvent(new MessageEvent('message', {
    data, origin: GUI_ORIGIN, source: topUpFrame().contentWindow,
}));

const makeUI = (env = 'web') => new UIModule(
    { env, authToken: 'token-1', APIOrigin: 'https://api.puter.test', util: {} },
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

const setActivation = (isActive) => Object.defineProperty(navigator, 'userActivation', {
    configurable: true,
    value: { hasBeenActive: true, isActive },
});

const PENDING = Symbol('pending');
const settled = (promise) => Promise.race([promise, new Promise((r) => setTimeout(() => r(PENDING), 0))]);

beforeEach(() => {
    document.body.innerHTML = '';
    window.open = vi.fn(() => ({ closed: false }));
    setActivation(true);
    fakePuter();
});

afterEach(() => {
    delete navigator.userActivation;
    delete globalThis.puter;
    vi.restoreAllMocks();
});

describe('ui.showTopUp_ on a signed-in first-party page', () => {
    it('shows the top-up in a frame over the page and resolves what the dialog reports', async () => {
        const result = makeUI().showTopUp_();
        await vi.waitFor(() => expect(topUpFrame()).not.toBeNull());

        expect(new URL(topUpFrame().src).pathname).toBe('/embed/top-up');
        expect(fragment()).toEqual({ user: USER });
        // It covers the page, and the dialog inside draws the scrim.
        expect(topUpDialog().querySelector('.puter-popup-frame-box')).toBeNull();
        expect(topUpDialog().querySelector('.puter-popup-frame-close')).toBeNull();
        expect(topUpFrame().getAttribute('allow')).toBe('payment; otp-credentials');

        fromFrame({ msg: 'puterPopupFrame', state: 'loading' });
        fromFrame({ msg: 'puterPopupFrame', state: 'ready' });
        expect(topUpDialog().open).toBe(true);
        fromFrame({ msg: 'puterPopupFrame', state: 'closed', toppedUp: true });

        await expect(result).resolves.toEqual({ toppedUp: true });
        expect(topUpFrame()).toBeNull();
        expect(window.open).not.toHaveBeenCalled();
    });

    it('resolves toppedUp false when the dialog closes without a purchase', async () => {
        const result = makeUI().showTopUp_();
        await vi.waitFor(() => expect(topUpFrame()).not.toBeNull());
        fromFrame({ msg: 'puterPopupFrame', state: 'ready' });
        fromFrame({ msg: 'puterPopupFrame', state: 'closed' });
        await expect(result).resolves.toEqual({ toppedUp: false });
    });

    it('leaves Escape on the page to the dialog once it shows', async () => {
        const result = makeUI().showTopUp_();
        await vi.waitFor(() => expect(topUpFrame()).not.toBeNull());
        fromFrame({ msg: 'puterPopupFrame', state: 'ready' });

        topUpDialog().dispatchEvent(new Event('cancel', { cancelable: true }));

        expect(topUpFrame()).not.toBeNull();
        expect(await settled(result)).toBe(PENDING);
        fromFrame({ msg: 'puterPopupFrame', state: 'closed', toppedUp: false });
        await expect(result).resolves.toEqual({ toppedUp: false });
    });

    it('settles a call made while the top-up shows with it, without replacing it', async () => {
        const ui = makeUI();
        const first = ui.showTopUp_();
        await vi.waitFor(() => expect(topUpFrame()).not.toBeNull());
        const frame = topUpFrame();

        const second = ui.showTopUp_();

        expect(second).toBe(first);
        expect(document.querySelectorAll('dialog.puter-popup-frame')).toHaveLength(1);
        fromFrame({ msg: 'puterPopupFrame', state: 'ready' });
        fromFrame({ msg: 'puterPopupFrame', state: 'closed', toppedUp: true });
        await expect(second).resolves.toEqual({ toppedUp: true });

        // A later call shows a new one.
        ui.showTopUp_();
        await vi.waitFor(() => expect(topUpFrame()).not.toBeNull());
        expect(topUpFrame()).not.toBe(frame);
    });

    it('opens the dashboard top-up in a tab when the frame cannot show it', async () => {
        const result = makeUI().showTopUp_();
        await vi.waitFor(() => expect(topUpFrame()).not.toBeNull());
        fromFrame({ msg: 'puterPopupFrame', state: 'loading' });
        fromFrame({ msg: 'puterPopupFrame', state: 'unavailable' });

        await expect(result).resolves.toEqual({ toppedUp: false });
        expect(topUpFrame()).toBeNull();
        expect(window.open).toHaveBeenCalledTimes(1);
        expect(window.open).toHaveBeenCalledWith(TOP_UP_TAB, '_blank');
    });

    it('asks for a click before opening the tab once the original click has expired', async () => {
        const result = makeUI().showTopUp_();
        await vi.waitFor(() => expect(topUpFrame()).not.toBeNull());
        setActivation(false);
        fromFrame({ msg: 'puterPopupFrame', state: 'unavailable' });
        await vi.waitFor(() => expect(document.querySelector('puter-dialog')).not.toBeNull());

        const consent = document.querySelector('puter-dialog');
        expect(window.open).not.toHaveBeenCalled();
        expect(consent.shadowRoot.querySelector('.about').textContent)
            .toBe('This website wants to open the Puter top-up page.');

        consent.shadowRoot.querySelector('#launch-auth-popup').click();
        await expect(result).resolves.toEqual({ toppedUp: false });
        expect(window.open).toHaveBeenCalledWith(TOP_UP_TAB, '_blank');
    });
});

describe('ui.showTopUp_ elsewhere on the web', () => {
    it.each([
        ['a page outside the Puter origin', { guiOrigin: 'https://puter.com' }],
        ['a signed-out first-party page', { signedIn: false }],
    ])('opens the dashboard top-up in a tab within the click on %s', async (_label, options) => {
        fakePuter(options);
        const result = makeUI().showTopUp_();

        // Before anything is awaited, so the browser still counts the click.
        expect(window.open).toHaveBeenCalledTimes(1);
        expect(window.open).toHaveBeenCalledWith(TOP_UP_TAB, '_blank');
        expect(topUpFrame()).toBeNull();
        await expect(result).resolves.toEqual({ toppedUp: false });
    });
});

describe('ui.requestUpgrade beside the top-up', () => {
    it('still asks before opening the upgrade tab in its own words', async () => {
        const result = makeUI().requestUpgrade({ reason: 'funds' });
        const frame = () => document.querySelector('dialog.puter-popup-frame iframe');
        await vi.waitFor(() => expect(frame()).not.toBeNull());
        expect(new URL(frame().src).pathname).toBe('/embed/upgrade');
        setActivation(false);
        window.dispatchEvent(new MessageEvent('message', {
            data: { msg: 'puterPopupFrame', state: 'unavailable' }, origin: GUI_ORIGIN, source: frame().contentWindow,
        }));
        await vi.waitFor(() => expect(document.querySelector('puter-dialog')).not.toBeNull());
        const consent = document.querySelector('puter-dialog');
        expect(consent.shadowRoot.querySelector('.about').textContent)
            .toBe('This website wants to open the Puter upgrade page.');
        consent.shadowRoot.querySelector('#launch-auth-popup-cancel').click();
        await expect(result).resolves.toEqual({ upgraded: false });
    });
});
