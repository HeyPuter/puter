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
const APP = 'app-0b8a6d4e-6c1f-4a52-9d3e-2f7b1c9e8a10';
const DETAILS = { reason: 'funds', method: 'puter.ai.chat', message: 'Your account does not have enough funding.' };

const upgradeDialog = () => document.querySelector('dialog.puter-popup-frame');
const upgradeFrame = () => upgradeDialog()?.querySelector('iframe') ?? null;
const fragment = () => Object.fromEntries(new URLSearchParams(new URL(upgradeFrame().src).hash.slice(1)));

const fromFrame = (data) => window.dispatchEvent(new MessageEvent('message', {
    data, origin: GUI_ORIGIN, source: upgradeFrame().contentWindow,
}));

const makeUI = (env = 'web') => new UIModule(
    { env, authToken: 'token-1', APIOrigin: 'https://api.puter.test', appID: APP, util: {} },
    { appInstanceID: 'instance-1' },
);

const fakePuter = ({ signedIn = true, guiOrigin = GUI_ORIGIN } = {}) => {
    globalThis.puter = {
        defaultGUIOrigin: guiOrigin,
        appID: APP,
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

describe('ui.requestUpgrade on a signed-in first-party page', () => {
    it('shows the upgrade in a frame over the page and resolves what the dialog reports', async () => {
        const ui = makeUI();
        expect(ui.canShowUpgradeFrame_()).toBe(true);
        const result = ui.requestUpgrade(DETAILS);
        await vi.waitFor(() => expect(upgradeFrame()).not.toBeNull());

        expect(new URL(upgradeFrame().src).pathname).toBe('/embed/upgrade');
        expect(fragment()).toEqual({ user: USER, reason: 'funds', method: 'puter.ai.chat' });
        // It covers the page, and the dialog inside draws the scrim.
        expect(upgradeDialog().querySelector('.puter-popup-frame-box')).toBeNull();
        expect(upgradeDialog().querySelector('.puter-popup-frame-close')).toBeNull();
        expect(upgradeFrame().getAttribute('allow')).toBe('payment; otp-credentials');

        fromFrame({ msg: 'puterPopupFrame', state: 'loading' });
        fromFrame({ msg: 'puterPopupFrame', state: 'ready' });
        expect(upgradeDialog().open).toBe(true);
        fromFrame({ msg: 'puterPopupFrame', state: 'closed', upgraded: true });

        await expect(result).resolves.toEqual({ upgraded: true });
        expect(upgradeFrame()).toBeNull();
        expect(window.open).not.toHaveBeenCalled();
    });

    it('says the upgrade is showing from the call until it closes', async () => {
        const ui = makeUI();
        expect(ui.upgradeFrameShowing_()).toBe(false);
        const result = ui.requestUpgrade();
        expect(ui.upgradeFrameShowing_()).toBe(true);
        await vi.waitFor(() => expect(upgradeFrame()).not.toBeNull());
        fromFrame({ msg: 'puterPopupFrame', state: 'ready' });
        fromFrame({ msg: 'puterPopupFrame', state: 'closed' });
        await result;
        expect(ui.upgradeFrameShowing_()).toBe(false);
    });

    it('settles, and stops showing, when the page removes the frame', async () => {
        const ui = makeUI();
        const result = ui.requestUpgrade();
        await vi.waitFor(() => expect(upgradeFrame()).not.toBeNull());
        fromFrame({ msg: 'puterPopupFrame', state: 'ready' });
        upgradeDialog().remove();
        await expect(result).resolves.toEqual({ upgraded: false });
        expect(ui.upgradeFrameShowing_()).toBe(false);
        expect(window.open).not.toHaveBeenCalled();
    });

    it('resolves upgraded false when the dialog closes without an upgrade', async () => {
        const result = makeUI().requestUpgrade();
        await vi.waitFor(() => expect(upgradeFrame()).not.toBeNull());
        expect(fragment()).toEqual({ user: USER });
        fromFrame({ msg: 'puterPopupFrame', state: 'ready' });
        fromFrame({ msg: 'puterPopupFrame', state: 'closed' });
        await expect(result).resolves.toEqual({ upgraded: false });
    });

    it('leaves Escape on the page to the dialog once it shows', async () => {
        const result = makeUI().requestUpgrade(DETAILS);
        await vi.waitFor(() => expect(upgradeFrame()).not.toBeNull());
        fromFrame({ msg: 'puterPopupFrame', state: 'ready' });

        upgradeDialog().dispatchEvent(new Event('cancel', { cancelable: true }));

        expect(upgradeFrame()).not.toBeNull();
        expect(await settled(result)).toBe(PENDING);
        fromFrame({ msg: 'puterPopupFrame', state: 'closed', upgraded: false });
        await expect(result).resolves.toEqual({ upgraded: false });
    });

    it('settles a call made while the upgrade shows with it, without replacing it', async () => {
        const ui = makeUI();
        const first = ui.requestUpgrade(DETAILS);
        await vi.waitFor(() => expect(upgradeFrame()).not.toBeNull());
        const frame = upgradeFrame();

        const second = ui.requestUpgrade({ reason: 'storage' });

        expect(second).toBe(first);
        expect(document.querySelectorAll('dialog.puter-popup-frame')).toHaveLength(1);
        expect(upgradeFrame()).toBe(frame);
        fromFrame({ msg: 'puterPopupFrame', state: 'ready' });
        fromFrame({ msg: 'puterPopupFrame', state: 'closed', upgraded: true });
        await expect(second).resolves.toEqual({ upgraded: true });

        // A later call shows a new one.
        ui.requestUpgrade(DETAILS);
        await vi.waitFor(() => expect(upgradeFrame()).not.toBeNull());
        expect(upgradeFrame()).not.toBe(frame);
    });

    it('opens the dashboard upgrade in a tab when the frame cannot show it', async () => {
        const result = makeUI().requestUpgrade(DETAILS);
        await vi.waitFor(() => expect(upgradeFrame()).not.toBeNull());
        fromFrame({ msg: 'puterPopupFrame', state: 'loading' });
        fromFrame({ msg: 'puterPopupFrame', state: 'unavailable' });

        await expect(result).resolves.toEqual({ upgraded: false });
        expect(upgradeFrame()).toBeNull();
        expect(window.open).toHaveBeenCalledTimes(1);
        const [url, target] = window.open.mock.calls[0];
        expect(target).toBe('_blank');
        expect(url).toBe(`https://puter.com/dashboard/?upgrade=funds&upgrade_app=${APP}&upgrade_method=puter.ai.chat#home`);
    });

    it('asks for a click before opening the tab once the original click has expired', async () => {
        const ui = makeUI();
        const result = ui.requestUpgrade(DETAILS);
        await vi.waitFor(() => expect(upgradeFrame()).not.toBeNull());
        setActivation(false);
        fromFrame({ msg: 'puterPopupFrame', state: 'unavailable' });
        await vi.waitFor(() => expect(document.querySelector('puter-dialog')).not.toBeNull());

        const consent = document.querySelector('puter-dialog');
        expect(window.open).not.toHaveBeenCalled();
        expect(consent.shadowRoot.querySelector('.about').textContent)
            .toBe('This website wants to open the Puter upgrade page.');
        // Until it's answered the upgrade counts as showing, so a second call
        // joins it instead of asking again.
        expect(ui.upgradeFrameShowing_()).toBe(true);
        expect(await settled(result)).toBe(PENDING);
        const again = ui.requestUpgrade(DETAILS);
        expect(document.querySelectorAll('puter-dialog')).toHaveLength(1);

        consent.shadowRoot.querySelector('#launch-auth-popup').click();
        await expect(result).resolves.toEqual({ upgraded: false });
        await expect(again).resolves.toEqual({ upgraded: false });
        expect(ui.upgradeFrameShowing_()).toBe(false);
        expect(window.open).toHaveBeenCalledTimes(1);
        expect(window.open.mock.calls[0][0]).toContain('https://puter.com/dashboard/?upgrade=funds');
        expect(document.querySelector('puter-dialog')).toBeNull();
    });

    it('asks for a click when the browser blocks the tab', async () => {
        window.open = vi.fn(() => null);
        const result = makeUI().requestUpgrade(DETAILS);
        await vi.waitFor(() => expect(upgradeFrame()).not.toBeNull());
        fromFrame({ msg: 'puterPopupFrame', state: 'unavailable' });
        await vi.waitFor(() => expect(document.querySelector('puter-dialog')).not.toBeNull());
        document.querySelector('puter-dialog').shadowRoot.querySelector('#launch-auth-popup-cancel').click();
        expect(document.querySelector('puter-dialog')).toBeNull();
        await expect(result).resolves.toEqual({ upgraded: false });
        expect(window.open).toHaveBeenCalledTimes(1);
    });

    it('opens the tab when the page has no user to name', async () => {
        puter.whoamiCache_ = Promise.resolve(null);
        puter.auth.getUser = vi.fn(async () => {
            throw new Error('nope');
        });
        await expect(makeUI().requestUpgrade(DETAILS)).resolves.toEqual({ upgraded: false });
        expect(upgradeFrame()).toBeNull();
        expect(window.open).toHaveBeenCalledTimes(1);
    });
});

describe('ui.requestUpgrade elsewhere', () => {
    it('asks the desktop inside an app, as before', () => {
        const post = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
        const ui = makeUI('app');
        expect(ui.canShowUpgradeFrame_()).toBe(false);

        const result = ui.requestUpgrade(DETAILS);

        expect(post).toHaveBeenCalledWith(expect.objectContaining({
            msg: 'requestUpgrade',
            env: 'app',
            appInstanceID: 'instance-1',
            ...DETAILS,
        }), '*');
        expect(result).toBeInstanceOf(Promise);
        expect(upgradeFrame()).toBeNull();
    });

    it.each([
        ['a signed-out first-party page', { signedIn: false }],
        ['a page outside the Puter origin', { guiOrigin: 'https://puter.com' }],
    ])('neither frames nor opens a tab on %s', async (_label, options) => {
        fakePuter(options);
        const ui = makeUI();
        expect(ui.canShowUpgradeFrame_()).toBe(false);
        const result = ui.requestUpgrade(DETAILS);
        expect(await settled(result)).toBe(PENDING);
        expect(upgradeFrame()).toBeNull();
        expect(window.open).not.toHaveBeenCalled();
    });

    it('does not frame on a page in a frame of another site', () => {
        Object.defineProperty(window.location, 'ancestorOrigins', { configurable: true, value: ['https://other.test'] });
        try {
            expect(makeUI().canShowUpgradeFrame_()).toBe(false);
        } finally {
            delete window.location.ancestorOrigins;
        }
    });
});
