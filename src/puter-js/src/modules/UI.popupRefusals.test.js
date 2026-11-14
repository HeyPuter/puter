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

// The flows a website runs in a popup on the Puter origin; each answers false when it can't.
const FLOWS = [
    ['requestPermission', (ui) => ui.requestPermission({ permission: 'fs:/alice/docs:read' })],
    ['enablePush', (ui) => ui.enablePush()],
    ['showFeedbackDialog', (ui) => ui.showFeedbackDialog()],
];

// No token, so requestPermission's already-held check answers without a request.
const makeUI = () =>
    new UIModule(
        { env: 'web', authToken: null, APIOrigin: 'https://api.test', appID: 'app-1', util: {} },
        { appInstanceID: 'instance-1' },
    );

const setActivation = (active) => {
    Object.defineProperty(navigator, 'userActivation', {
        configurable: true,
        value: { hasBeenActive: active, isActive: active },
    });
};

const consentDialog = () => document.querySelector('puter-dialog');
const consentButton = (id) => consentDialog().shadowRoot.querySelector(id);
const consentShown = () => vi.waitFor(() => expect(consentDialog()).not.toBeNull());

let popup;

beforeEach(() => {
    globalThis.puter = { defaultGUIOrigin: GUI_ORIGIN };
    popup = { closed: false, close: vi.fn() };
    window.open = vi.fn(() => popup);
    setActivation(true);
    document.body.innerHTML = '';
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    Object.defineProperty(window, 'crossOriginIsolated', { configurable: true, value: false });
    delete navigator.userActivation;
    delete globalThis.puter;
});

describe.each(FLOWS)('ui.%s on a website that cannot raise the popup', (_name, run) => {
    it('resolves false when the configured GUI origin is not a URL', async () => {
        globalThis.puter.defaultGUIOrigin = 'not a url';

        await expect(run(makeUI())).resolves.toBe(false);
        expect(window.open).not.toHaveBeenCalled();
        expect(consentDialog()).toBeNull();
    });

    it('resolves false where there is no window to open one from', async () => {
        vi.stubGlobal('open', undefined);

        await expect(run(makeUI())).resolves.toBe(false);
        expect(consentDialog()).toBeNull();
    });

    it('resolves false when the consent dialog cannot be shown either', async () => {
        setActivation(false);
        vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(() => {
            throw new DOMException('Modals are not allowed here.', 'InvalidStateError');
        });

        await expect(run(makeUI())).resolves.toBe(false);
        expect(window.open).not.toHaveBeenCalled();
        expect(consentDialog()).toBeNull();
    });

    it('resolves false when the user cancels the consent dialog', async () => {
        setActivation(false);
        const result = run(makeUI());
        await consentShown();

        consentButton('#launch-auth-popup-cancel').click();

        await expect(result).resolves.toBe(false);
        expect(window.open).not.toHaveBeenCalled();
        expect(consentDialog()).toBeNull();
    });
});

describe('ui.requestPermission on a website', () => {
    it.each([
        ['an empty list', { permissions: [] }],
        ['more scopes than one prompt covers', { permissions: Array.from({ length: 17 }, (_, i) => `kv:key-${i}:read`) }],
        ['a scope that is not a string', { permissions: ['kv:key:read', null] }],
        ['an empty scope', { permission: '' }],
    ])('resolves false for %s, without a popup', async (_shape, options) => {
        await expect(makeUI().requestPermission(options)).resolves.toBe(false);
        expect(window.open).not.toHaveBeenCalled();
        expect(consentDialog()).toBeNull();
    });
});

describe('ui.showFeedbackDialog popup on a website', () => {
    it('resolves false when the browser blocks the popup and the Continue click too', async () => {
        window.open = vi.fn(() => null);
        const result = makeUI().showFeedbackDialog();
        await consentShown();

        consentButton('#launch-auth-popup').click();

        await expect(result).resolves.toBe(false);
        expect(window.open).toHaveBeenCalledTimes(2);
        expect(consentDialog()).toBeNull();
    });

    it('resolves false on a cross-origin-isolated page and leaves the popup open', async () => {
        Object.defineProperty(window, 'crossOriginIsolated', { configurable: true, value: true });

        await expect(makeUI().showFeedbackDialog()).resolves.toBe(false);
        expect(window.open).toHaveBeenCalledTimes(1);
        expect(popup.close).not.toHaveBeenCalled();
    });

    it('resolves false for a popup that already reads as closed when it opens', async () => {
        popup.closed = true;

        await expect(makeUI().showFeedbackDialog()).resolves.toBe(false);
        expect(window.open).toHaveBeenCalledTimes(1);
    });
});
