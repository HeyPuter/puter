// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://notes.puter.com/sheet"}
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import PuterUserMenu, { canFrameAppBrowser } from './PuterUserMenu.js';

const USER = { username: 'jelveh', uuid: '0b1c9a52-3f0e-4c7a-9a65-2f6d1e8b7c40' };
const OTHER = { username: 'sam', uuid: '7d2e4f10-8a3b-4c5d-9e6f-0a1b2c3d4e5f' };
const PICTURE = 'data:image/png;base64,iVBORw0KGgo=';

/** The SDK instance the component reads, holding one signed-in state at a time. */
const fakePuter = ({ token = null, user = null, picture = null } = {}) => {
    const listeners = new Set();
    let currentPicture = picture;
    const sdk = {
        env: 'web',
        defaultGUIOrigin: 'https://puter.com',
        APIOrigin: 'https://api.puter.com',
        authToken: token,
        whoamiCache_: Promise.resolve(user),
        onAuthStateChanged: (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        auth: {
            getProfilePicture: vi.fn(async () => currentPicture),
            signIn: vi.fn(() => new Promise(() => {})),
            signOut: vi.fn(async () => sdk.signInAs(null)),
        },
        signInAs (nextToken, nextUser = null, nextPicture = null) {
            sdk.authToken = nextToken;
            sdk.whoamiCache_ = Promise.resolve(nextUser);
            currentPicture = nextPicture;
            for ( const listener of listeners ) listener();
        },
        listenerCount: () => listeners.size,
    };
    return sdk;
};

const settle = async () => {
    for ( let i = 0; i < 5; i++ ) await new Promise(resolve => setTimeout(resolve, 0));
};

const mount = async (attributes = {}) => {
    const el = document.createElement('puter-user-menu');
    for ( const [name, value] of Object.entries(attributes) ) el.setAttribute(name, value);
    document.body.appendChild(el);
    await settle();
    return el;
};

const part = (el, selector) => el.shadowRoot.querySelector(selector);
const shown = (el, selector) => {
    const node = part(el, selector);
    return Boolean(node) && !node.closest('[hidden]');
};
const frameOf = el => part(el, '.apps-body iframe');

beforeAll(() => {
    if ( ! customElements.get('puter-user-menu') ) customElements.define('puter-user-menu', PuterUserMenu);
});

beforeEach(() => {
    HTMLDialogElement.prototype.showModal = function () {
        this.setAttribute('open', '');
    };
    HTMLDialogElement.prototype.close = function () {
        if ( ! this.hasAttribute('open') ) return;
        this.removeAttribute('open');
        this.dispatchEvent(new Event('close'));
    };
});

afterEach(() => {
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
});

describe('canFrameAppBrowser', () => {
    it.each([
        ['https://notes.puter.com/a', 'https://puter.com', true],
        ['https://NOTES.puter.com./a', 'https://puter.com', true],
        ['http://notes.puter.localhost:4100/', 'http://puter.localhost:4100', true],
        ['https://puter.com/', 'https://puter.com', false],
        ['https://a.b.puter.com/', 'https://puter.com', false],
        ['https://notputer.com/', 'https://puter.com', false],
        ['https://notes.puter.com.evil.com/', 'https://puter.com', false],
        ['http://notes.puter.com/', 'https://puter.com', false],
        ['https://notes.puter.com:8443/', 'https://puter.com', false],
        ['https://notes.puter.site/', 'https://puter.com', false],
        [undefined, 'https://puter.com', false],
    ])('%s under %s is %s', (page, gui, expected) => {
        expect(canFrameAppBrowser(page, gui)).toBe(expected);
    });
});

describe('<puter-user-menu>', () => {
    it.each(['app', 'gui'])('renders nothing in the %s environment', async (env) => {
        vi.stubGlobal('puter', { ...fakePuter({ token: 't', user: USER }), env });
        const el = await mount();
        expect(shown(el, '.bar')).toBe(false);
        expect(puter.listenerCount()).toBe(0);
    });

    it('offers sign-in and the signed-out app browser when signed out', async () => {
        vi.stubGlobal('puter', fakePuter());
        const el = await mount();
        expect(shown(el, '.sign-in')).toBe(true);
        expect(shown(el, '.avatar')).toBe(false);
        expect(shown(el, '.apps-button')).toBe(true);

        part(el, '.apps-button').click();
        expect(frameOf(el).src).toBe('https://puter.com/embed/apps');
        expect(frameOf(el).getAttribute('referrerpolicy')).toBe('origin');
    });

    it('signs in from the button and reports it', async () => {
        const sdk = fakePuter();
        sdk.auth.signIn.mockResolvedValue({ success: true });
        vi.stubGlobal('puter', sdk);
        const el = await mount();
        const signins = [];
        el.addEventListener('signin', () => signins.push(true));
        part(el, '.sign-in').click();
        expect(sdk.auth.signIn).toHaveBeenCalledTimes(1);
        await settle();
        expect(signins).toHaveLength(1);
    });

    it('shows the signed-in user and names them to the app browser', async () => {
        vi.stubGlobal('puter', fakePuter({ token: 'app-token', user: USER }));
        const el = await mount();
        expect(shown(el, '.sign-in')).toBe(false);
        expect(part(el, '.avatar').textContent).toBe('J');
        expect(part(el, '.avatar').querySelector('img')).toBeNull();
        expect(part(el, '.avatar').getAttribute('aria-label')).toBe('Account: jelveh');

        part(el, '.avatar').click();
        expect(shown(el, '.menu')).toBe(true);
        expect(part(el, '.menu-user').textContent).toBe('jelveh');

        part(el, '.apps-button').click();
        expect(frameOf(el).src).toBe(`https://puter.com/embed/apps#user=${USER.uuid}`);
        expect(part(el, '.apps-dialog').open).toBe(true);
    });

    it('shows the profile picture over the initial when there is one', async () => {
        vi.stubGlobal('puter', fakePuter({ token: 'app-token', user: USER, picture: PICTURE }));
        const el = await mount();
        const img = part(el, '.avatar img');
        expect(img.getAttribute('src')).toBe(PICTURE);
        expect(img.alt).toBe('');
        expect(part(el, '.avatar').textContent).toBe('J');
    });

    it('sends no user when the signed-in user is unknown', async () => {
        vi.stubGlobal('puter', fakePuter({ token: 'app-token', user: null }));
        const el = await mount();
        expect(part(el, '.avatar').textContent).toBe('?');
        part(el, '.apps-button').click();
        expect(frameOf(el).src).toBe('https://puter.com/embed/apps');
    });

    it('closes the app browser and reloads when the sign-in changes', async () => {
        const sdk = fakePuter({ token: 'app-token', user: USER });
        vi.stubGlobal('puter', sdk);
        const el = await mount();
        part(el, '.apps-button').click();

        sdk.signInAs('other-token', OTHER);
        expect(part(el, '.apps-dialog').open).toBe(false);
        expect(frameOf(el)).toBeNull();
        await settle();
        expect(part(el, '.avatar').textContent).toBe('S');
        part(el, '.apps-button').click();
        expect(frameOf(el).src).toBe(`https://puter.com/embed/apps#user=${OTHER.uuid}`);
    });

    it('keeps the app browser open when the same token is set again', async () => {
        const sdk = fakePuter({ token: 'app-token', user: USER });
        vi.stubGlobal('puter', sdk);
        const el = await mount();
        part(el, '.apps-button').click();
        sdk.signInAs('app-token', USER);
        expect(part(el, '.apps-dialog').open).toBe(true);
        expect(frameOf(el)).not.toBeNull();
    });

    it('ignores a user that arrives after the token changed', async () => {
        const sdk = fakePuter({ token: 'app-token' });
        let resolveFirst;
        sdk.whoamiCache_ = new Promise(resolve => {
            resolveFirst = resolve;
        });
        vi.stubGlobal('puter', sdk);
        const el = await mount();
        sdk.signInAs(null);
        resolveFirst(USER);
        await settle();
        expect(shown(el, '.sign-in')).toBe(true);
        part(el, '.apps-button').click();
        expect(frameOf(el).src).toBe('https://puter.com/embed/apps');
    });

    it('signs out from the menu, reports it and drops the user', async () => {
        const sdk = fakePuter({ token: 'app-token', user: USER });
        vi.stubGlobal('puter', sdk);
        const el = await mount();
        const signouts = [];
        el.addEventListener('signout', () => signouts.push(true));
        part(el, '.apps-button').click();
        part(el, '.avatar').click();
        part(el, '.sign-out').click();
        await settle();
        expect(sdk.auth.signOut).toHaveBeenCalledTimes(1);
        expect(signouts).toHaveLength(1);
        expect(frameOf(el)).toBeNull();
        expect(shown(el, '.menu')).toBe(false);
        expect(shown(el, '.sign-in')).toBe(true);
    });

    it('hides the app browser on a page that may not frame it', async () => {
        vi.stubGlobal('puter', { ...fakePuter(), defaultGUIOrigin: 'https://example.com' });
        const el = await mount();
        expect(shown(el, '.sign-in')).toBe(true);
        expect(shown(el, '.apps-button')).toBe(false);
    });

    it('uses label attributes, including ones changed later', async () => {
        vi.stubGlobal('puter', fakePuter({ token: 'app-token', user: USER }));
        const el = await mount({ 'apps-label': 'Applis', 'sign-out-label': 'Déconnexion', 'account-label': 'Compte' });
        expect(part(el, '.apps-button').getAttribute('aria-label')).toBe('Applis');
        expect(part(el, '.apps-title').textContent).toBe('Applis');
        expect(part(el, '.sign-out').textContent).toBe('Déconnexion');
        expect(part(el, '.avatar').getAttribute('aria-label')).toBe('Compte: jelveh');

        el.setAttribute('close-label', 'Fermer');
        el.setAttribute('sign-in-label', 'Connexion');
        expect(part(el, '.apps-close').getAttribute('aria-label')).toBe('Fermer');
        expect(part(el, '.sign-in').textContent).toBe('Connexion');
        el.removeAttribute('apps-label');
        expect(part(el, '.apps-title').textContent).toBe('Apps');
    });

    it('closes the menu on Escape and returns focus to the avatar', async () => {
        vi.stubGlobal('puter', fakePuter({ token: 'app-token', user: USER }));
        const el = await mount();
        part(el, '.avatar').click();
        part(el, '.menu').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(shown(el, '.menu')).toBe(false);
        expect(el.shadowRoot.activeElement).toBe(part(el, '.avatar'));
    });

    it('closes the menu on a press outside it', async () => {
        vi.stubGlobal('puter', fakePuter({ token: 'app-token', user: USER }));
        const el = await mount();
        part(el, '.avatar').click();
        document.body.dispatchEvent(new Event('pointerdown', { bubbles: true, composed: true }));
        expect(shown(el, '.menu')).toBe(false);
    });

    it('stops following the sign-in once removed', async () => {
        const sdk = fakePuter({ token: 'app-token', user: USER });
        vi.stubGlobal('puter', sdk);
        const el = await mount();
        part(el, '.apps-button').click();
        el.remove();
        expect(sdk.listenerCount()).toBe(0);
        expect(frameOf(el)).toBeNull();
    });
});
