/**
 * <puter-user-menu> - The signed-in user's account button and Puter's app
 * browser, for a page that signs in with puter.js.
 *
 * Signed out, it shows a Sign in button. Signed in, it shows the user's
 * profile picture (or initial), which opens a menu with the username and
 * Sign out. On a page one subdomain under the Puter origin, an Apps button
 * opens Puter's app browser for the same user: signed out, or signed in as an
 * account other than the Puter session's, the browser shows only recommended
 * apps. The browser closes whenever the page's sign-in changes. Renders
 * nothing inside the Puter desktop.
 *
 * Attributes: theme, apps-label, sign-in-label, sign-out-label, close-label,
 *   account-label
 * Events: signin, signout
 */

import PuterWebComponent from '../PuterWebComponent.js';
import { defaultFontFamily } from '../PuterDefaultStyles.js';

const APPS_ICON = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">${
    [5, 12, 19].flatMap(y => [5, 12, 19].map(x => `<circle cx="${x}" cy="${y}" r="2.2"/>`)).join('')
}</svg>`;

const LABELS = {
    'apps-label': 'Apps',
    'sign-in-label': 'Sign in',
    'sign-out-label': 'Sign out',
    'close-label': 'Close',
    'account-label': 'Account',
};

/**
 * Whether a page at `pageUrl` may frame the app browser served by
 * `guiOrigin`: exactly one label under its host, on the same scheme and port.
 *
 * @param {string | undefined} pageUrl
 * @param {string} guiOrigin
 * @returns {boolean}
 */
export const canFrameAppBrowser = (pageUrl, guiOrigin) => {
    let page;
    let gui;
    try {
        page = new URL(pageUrl);
        gui = new URL(guiOrigin);
    } catch {
        return false;
    }
    const host = page.hostname.replace(/\.$/, '').toLowerCase();
    const suffix = `.${gui.hostname.toLowerCase()}`;
    if ( page.protocol !== gui.protocol || page.port !== gui.port || !host.endsWith(suffix) ) return false;
    const label = host.slice(0, -suffix.length);
    return label.length > 0 && !label.includes('.');
};

class PuterUserMenu extends PuterWebComponent {
    static get observedAttributes () {
        return Object.keys(LABELS);
    }

    #unsubscribe = null;
    // Bumped on every load, so a slower earlier load can't overwrite a later one.
    #generation = 0;
    #ready = false;
    #token = null;
    #apiOrigin = null;
    #user = null;
    #picture = null;
    #onDocumentPointerDown = (event) => {
        if ( ! event.composedPath().includes(this) ) this._closeMenu();
    };

    connectedCallback () {
        super.connectedCallback();
        // The SDK defines this element before it assigns `globalThis.puter`.
        queueMicrotask(() => this._start());
    }

    disconnectedCallback () {
        super.disconnectedCallback();
        this.#unsubscribe?.();
        this.#unsubscribe = null;
        this.#generation++;
        document.removeEventListener('pointerdown', this.#onDocumentPointerDown, true);
        this._closeApps();
    }

    attributeChangedCallback () {
        if ( this.$('.bar') ) this._applyLabels();
    }

    _label (name) {
        return this.getAttribute(name) || LABELS[name];
    }

    /** Only a top-level page that signs in on its own; the desktop has its own menu. */
    _active () {
        return globalThis.puter?.env === 'web';
    }

    _appsAllowed () {
        return canFrameAppBrowser(globalThis.location?.href, globalThis.puter.defaultGUIOrigin);
    }

    _start () {
        if ( !this.isConnected || this.#unsubscribe || !this._active() ) return;
        this.$('.bar').hidden = false;
        this.#unsubscribe = globalThis.puter.onAuthStateChanged(() => {
            const puter = globalThis.puter;
            if ( puter.authToken === this.#token && puter.APIOrigin === this.#apiOrigin ) return;
            this._closeApps();
            this._load();
        });
        this._load();
    }

    async _load () {
        const generation = ++this.#generation;
        const puter = globalThis.puter;
        this.#ready = false;
        this.#user = null;
        this.#picture = null;
        this.#token = puter.authToken;
        this.#apiOrigin = puter.APIOrigin;
        this._renderState();

        // A tab Puter opened for an app gets its token moments after loading.
        if ( puter.openerLaunch_ ) await puter.openerLaunch_.catch(() => {});
        let user = null;
        let picture = null;
        const token = puter.authToken;
        if ( token ) {
            [user, picture] = await Promise.all([
                puter.whoami ?? Promise.resolve(puter.whoamiCache_).catch(() => null),
                puter.auth.getProfilePicture().catch(() => null),
            ]);
        }
        if ( generation !== this.#generation ) return;
        // Answers for a token since replaced; the newer token loads again.
        const current = token === puter.authToken;
        this.#token = puter.authToken;
        this.#apiOrigin = puter.APIOrigin;
        this.#user = current && user && typeof user === 'object' ? user : null;
        this.#picture = current && typeof picture === 'string' ? picture : null;
        this.#ready = true;
        this._renderState();
    }

    getStyles () {
        return `
            :host {
                display: inline-flex;
                font-family: ${defaultFontFamily};
                -webkit-font-smoothing: antialiased;
            }
            [hidden] { display: none !important; }
            .bar {
                display: flex;
                align-items: center;
                gap: 8px;
            }
            .account { position: relative; }
            button {
                font-family: inherit;
                cursor: pointer;
                -webkit-tap-highlight-color: transparent;
            }
            button:focus-visible {
                outline: 2px solid #088ef0;
                outline-offset: 2px;
            }
            .apps-button {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 36px;
                height: 36px;
                padding: 0;
                border: none;
                border-radius: 50%;
                background: transparent;
                color: #414650;
                fill: currentColor;
            }
            .apps-button:hover { background-color: rgba(0, 0, 0, .06); }
            .avatar {
                position: relative;
                width: 32px;
                height: 32px;
                padding: 0;
                overflow: hidden;
                border: none;
                border-radius: 50%;
                background: linear-gradient(#34a5f8, #088ef0);
                color: #fff;
                font-size: 15px;
                font-weight: 600;
                line-height: 32px;
                text-align: center;
            }
            .avatar img {
                position: absolute;
                inset: 0;
                width: 100%;
                height: 100%;
                object-fit: cover;
            }
            .sign-in {
                height: 32px;
                padding: 0 16px;
                border: 1px solid #088ef0;
                border-radius: 4px;
                background: linear-gradient(#34a5f8, #088ef0);
                color: #fff;
                font-size: 14px;
            }
            .menu {
                position: absolute;
                top: calc(100% + 6px);
                right: 0;
                z-index: 1;
                min-width: 200px;
                max-width: min(300px, calc(100vw - 16px));
                box-sizing: border-box;
                padding: 4px 0;
                border: 1px solid #e3e3e3;
                border-radius: 6px;
                background-color: #fff;
                box-shadow: 0 4px 16px rgba(0, 0, 0, .18);
                text-align: left;
            }
            .menu-user {
                padding: 8px 14px 10px;
                margin-bottom: 4px;
                border-bottom: 1px solid #e3e3e3;
                color: #414650;
                font-size: 14px;
                font-weight: 600;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            .menu-item {
                display: block;
                width: 100%;
                padding: 8px 14px;
                border: none;
                background: none;
                color: #333;
                font-size: 14px;
                text-align: left;
            }
            .menu-item:hover, .menu-item:focus-visible {
                outline: none;
                background-color: #e2e2e2;
            }
            dialog {
                width: min(900px, calc(100vw - 32px));
                height: min(650px, calc(100vh - 32px));
                max-width: none;
                max-height: none;
                padding: 0;
                border: none;
                border-radius: 8px;
                overflow: hidden;
                background-color: #fff;
                box-shadow: 0 0 15px rgba(0, 0, 0, .4);
            }
            dialog[open] {
                display: flex;
                flex-direction: column;
            }
            dialog::backdrop { background: rgba(0, 0, 0, .5); }
            .apps-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                flex: none;
                height: 44px;
                padding: 0 6px 0 16px;
                border-bottom: 1px solid #e3e3e3;
                color: #414650;
                font-size: 15px;
                font-weight: 600;
            }
            .apps-close {
                width: 36px;
                height: 36px;
                padding: 0;
                border: none;
                border-radius: 50%;
                background: transparent;
                color: #666;
                font-size: 22px;
                line-height: 36px;
            }
            .apps-close:hover { background-color: rgba(0, 0, 0, .06); }
            .apps-body { flex: 1; min-height: 0; }
            .apps-body iframe {
                display: block;
                width: 100%;
                height: 100%;
                border: 0;
            }
            @media (max-width: 480px) {
                dialog {
                    width: 100vw;
                    height: 100vh;
                    height: 100dvh;
                    margin: 0;
                    border-radius: 0;
                }
            }
            :host(.puter-theme-dark) .apps-button { color: #e6e6e6; }
            :host(.puter-theme-dark) .apps-button:hover,
            :host(.puter-theme-dark) .apps-close:hover { background-color: rgba(255, 255, 255, .1); }
            :host(.puter-theme-dark) .menu,
            :host(.puter-theme-dark) dialog {
                background-color: #2a2a2a;
                border-color: #3a3a3a;
            }
            :host(.puter-theme-dark) .menu-user,
            :host(.puter-theme-dark) .apps-header {
                color: #e6e6e6;
                border-color: #3a3a3a;
            }
            :host(.puter-theme-dark) .menu-item { color: #e6e6e6; }
            :host(.puter-theme-dark) .menu-item:hover,
            :host(.puter-theme-dark) .menu-item:focus-visible { background-color: #3a3a3a; }
            :host(.puter-theme-dark) .apps-close { color: #ccc; }
        `;
    }

    render () {
        return `
            <div class="bar" hidden>
                <button type="button" class="apps-button" hidden>${APPS_ICON}</button>
                <div class="account">
                    <button type="button" class="sign-in" hidden></button>
                    <button type="button" class="avatar" aria-haspopup="menu" aria-expanded="false" hidden></button>
                    <div class="menu" role="menu" hidden>
                        <div class="menu-user" hidden></div>
                        <button type="button" class="menu-item sign-out" role="menuitem"></button>
                    </div>
                </div>
            </div>
            <dialog class="apps-dialog">
                <div class="apps-header">
                    <span class="apps-title"></span>
                    <button type="button" class="apps-close">&times;</button>
                </div>
                <div class="apps-body"></div>
            </dialog>
        `;
    }

    onReady () {
        this._applyLabels();
        this.$('.apps-button').addEventListener('click', () => this._openApps());
        this.$('.sign-in').addEventListener('click', () => this._signIn());
        this.$('.avatar').addEventListener('click', () => {
            if ( this.$('.menu').hidden ) this._openMenu();
            else this._closeMenu();
        });
        this.$('.sign-out').addEventListener('click', () => this._signOut());
        this.$('.account').addEventListener('focusout', (event) => {
            if ( ! this.$('.account').contains(event.relatedTarget) ) this._closeMenu();
        });
        this.$('.menu').addEventListener('keydown', (event) => {
            if ( event.key !== 'Escape' ) return;
            event.preventDefault();
            this._closeMenu();
            this.$('.avatar').focus();
        });

        const dialog = this.$('.apps-dialog');
        this.$('.apps-close').addEventListener('click', () => dialog.close());
        // A press on the backdrop lands on the dialog itself.
        dialog.addEventListener('click', (event) => {
            if ( event.target === dialog ) dialog.close();
        });
        dialog.addEventListener('close', () => {
            this.$('.apps-body').replaceChildren();
            const button = this.$('.apps-button');
            if ( ! button.hidden ) button.focus();
        });
    }

    _applyLabels () {
        const apps = this._label('apps-label');
        const appsButton = this.$('.apps-button');
        appsButton.setAttribute('aria-label', apps);
        appsButton.title = apps;
        this.$('.apps-dialog').setAttribute('aria-label', apps);
        this.$('.apps-title').textContent = apps;
        const frame = this.$('.apps-body iframe');
        if ( frame ) frame.title = apps;
        this.$('.apps-close').setAttribute('aria-label', this._label('close-label'));
        this.$('.sign-in').textContent = this._label('sign-in-label');
        this.$('.sign-out').textContent = this._label('sign-out-label');
        this._renderAvatarLabel();
    }

    _username () {
        return typeof this.#user?.username === 'string' ? this.#user.username : '';
    }

    _renderAvatarLabel () {
        const username = this._username();
        const account = this._label('account-label');
        this.$('.avatar').setAttribute('aria-label', username ? `${account}: ${username}` : account);
    }

    _renderState () {
        const signedIn = Boolean(this.#token);
        const username = this._username();
        this.$('.apps-button').hidden = !this.#ready || !this._appsAllowed();
        this.$('.sign-in').hidden = !this.#ready || signedIn;

        const avatar = this.$('.avatar');
        avatar.hidden = !this.#ready || !signedIn;
        avatar.textContent = username ? username[0].toUpperCase() : '?';
        if ( this.#picture ) {
            const img = document.createElement('img');
            img.alt = '';
            // The initial stays underneath for a picture the page's CSP refuses.
            img.addEventListener('error', () => img.remove());
            img.src = this.#picture;
            avatar.append(img);
        }
        this._renderAvatarLabel();
        const menuUser = this.$('.menu-user');
        menuUser.textContent = username;
        menuUser.hidden = !username;
        if ( avatar.hidden ) this._closeMenu();
    }

    _openMenu () {
        this.$('.menu').hidden = false;
        this.$('.avatar').setAttribute('aria-expanded', 'true');
        document.addEventListener('pointerdown', this.#onDocumentPointerDown, true);
        this.$('.sign-out').focus();
    }

    _closeMenu () {
        const menu = this.$('.menu');
        if ( !menu || menu.hidden ) return;
        menu.hidden = true;
        this.$('.avatar').setAttribute('aria-expanded', 'false');
        document.removeEventListener('pointerdown', this.#onDocumentPointerDown, true);
    }

    _openApps () {
        const dialog = this.$('.apps-dialog');
        if ( !this.#ready || dialog.open ) return;
        const url = new URL('/embed/apps', globalThis.puter.defaultGUIOrigin);
        // The app browser shows the Puter session only to the user named here.
        const uuid = this.#token === globalThis.puter.authToken ? this.#user?.uuid : null;
        if ( typeof uuid === 'string' && uuid ) url.hash = `user=${encodeURIComponent(uuid)}`;

        const frame = document.createElement('iframe');
        frame.title = this._label('apps-label');
        // The app browser allows a framing page it can name from the referrer.
        frame.setAttribute('referrerpolicy', 'origin');
        frame.src = url.href;
        this.$('.apps-body').replaceChildren(frame);
        dialog.showModal();
    }

    _closeApps () {
        const dialog = this.$('.apps-dialog');
        if ( dialog?.open ) dialog.close();
        this.$('.apps-body')?.replaceChildren();
    }

    _signIn () {
        // Called inside the click, so the sign-in popup isn't blocked.
        globalThis.puter.auth.signIn().then(
            () => this.emitEvent('signin'),
            () => { /* Closed or refused; the button stays for another try. */ },
        );
    }

    async _signOut () {
        this._closeMenu();
        try {
            await globalThis.puter.auth.signOut();
        } finally {
            // The token goes before the sign-out settles, even when it rejects.
            if ( ! globalThis.puter.authToken ) this.emitEvent('signout');
        }
    }
}

export default PuterUserMenu;
