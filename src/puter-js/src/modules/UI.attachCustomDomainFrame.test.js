// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://notes.puter.test/doc"}
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The popup the frame falls back to is opened through the shared helper.
const opened = [];
vi.mock('../lib/auth-popup.js', async (importOriginal) => ({
    ...(await importOriginal()),
    hasUserActivation: () => true,
    openAuthPopup: (url, name) => {
        const popup = { url, name, closed: false };
        opened.push(popup);
        return popup;
    },
}));

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
const DOMAIN = { uuid: 'cd-1', hostname: 'www.example.com', site: 'mysite', status: 'pending' };

const frameDialog = () => document.querySelector('dialog.puter-popup-frame');
const domainFrame = () => frameDialog()?.querySelector('iframe') ?? null;
const fragment = () => Object.fromEntries(new URLSearchParams(new URL(domainFrame().src).hash.slice(1)));

const fromFrame = (data) => window.dispatchEvent(new MessageEvent('message', {
    data, origin: GUI_ORIGIN, source: domainFrame().contentWindow,
}));

const makeUI = () => new UIModule(
    { env: 'web', authToken: 'token-1', APIOrigin: 'https://api.puter.test', appID: 'app-1', util: {} },
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

beforeEach(() => {
    document.body.innerHTML = '';
    opened.length = 0;
    fakePuter();
});

afterEach(() => {
    delete globalThis.puter;
    vi.restoreAllMocks();
});

describe('attachCustomDomain_ on a signed-in first-party page', () => {
    it('shows the dialog in a frame over the page and resolves the domain the user chose', async () => {
        const result = makeUI().attachCustomDomain_('mysite');
        await vi.waitFor(() => expect(domainFrame()).not.toBeNull());

        expect(new URL(domainFrame().src).pathname).toBe('/embed/attach-custom-domain');
        const { msg_id, ...rest } = fragment();
        expect(rest).toEqual({ user: USER, subdomain: 'mysite' });
        expect(msg_id).toBeTruthy();
        // It covers the page, and the dialog inside draws the scrim.
        expect(frameDialog().querySelector('.puter-popup-frame-box')).toBeNull();
        expect(frameDialog().querySelector('.puter-popup-frame-close')).toBeNull();
        expect(domainFrame().getAttribute('allow')).toContain('clipboard-write');

        fromFrame({ msg: 'puterPopupFrame', state: 'loading' });
        fromFrame({ msg: 'puterPopupFrame', state: 'ready' });
        expect(frameDialog().open).toBe(true);
        // An answer to another request isn't this one's.
        fromFrame({ msg: 'customDomainAttached', original_msg_id: 'other', domain: { hostname: 'evil.example' } });
        expect(domainFrame()).not.toBeNull();
        fromFrame({ msg: 'customDomainAttached', original_msg_id: msg_id, domain: DOMAIN });

        await expect(result).resolves.toEqual(DOMAIN);
        expect(domainFrame()).toBeNull();
        expect(opened).toHaveLength(0);
    });

    it('resolves null when the user closes the dialog without choosing', async () => {
        const result = makeUI().attachCustomDomain_('mysite');
        await vi.waitFor(() => expect(domainFrame()).not.toBeNull());
        const { msg_id } = fragment();
        fromFrame({ msg: 'puterPopupFrame', state: 'ready' });
        fromFrame({ msg: 'customDomainAttached', original_msg_id: msg_id, domain: null });

        await expect(result).resolves.toBeNull();
        expect(opened).toHaveLength(0);
    });

    it('resolves null when the frame closes without an answer', async () => {
        const result = makeUI().attachCustomDomain_('mysite');
        await vi.waitFor(() => expect(domainFrame()).not.toBeNull());
        fromFrame({ msg: 'puterPopupFrame', state: 'ready' });
        fromFrame({ msg: 'puterPopupFrame', state: 'closed' });

        await expect(result).resolves.toBeNull();
        expect(opened).toHaveLength(0);
    });

    it('leaves Escape on the page to the dialog once it shows', async () => {
        const result = makeUI().attachCustomDomain_('mysite');
        await vi.waitFor(() => expect(domainFrame()).not.toBeNull());
        fromFrame({ msg: 'puterPopupFrame', state: 'ready' });
        frameDialog().dispatchEvent(new Event('cancel', { cancelable: true }));
        expect(domainFrame()).not.toBeNull();

        fromFrame({ msg: 'puterPopupFrame', state: 'closed' });
        await expect(result).resolves.toBeNull();
    });

    it('resolves a call made while it shows null, without replacing it', async () => {
        const ui = makeUI();
        const first = ui.attachCustomDomain_('mysite');
        await vi.waitFor(() => expect(domainFrame()).not.toBeNull());
        const frame = domainFrame();
        const { msg_id } = fragment();

        await expect(ui.attachCustomDomain_('othersite')).resolves.toBeNull();
        expect(domainFrame()).toBe(frame);
        expect(opened).toHaveLength(0);

        fromFrame({ msg: 'customDomainAttached', original_msg_id: msg_id, domain: DOMAIN });
        await expect(first).resolves.toEqual(DOMAIN);

        // A later call shows a new one.
        ui.attachCustomDomain_('mysite');
        await vi.waitFor(() => expect(domainFrame()).not.toBeNull());
        expect(domainFrame()).not.toBe(frame);
    });

    it('opens the popup when the frame cannot show it', async () => {
        const result = makeUI().attachCustomDomain_('mysite');
        await vi.waitFor(() => expect(domainFrame()).not.toBeNull());
        fromFrame({ msg: 'puterPopupFrame', state: 'loading' });
        fromFrame({ msg: 'puterPopupFrame', state: 'unavailable' });

        await vi.waitFor(() => expect(opened).toHaveLength(1));
        expect(domainFrame()).toBeNull();
        const url = new URL(opened[0].url);
        expect(url.pathname).toBe('/action/attach-custom-domain');
        expect(url.searchParams.get('subdomain')).toBe('mysite');

        window.dispatchEvent(new MessageEvent('message', {
            data: { msg: 'customDomainAttached', original_msg_id: url.searchParams.get('msg_id'), domain: DOMAIN },
            origin: GUI_ORIGIN,
            source: opened[0],
        }));
        await expect(result).resolves.toEqual(DOMAIN);
    });

    it('opens the popup when the page has no user to name', async () => {
        puter.whoamiCache_ = Promise.resolve(null);
        puter.auth.getUser = vi.fn(async () => {
            throw new Error('nope');
        });
        makeUI().attachCustomDomain_('mysite');
        await vi.waitFor(() => expect(opened).toHaveLength(1));
        expect(domainFrame()).toBeNull();
    });
});

describe('attachCustomDomain_ on a page that cannot frame the dialog', () => {
    it.each([
        ['a signed-out first-party page', { signedIn: false }],
        ['a page outside the Puter origin', { guiOrigin: 'https://puter.com' }],
    ])('opens the popup within the call on %s', (_label, options) => {
        fakePuter(options);
        makeUI().attachCustomDomain_('mysite');
        expect(opened).toHaveLength(1);
        expect(new URL(opened[0].url).pathname).toBe('/action/attach-custom-domain');
        expect(domainFrame()).toBeNull();
    });
});
