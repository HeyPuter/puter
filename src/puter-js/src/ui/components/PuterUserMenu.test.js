// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://notes.puter.com/sheet"}
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import PuterUserMenu from './PuterUserMenu.js';

const USER = { username: 'jelveh', uuid: '0b1c9a52-3f0e-4c7a-9a65-2f6d1e8b7c40', email: 'jelveh@example.com' };
const OTHER = { username: 'sam', uuid: '7d2e4f10-8a3b-4c5d-9e6f-0a1b2c3d4e5f' };
const TEMP = { username: 'quiet_otter_42', uuid: '5c4b3a29-1807-4f6e-9d5c-4b3a29180716', is_temp: true };
const PICTURE = 'data:image/png;base64,iVBORw0KGgo=';
// Where a trigger sits in the toolbar; jsdom lays nothing out.
const TRIGGER_RECT = { left: 800, right: 836, top: 10, bottom: 46, width: 36, height: 36, x: 800, y: 10 };

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
        ui: {
            showFeedbackDialog: vi.fn(() => new Promise(() => {})),
        },
        auth: {
            getProfilePicture: vi.fn(async () => currentPicture),
            signIn: vi.fn(() => new Promise(() => {})),
            signOut: vi.fn(async () => sdk.signInAs(null)),
        },
        // In the SDK's order: listeners hear of the token before its whoami starts.
        signInAs (nextToken, nextUser = null, nextPicture = null) {
            sdk.authToken = nextToken;
            sdk.whoamiCache_ = null;
            currentPicture = nextPicture;
            for ( const listener of listeners ) listener();
            sdk.whoamiCache_ = Promise.resolve(nextUser);
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
const appsOpen = el => shown(el, '.apps-panel');

beforeAll(() => {
    if ( ! customElements.get('puter-user-menu') ) customElements.define('puter-user-menu', PuterUserMenu);
});

beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(TRIGGER_RECT);
});

afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
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
        expect(appsOpen(el)).toBe(true);
        expect(frameOf(el).src).toBe('https://puter.com/embed/apps');
        expect(frameOf(el).getAttribute('referrerpolicy')).toBe('origin');
    });

    it('treats a temporary account as signed out', async () => {
        const sdk = fakePuter({ token: 'temp-token', user: TEMP, picture: PICTURE });
        vi.stubGlobal('puter', sdk);
        const el = await mount();
        expect(shown(el, '.sign-in')).toBe(true);
        expect(shown(el, '.avatar')).toBe(false);
        expect(sdk.auth.getProfilePicture).not.toHaveBeenCalled();
        part(el, '.apps-button').click();
        expect(frameOf(el).src).toBe('https://puter.com/embed/apps');
    });

    it('signs in from the button and reports the user', async () => {
        const sdk = fakePuter();
        sdk.auth.signIn.mockImplementation(async () => {
            sdk.signInAs('app-token', USER);
            return { success: true };
        });
        vi.stubGlobal('puter', sdk);
        const el = await mount();
        const signins = [];
        el.addEventListener('signin', event => signins.push(event.detail));
        part(el, '.sign-in').click();
        expect(sdk.auth.signIn).toHaveBeenCalledTimes(1);
        await settle();
        expect(signins).toEqual([{ user: USER }]);
        expect(shown(el, '.avatar')).toBe(true);
    });

    it('opens one sign-in at a time, and another once it is closed', async () => {
        const sdk = fakePuter();
        let close;
        sdk.auth.signIn.mockImplementation(() => new Promise((_resolve, reject) => {
            close = reject;
        }));
        vi.stubGlobal('puter', sdk);
        const el = await mount();
        part(el, '.sign-in').click();
        part(el, '.sign-in').click();
        expect(sdk.auth.signIn).toHaveBeenCalledTimes(1);

        close({ error: 'auth_window_closed' });
        await settle();
        part(el, '.sign-in').click();
        expect(sdk.auth.signIn).toHaveBeenCalledTimes(2);
    });

    it('lets a cross-origin isolated page start another sign-in, since it cannot see the popup close', async () => {
        vi.stubGlobal('crossOriginIsolated', true);
        const sdk = fakePuter();
        vi.stubGlobal('puter', sdk);
        const el = await mount();
        part(el, '.sign-in').click();
        part(el, '.sign-in').click();
        expect(sdk.auth.signIn).toHaveBeenCalledTimes(2);
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
        expect(part(el, '.avatar').getAttribute('aria-expanded')).toBe('true');
        expect(part(el, '.menu-username').textContent).toBe('jelveh');
        expect(part(el, '.menu-email').textContent).toBe(USER.email);
        expect(shown(el, '.menu-email')).toBe(true);
        expect(part(el, '.menu-avatar').textContent).toBe('J');

        part(el, '.apps-button').click();
        expect(shown(el, '.menu')).toBe(false);
        expect(appsOpen(el)).toBe(true);
        expect(part(el, '.apps-button').getAttribute('aria-expanded')).toBe('true');
        expect(frameOf(el).src).toBe(`https://puter.com/embed/apps#user=${USER.uuid}`);
    });

    it('links to the account, its usage and Puter, each in a new tab', async () => {
        vi.stubGlobal('puter', fakePuter({ token: 'app-token', user: USER }));
        const el = await mount();
        part(el, '.avatar').click();
        expect(el.shadowRoot.activeElement).toBe(part(el, '.manage-account'));
        const links = [...el.shadowRoot.querySelectorAll('.menu a.menu-item')].map(link => ({
            label: link.textContent,
            href: link.href,
            target: link.target,
            rel: link.rel,
        }));
        expect(links).toEqual([
            { label: 'Manage account', href: 'https://puter.com/dashboard/#account', target: '_blank', rel: 'noopener' },
            { label: 'Usage', href: 'https://puter.com/dashboard/#usage', target: '_blank', rel: 'noopener' },
            { label: 'Open Puter', href: 'https://puter.com/', target: '_blank', rel: 'noopener' },
        ]);

        part(el, '.usage').dispatchEvent(new MouseEvent('click', { cancelable: true }));
        expect(shown(el, '.menu')).toBe(false);
    });

    it('hides the email line when the account has none to show', async () => {
        vi.stubGlobal('puter', fakePuter({ token: 'app-token', user: OTHER }));
        const el = await mount();
        part(el, '.avatar').click();
        expect(part(el, '.menu-username').textContent).toBe('sam');
        expect(shown(el, '.menu-email')).toBe(false);
    });

    it('shows the profile picture in the menu header too', async () => {
        vi.stubGlobal('puter', fakePuter({ token: 'app-token', user: USER, picture: PICTURE }));
        const el = await mount();
        expect(part(el, '.menu-avatar img').getAttribute('src')).toBe(PICTURE);
        expect(part(el, '.menu-avatar').textContent).toBe('J');
    });

    it('opens the feedback dialog from the menu', async () => {
        const sdk = fakePuter({ token: 'app-token', user: USER });
        vi.stubGlobal('puter', sdk);
        const el = await mount();
        part(el, '.avatar').click();
        part(el, '.feedback').click();
        expect(sdk.ui.showFeedbackDialog).toHaveBeenCalledTimes(1);
        expect(shown(el, '.menu')).toBe(false);
    });

    it('moves focus through the menu with the arrow, Home and End keys', async () => {
        vi.stubGlobal('puter', fakePuter({ token: 'app-token', user: USER }));
        const el = await mount();
        part(el, '.avatar').click();
        const press = (key) => {
            const event = new KeyboardEvent('keydown', { key, bubbles: true, composed: true, cancelable: true });
            el.shadowRoot.activeElement.dispatchEvent(event);
            return event;
        };
        const focused = () => el.shadowRoot.activeElement.classList[1];

        expect(focused()).toBe('manage-account');
        expect(press('ArrowDown').defaultPrevented).toBe(true);
        expect(focused()).toBe('usage');
        press('End');
        expect(focused()).toBe('sign-out');
        press('ArrowDown');
        expect(focused()).toBe('manage-account');
        press('ArrowUp');
        expect(focused()).toBe('sign-out');
        press('ArrowUp');
        expect(focused()).toBe('feedback');
        press('Home');
        expect(focused()).toBe('manage-account');
        expect(press('a').defaultPrevented).toBe(false);
        expect(shown(el, '.menu')).toBe(true);
    });

    it('lands the first ArrowDown on the first item when the menu was opened with the pointer', async () => {
        vi.stubGlobal('puter', fakePuter({ token: 'app-token', user: USER }));
        const el = await mount();
        part(el, '.avatar').dispatchEvent(new MouseEvent('click', { detail: 1, bubbles: true, composed: true }));
        expect(shown(el, '.menu')).toBe(true);
        expect(el.shadowRoot.activeElement).toBe(part(el, '.menu'));

        const press = (key) => el.shadowRoot.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, composed: true, cancelable: true }));
        press('ArrowDown');
        expect(el.shadowRoot.activeElement.classList[1]).toBe('manage-account');
    });

    it('hangs the panel under its button with the caret pointing at it', async () => {
        vi.stubGlobal('puter', fakePuter({ token: 'app-token', user: USER }));
        const el = await mount();
        part(el, '.apps-button').click();
        const panel = part(el, '.apps-panel');
        expect(panel.style.top).toBe('56px');
        expect(panel.style.getPropertyValue('--panel-top')).toBe('56px');
        expect(panel.style.left).not.toBe('');
        expect(panel.style.getPropertyValue('--caret-x')).not.toBe('');
    });

    it('closes the panel when its button is laid out of view', async () => {
        vi.stubGlobal('puter', fakePuter({ token: 'app-token', user: USER }));
        const el = await mount();
        HTMLElement.prototype.getBoundingClientRect.mockReturnValue({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 });
        part(el, '.apps-button').click();
        expect(appsOpen(el)).toBe(false);
    });

    it('shows a spinner until the app browser loads', async () => {
        vi.stubGlobal('puter', fakePuter({ token: 'app-token', user: USER }));
        const el = await mount();
        part(el, '.apps-button').click();
        expect(part(el, '.apps-body').classList.contains('is-loading')).toBe(true);
        frameOf(el).dispatchEvent(new Event('load'));
        expect(part(el, '.apps-body').classList.contains('is-loading')).toBe(false);
    });

    it('keeps the app browser between opens', async () => {
        vi.stubGlobal('puter', fakePuter({ token: 'app-token', user: USER }));
        const el = await mount();
        part(el, '.apps-button').click();
        const frame = frameOf(el);
        part(el, '.apps-close').click();
        expect(appsOpen(el)).toBe(false);
        expect(el.shadowRoot.activeElement).toBe(part(el, '.apps-button'));
        part(el, '.apps-button').click();
        expect(appsOpen(el)).toBe(true);
        expect(frameOf(el)).toBe(frame);
    });

    it('shows the profile picture over the initial when there is one', async () => {
        vi.stubGlobal('puter', fakePuter({ token: 'app-token', user: USER, picture: PICTURE }));
        const el = await mount();
        const img = part(el, '.avatar img');
        expect(img.getAttribute('src')).toBe(PICTURE);
        expect(img.alt).toBe('');
        expect(part(el, '.avatar').textContent).toBe('J');
    });

    it('shows the account while its picture is still loading', async () => {
        const sdk = fakePuter({ token: 'app-token', user: USER });
        let resolvePicture;
        sdk.auth.getProfilePicture.mockImplementation(() => new Promise(resolve => { resolvePicture = resolve; }));
        vi.stubGlobal('puter', sdk);
        const el = await mount();
        expect(shown(el, '.avatar')).toBe(true);
        expect(shown(el, '.apps-button')).toBe(true);
        expect(part(el, '.avatar').textContent).toBe('J');
        expect(part(el, '.avatar img')).toBeNull();

        resolvePicture(PICTURE);
        await settle();
        expect(part(el, '.avatar img').getAttribute('src')).toBe(PICTURE);
    });

    it('drops a picture that arrives after the sign-in changed', async () => {
        const sdk = fakePuter({ token: 'app-token', user: USER });
        let resolvePicture;
        sdk.auth.getProfilePicture.mockImplementationOnce(() => new Promise(resolve => { resolvePicture = resolve; }));
        vi.stubGlobal('puter', sdk);
        const el = await mount();
        sdk.signInAs('other-token', OTHER);
        await settle();
        resolvePicture(PICTURE);
        await settle();
        expect(part(el, '.avatar').textContent).toBe('S');
        expect(part(el, '.avatar img')).toBeNull();
    });

    it('sends no user when the signed-in user is unknown', async () => {
        vi.stubGlobal('puter', fakePuter({ token: 'app-token', user: null }));
        const el = await mount();
        expect(part(el, '.avatar').textContent).toBe('?');
        part(el, '.apps-button').click();
        expect(frameOf(el).src).toBe('https://puter.com/embed/apps');
    });

    it('drops the app browser and reloads when the sign-in changes', async () => {
        const sdk = fakePuter({ token: 'app-token', user: USER });
        vi.stubGlobal('puter', sdk);
        const el = await mount();
        part(el, '.apps-button').click();
        part(el, '.apps-close').click();

        sdk.signInAs('other-token', OTHER);
        expect(appsOpen(el)).toBe(false);
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
        const frame = frameOf(el);
        sdk.signInAs('app-token', USER);
        expect(appsOpen(el)).toBe(true);
        expect(frameOf(el)).toBe(frame);
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

    it('follows the OS theme unless told otherwise, in the app browser too', async () => {
        vi.stubGlobal('puter', fakePuter({ token: 'app-token', user: USER }));
        const el = await mount();
        part(el, '.apps-button').click();
        expect(frameOf(el).style.colorScheme).toBe('light');

        expect(frameOf(el).src).toBe(`https://puter.com/embed/apps#user=${USER.uuid}`);

        // The forced theme is in the URL, since not every browser passes `color-scheme` on.
        el.setAttribute('theme', 'dark');
        await settle();
        expect(el.classList.contains('puter-theme-dark')).toBe(true);
        expect(frameOf(el).style.colorScheme).toBe('dark');
        expect(frameOf(el).src).toBe(`https://puter.com/embed/apps#user=${USER.uuid}&theme=dark`);
        expect(appsOpen(el)).toBe(true);
        expect(part(el, '.apps-body').classList.contains('is-loading')).toBe(true);
    });

    it('opens a new app browser in the forced theme', async () => {
        vi.stubGlobal('puter', fakePuter());
        const el = await mount({ theme: 'light' });
        part(el, '.apps-button').click();
        expect(frameOf(el).style.colorScheme).toBe('light');
        expect(frameOf(el).src).toBe('https://puter.com/embed/apps#theme=light');
    });

    it('keeps a closed app browser until the theme changes, then loads it in the new theme', async () => {
        vi.stubGlobal('puter', fakePuter({ token: 'app-token', user: USER }));
        const el = await mount({ theme: 'light' });
        part(el, '.apps-button').click();
        const frame = frameOf(el);
        part(el, '.apps-close').click();
        el.setAttribute('theme', 'light');
        await settle();
        expect(frameOf(el)).toBe(frame);

        el.setAttribute('theme', 'dark');
        await settle();
        expect(frameOf(el)).toBeNull();
        expect(appsOpen(el)).toBe(false);
        part(el, '.apps-button').click();
        expect(frameOf(el).src).toBe(`https://puter.com/embed/apps#user=${USER.uuid}&theme=dark`);
    });

    it('exposes parts for the host to style', async () => {
        vi.stubGlobal('puter', fakePuter({ token: 'app-token', user: USER }));
        const el = await mount();
        const parts = [...el.shadowRoot.querySelectorAll('[part]')].map(node => node.getAttribute('part'));
        expect(parts.sort()).toEqual(['apps-button', 'apps-panel', 'avatar', 'menu', 'sign-in']);
    });

    it('uses label attributes, including ones changed later', async () => {
        vi.stubGlobal('puter', fakePuter({ token: 'app-token', user: USER }));
        const el = await mount({
            'apps-label': 'Applis',
            'sign-out-label': 'Déconnexion',
            'account-label': 'Compte',
            'manage-account-label': 'Gérer le compte',
            'usage-label': 'Utilisation',
            'open-puter-label': 'Ouvrir Puter',
            'feedback-label': 'Envoyer un avis',
        });
        expect(part(el, '.apps-button').getAttribute('aria-label')).toBe('Applis');
        expect(part(el, '.apps-title').textContent).toBe('Applis');
        expect(part(el, '.apps-panel').getAttribute('aria-label')).toBe('Applis');
        expect(part(el, '.sign-out').textContent).toBe('Déconnexion');
        expect(part(el, '.avatar').getAttribute('aria-label')).toBe('Compte: jelveh');
        expect(part(el, '.manage-account').textContent).toBe('Gérer le compte');
        expect(part(el, '.usage').textContent).toBe('Utilisation');
        expect(part(el, '.open-puter').textContent).toBe('Ouvrir Puter');
        expect(part(el, '.feedback').textContent).toBe('Envoyer un avis');
        expect(part(el, '.manage-account .menu-external')).not.toBeNull();

        el.setAttribute('close-label', 'Fermer');
        el.setAttribute('sign-in-label', 'Connexion');
        expect(part(el, '.apps-close').getAttribute('aria-label')).toBe('Fermer');
        expect(part(el, '.sign-in').textContent).toBe('Connexion');
        el.removeAttribute('apps-label');
        expect(part(el, '.apps-title').textContent).toBe('Apps');
    });

    it.each([['.avatar', '.menu'], ['.apps-button', '.apps-panel']])(
        'closes %s\'s panel on Escape and returns focus to it', async (trigger, panel) => {
            vi.stubGlobal('puter', fakePuter({ token: 'app-token', user: USER }));
            const el = await mount();
            part(el, trigger).click();
            part(el, panel).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }));
            expect(shown(el, panel)).toBe(false);
            expect(el.shadowRoot.activeElement).toBe(part(el, trigger));
        },
    );

    it.each([['.avatar', '.menu'], ['.apps-button', '.apps-panel']])(
        'closes %s\'s panel on a press outside it, and not on one inside', async (trigger, panel) => {
            vi.stubGlobal('puter', fakePuter({ token: 'app-token', user: USER }));
            const el = await mount();
            part(el, trigger).click();
            part(el, panel).dispatchEvent(new Event('pointerdown', { bubbles: true, composed: true }));
            expect(shown(el, panel)).toBe(true);
            document.body.dispatchEvent(new Event('pointerdown', { bubbles: true, composed: true }));
            expect(shown(el, panel)).toBe(false);
        },
    );

    it('toggles a panel closed from its own button', async () => {
        vi.stubGlobal('puter', fakePuter({ token: 'app-token', user: USER }));
        const el = await mount();
        part(el, '.apps-button').click();
        part(el, '.apps-button').click();
        expect(appsOpen(el)).toBe(false);
        expect(frameOf(el)).not.toBeNull();
    });

    it('stops following the sign-in once removed', async () => {
        const sdk = fakePuter({ token: 'app-token', user: USER });
        vi.stubGlobal('puter', sdk);
        const el = await mount();
        part(el, '.apps-button').click();
        el.remove();
        expect(sdk.listenerCount()).toBe(0);
        expect(frameOf(el)).toBeNull();
        expect(appsOpen(el)).toBe(false);
    });
});
