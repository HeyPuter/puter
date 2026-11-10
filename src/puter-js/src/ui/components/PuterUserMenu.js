/**
 * <puter-user-menu> - The signed-in user's account button and Puter's app
 * browser, for a page that signs in with puter.js.
 *
 * Signed out (a temporary account counts as signed out), it shows a Sign in
 * button. Signed in, it shows the user's profile picture (or initial), which
 * opens a menu with the account, links to manage it, see its usage and open
 * Puter, Add credits for an account with a plan, Send feedback, and Sign out.
 * On a page one subdomain under
 * the Puter origin, an Apps button opens Puter's app browser in a panel under
 * it, for the same user: signed out, or signed in as an account other than
 * the Puter session's, the browser shows only recommended apps. The browser
 * is kept between opens and dropped whenever the page's sign-in changes.
 * Renders nothing inside the Puter desktop.
 *
 * Attributes: theme, apps-label, sign-in-label, sign-out-label, close-label,
 *   account-label, manage-account-label, usage-label, add-credits-label,
 *   open-puter-label, feedback-label
 * Parts: apps-button, avatar, sign-in, menu, apps-panel
 * Events: signin (detail.user), signout
 */

import PuterWebComponent from '../PuterWebComponent.js';
import { defaultFontFamily } from '../PuterDefaultStyles.js';
import { canFrameGuiEmbed } from '../../lib/guiEmbed.js';
import { canTopUp } from '../../lib/topUp.js';

const APPS_ICON = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">${
    [5, 12, 19].flatMap(y => [5, 12, 19].map(x => `<circle cx="${x}" cy="${y}" r="2"/>`)).join('')
}</svg>`;
const EXTERNAL_ICON = '<svg class="menu-external" viewBox="0 0 32 32" width="11" height="11" aria-hidden="true" focusable="false"><path d="m26 28h-20a2 2 0 0 1 -2-2v-20a2 2 0 0 1 2-2h10v2h-10v20h20v-10h2v10a2 2 0 0 1 -2 2z"/><path d="m20 2v2h6.586l-8.586 8.586 1.414 1.414 8.586-8.586v6.586h2v-10z"/></svg>';
const CLOSE_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';

const LABELS = {
    'apps-label': 'Apps',
    'sign-in-label': 'Sign in',
    'sign-out-label': 'Sign out',
    'close-label': 'Close',
    'account-label': 'Account',
    'manage-account-label': 'Manage account',
    'usage-label': 'Usage',
    'add-credits-label': 'Add credits',
    'open-puter-label': 'Open Puter',
    'feedback-label': 'Send feedback',
};

// Menu links, each opening a page of the Puter GUI in a new tab.
const MENU_LINKS = [
    { className: 'manage-account', label: 'manage-account-label', path: '/dashboard/#account' },
    { className: 'usage', label: 'usage-label', path: '/dashboard/#usage' },
    { className: 'open-puter', label: 'open-puter-label', path: '/' },
];

// Sits under Usage, and shows only for an account with a plan.
const ADD_CREDITS_ITEM = '<button type="button" class="menu-item add-credits" role="menuitem" hidden></button>';

// Gap between a panel and the viewport edge, and between its caret and corners.
const EDGE = 8;
const CARET_INSET = 20;

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
    // Set while signing out from inside the component, whose focus then moves to Sign in.
    #focusSignIn = false;
    // Set while a sign-in popup is open, so another click doesn't open a second one.
    #signingIn = false;
    #onDocumentPointerDown = (event) => {
        if ( ! event.composedPath().includes(this) ) this._closePanels();
    };
    #onViewportChange = () => this._positionOpenPanels();

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
        this._closePanels();
        this._dropApps();
    }

    attributeChangedCallback () {
        if ( this.$('.bar') ) this._applyLabels();
    }

    _applyTheme () {
        super._applyTheme();
        const frame = this.shadowRoot?.querySelector('.apps-body iframe');
        if ( ! frame ) return;
        frame.style.colorScheme = this._colorScheme();
        // A forced theme is part of the app browser's URL, so a new one reloads it.
        if ( frame.src === this._appsUrl() ) return;
        this._dropApps();
        if ( ! this.$('.apps-panel').hidden ) this._mountApps();
    }

    _colorScheme () {
        return this.classList.contains('puter-theme-dark') ? 'dark' : 'light';
    }

    /** The `theme` attribute's scheme, or null when the component follows the OS. */
    _forcedTheme () {
        const theme = this.getAttribute('theme');
        return theme === 'dark' || theme === 'light' ? theme : null;
    }

    _label (name) {
        return this.getAttribute(name) || LABELS[name];
    }

    /** Only a top-level page that signs in on its own; the desktop has its own menu. */
    _active () {
        return globalThis.puter?.env === 'web';
    }

    _appsAllowed () {
        return canFrameGuiEmbed(globalThis.location?.href, globalThis.puter.defaultGUIOrigin);
    }

    /** A temporary account has nothing to sign out of, so it gets Sign in. */
    _signedIn () {
        return Boolean(this.#token) && !this.#user?.is_temp;
    }

    _start () {
        if ( !this.isConnected || this.#unsubscribe || !this._active() ) return;
        this.$('.bar').hidden = false;
        this.#unsubscribe = globalThis.puter.onAuthStateChanged(() => {
            const puter = globalThis.puter;
            if ( puter.authToken === this.#token && puter.APIOrigin === this.#apiOrigin ) return;
            this._closePanels();
            this._dropApps();
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

        // `setAuthToken` announces a token before it starts that token's whoami.
        await null;
        // A tab Puter opened for an app gets its token moments after loading.
        if ( puter.openerLaunch_ ) await puter.openerLaunch_.catch(() => {});
        const token = puter.authToken;
        const user = token ? await Promise.resolve(puter.whoami ?? puter.whoamiCache_).catch(() => null) : null;
        if ( generation !== this.#generation ) return;
        // Answers for a token since replaced; the newer token loads again.
        const current = token === puter.authToken;
        this.#token = puter.authToken;
        this.#apiOrigin = puter.APIOrigin;
        this.#user = current && user && typeof user === 'object' ? user : null;
        this.#ready = true;
        this._renderState();

        // The picture follows, so a slow profile doesn't hold up the account.
        if ( !this.#user || this.#user.is_temp ) return;
        const picture = await puter.auth.getProfilePicture().catch(() => null);
        if ( generation !== this.#generation || token !== puter.authToken || typeof picture !== 'string' ) return;
        this.#picture = picture;
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
            .apps-button[aria-expanded="true"] { background-color: rgba(0, 0, 0, .06); }
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
            .avatar[aria-expanded="true"] { box-shadow: 0 0 0 3px rgba(8, 142, 240, .25); }
            .avatar img,
            .menu-avatar img {
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
            .sign-in:active {
                background-color: #2798eb;
                border-color: #2798eb;
                color: #bedef5;
            }

            /* Panels hang under their button with a caret pointing at it. In
               the top layer where the browser has one, so no host transform,
               overflow or z-index can clip or cover them. */
            .panel {
                position: fixed;
                inset: auto;
                z-index: 2147483000;
                margin: 0;
                padding: 0;
                overflow: visible;
                box-sizing: border-box;
                border: 1px solid #ddd;
                border-radius: 12px;
                background-color: #fff;
                color: #333;
                box-shadow: 0 12px 32px rgba(0, 0, 0, .16), 0 2px 6px rgba(0, 0, 0, .06);
                font-family: ${defaultFontFamily};
                --caret-border: #ddd;
                --caret-fill: #fff;
                animation: panel-in .14s ease-out;
            }
            .panel:focus, .panel:focus-visible { outline: none; }
            .panel::before,
            .panel::after {
                content: '';
                position: absolute;
                top: -8px;
                left: var(--caret-x, calc(100% - ${CARET_INSET}px));
                transform: translateX(-50%);
                border: 8px solid transparent;
                border-top: none;
                border-bottom-color: var(--caret-border);
                pointer-events: none;
            }
            .panel::after {
                top: -7px;
                border-bottom-color: var(--caret-fill);
            }
            @keyframes panel-in {
                from { opacity: 0; transform: translateY(-4px); }
                to { opacity: 1; transform: none; }
            }
            @media (prefers-reduced-motion: reduce) {
                .panel { animation: none; }
            }

            .menu {
                min-width: 220px;
                max-width: min(300px, calc(100vw - ${EDGE * 2}px));
                padding: 4px 0;
                text-align: left;
            }
            .menu-user {
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 8px 14px 10px;
                margin-bottom: 4px;
                border-bottom: 1px solid #eee;
            }
            .menu-avatar {
                position: relative;
                flex: none;
                width: 40px;
                height: 40px;
                overflow: hidden;
                border-radius: 50%;
                background: linear-gradient(#34a5f8, #088ef0);
                color: #fff;
                font-size: 18px;
                font-weight: 600;
                line-height: 40px;
                text-align: center;
            }
            .menu-identity {
                display: flex;
                flex-direction: column;
                min-width: 0;
            }
            .menu-username,
            .menu-email {
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            .menu-username {
                color: #414650;
                font-size: 14px;
                font-weight: 600;
            }
            .menu-email {
                color: #6b7280;
                font-size: 12px;
            }
            .menu-item {
                display: flex;
                align-items: center;
                gap: 4px;
                box-sizing: border-box;
                width: 100%;
                padding: 8px 14px;
                border: none;
                background: none;
                color: #333;
                font-size: 14px;
                line-height: normal;
                text-align: left;
                text-decoration: none;
                cursor: pointer;
            }
            .menu-external {
                flex: none;
                fill: currentColor;
                opacity: .7;
            }
            .menu-separator {
                height: 1px;
                margin: 4px 0;
                background-color: #eee;
            }
            .menu-item:focus-visible {
                outline: none;
                background-color: #f0f0f0;
            }

            .apps-panel {
                width: 400px;
                max-width: calc(100vw - ${EDGE * 2}px);
                height: min(580px, calc(100vh - var(--panel-top, 46px) - 12px));
                height: min(580px, calc(100dvh - var(--panel-top, 46px) - 12px));
                min-height: 240px;
                flex-direction: column;
            }
            .apps-panel:not([hidden]) { display: flex; }
            .apps-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                flex: none;
                gap: 8px;
                padding: 8px 8px 8px 14px;
                border-bottom: 1px solid #eee;
            }
            .apps-title {
                color: #222;
                font-size: 14px;
                font-weight: 600;
            }
            .apps-close {
                display: flex;
                align-items: center;
                justify-content: center;
                width: 28px;
                height: 28px;
                padding: 0;
                border: none;
                border-radius: 7px;
                background: transparent;
                color: #555;
            }
            .apps-body {
                position: relative;
                flex: 1 1 auto;
                min-height: 0;
                overflow: hidden;
                border-radius: 0 0 11px 11px;
            }
            .apps-body iframe {
                display: block;
                width: 100%;
                height: 100%;
                border: 0;
                background: transparent;
            }
            .apps-loading {
                position: absolute;
                inset: 0;
                display: none;
                align-items: center;
                justify-content: center;
                pointer-events: none;
            }
            .apps-body.is-loading .apps-loading { display: flex; }
            .apps-body.is-loading iframe { visibility: hidden; }
            .apps-spinner {
                width: 22px;
                height: 22px;
                box-sizing: border-box;
                border: 2px solid rgba(0, 0, 0, .12);
                border-top-color: #555;
                border-radius: 50%;
                animation: spin .7s linear infinite;
            }
            @keyframes spin { to { transform: rotate(360deg); } }
            @media (prefers-reduced-motion: reduce) {
                .apps-spinner { animation-duration: 1.6s; }
            }
            @media (max-width: 600px) {
                .apps-panel {
                    width: calc(100vw - ${EDGE * 2}px);
                    height: calc(100vh - var(--panel-top, 54px) - ${EDGE}px);
                    height: calc(100dvh - var(--panel-top, 54px) - ${EDGE}px);
                }
                .apps-header { padding: 6px 6px 6px 16px; }
                .apps-title { font-size: 15px; }
                .apps-close { width: 40px; height: 40px; border-radius: 10px; }
            }

            :host(.puter-theme-dark) .apps-button { color: #e6e6e6; }
            :host(.puter-theme-dark) .apps-button[aria-expanded="true"] { background-color: rgba(255, 255, 255, .1); }
            :host(.puter-theme-dark) .panel {
                border-color: #3a3a3a;
                background-color: #2a2a2a;
                color: #e6e6e6;
                box-shadow: 0 12px 32px rgba(0, 0, 0, .45);
                --caret-border: #3a3a3a;
                --caret-fill: #2a2a2a;
            }
            :host(.puter-theme-dark) .menu-user,
            :host(.puter-theme-dark) .apps-header { border-color: #3a3a3a; }
            :host(.puter-theme-dark) .menu-separator { background-color: #3a3a3a; }
            :host(.puter-theme-dark) .menu-email { color: #a0a0a0; }
            :host(.puter-theme-dark) .menu-username,
            :host(.puter-theme-dark) .apps-title,
            :host(.puter-theme-dark) .menu-item { color: #e6e6e6; }
            :host(.puter-theme-dark) .menu-item:focus-visible { background-color: #3a3a3a; color: #fff; }
            :host(.puter-theme-dark) .apps-close { color: #ccc; }
            :host(.puter-theme-dark) .apps-spinner {
                border-color: rgba(255, 255, 255, .15);
                border-top-color: #ccc;
            }

            /* A tap leaves :hover on touch screens, which would shade a closed button. */
            @media (hover: hover) {
                .apps-button:hover { background-color: rgba(0, 0, 0, .06); }
                .avatar:hover { box-shadow: 0 0 0 3px rgba(8, 142, 240, .25); }
                .menu-item:hover { background-color: #f0f0f0; }
                .apps-close:hover { background-color: #f0f0f0; color: #222; }
                :host(.puter-theme-dark) .apps-button:hover { background-color: rgba(255, 255, 255, .1); }
                :host(.puter-theme-dark) .menu-item:hover,
                :host(.puter-theme-dark) .apps-close:hover { background-color: #3a3a3a; color: #fff; }
            }
        `;
    }

    render () {
        return `
            <div class="bar" hidden>
                <button type="button" class="apps-button" part="apps-button" aria-haspopup="dialog" aria-expanded="false" hidden>${APPS_ICON}</button>
                <button type="button" class="sign-in" part="sign-in" hidden></button>
                <button type="button" class="avatar" part="avatar" aria-haspopup="menu" aria-expanded="false" hidden></button>
            </div>
            <div class="panel menu" part="menu" role="menu" tabindex="-1" hidden>
                <div class="menu-user" hidden>
                    <span class="menu-avatar" aria-hidden="true"></span>
                    <span class="menu-identity">
                        <span class="menu-username"></span>
                        <span class="menu-email" hidden></span>
                    </span>
                </div>
                ${MENU_LINKS.map(link => `<a class="menu-item ${link.className}" role="menuitem" target="_blank" rel="noopener"><span class="menu-label"></span>${EXTERNAL_ICON}</a>${link.className === 'usage' ? ADD_CREDITS_ITEM : ''}`).join('')}
                <button type="button" class="menu-item feedback" role="menuitem"></button>
                <div class="menu-separator" role="separator"></div>
                <button type="button" class="menu-item sign-out" role="menuitem"></button>
            </div>
            <div class="panel apps-panel" part="apps-panel" role="dialog" tabindex="-1" hidden>
                <div class="apps-header">
                    <span class="apps-title"></span>
                    <button type="button" class="apps-close">${CLOSE_ICON}</button>
                </div>
                <div class="apps-body">
                    <div class="apps-loading" role="status"><span class="apps-spinner"></span></div>
                </div>
            </div>
        `;
    }

    onReady () {
        if ( typeof HTMLElement !== 'undefined' && 'popover' in HTMLElement.prototype ) {
            for ( const panel of this.$$('.panel') ) panel.setAttribute('popover', 'manual');
        }
        this._applyLabels();
        this.$('.apps-button').addEventListener('click', () => {
            if ( this.$('.apps-panel').hidden ) this._openApps();
            else this._closePanels();
        });
        this.$('.sign-in').addEventListener('click', () => this._signIn());
        this.$('.avatar').addEventListener('click', (event) => {
            // detail is 0 for a click from Enter or Space.
            if ( this.$('.menu').hidden ) this._openMenu({ fromKeyboard: event.detail === 0 });
            else this._closePanels();
        });
        for ( const link of MENU_LINKS ) {
            this.$(`.${link.className}`).addEventListener('click', () => this._closePanels());
        }
        this.$('.add-credits').addEventListener('click', () => this._addCredits());
        this.$('.feedback').addEventListener('click', () => this._sendFeedback());
        this.$('.sign-out').addEventListener('click', () => this._signOut());
        this.$('.apps-close').addEventListener('click', () => this._closePanels({ returnFocus: true }));
        this.shadowRoot.addEventListener('keydown', (event) => {
            const open = this._openPanel();
            if ( ! open ) return;
            if ( event.key === 'Escape' ) {
                event.preventDefault();
                this._closePanels({ returnFocus: true });
            } else if ( event.key === 'Tab' && open.classList.contains('menu') ) {
                // Tab leaves the menu: it closes, and focus moves on from its button.
                this._closePanels({ returnFocus: true });
            } else if ( open.classList.contains('menu') && this._moveMenuFocus(event.key) ) {
                event.preventDefault();
            }
        });
    }

    _applyLabels () {
        const apps = this._label('apps-label');
        const appsButton = this.$('.apps-button');
        appsButton.setAttribute('aria-label', apps);
        appsButton.title = apps;
        this.$('.apps-panel').setAttribute('aria-label', apps);
        this.$('.apps-title').textContent = apps;
        this.$('.apps-loading').setAttribute('aria-label', apps);
        const frame = this.$('.apps-body iframe');
        if ( frame ) frame.title = apps;
        const close = this.$('.apps-close');
        close.setAttribute('aria-label', this._label('close-label'));
        close.title = this._label('close-label');
        this.$('.sign-in').textContent = this._label('sign-in-label');
        this.$('.sign-out').textContent = this._label('sign-out-label');
        this.$('.add-credits').textContent = this._label('add-credits-label');
        this.$('.feedback').textContent = this._label('feedback-label');
        for ( const link of MENU_LINKS ) {
            this.$(`.${link.className} .menu-label`).textContent = this._label(link.label);
        }
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

    /**
     * Add-on credit is sold to accounts with a plan, which whoami reports where there are
     * plans. A seat's plan is its team's, and so is paying for its usage.
     */
    _renderAddCredits () {
        // The SDK reads whoami into a new object when the same token is set again,
        // and an upgrade made on the page marks that one.
        const cached = globalThis.puter.whoami;
        const user = cached?.uuid && cached.uuid === this.#user?.uuid ? cached : this.#user;
        this.$('.add-credits').hidden = !canTopUp(user);
    }

    _renderState () {
        const signedIn = this._signedIn();
        const username = this._username();
        this.$('.apps-button').hidden = !this.#ready || !this._appsAllowed();
        this.$('.sign-in').hidden = !this.#ready || signedIn;

        const avatar = this.$('.avatar');
        avatar.hidden = !this.#ready || !signedIn;
        this._fillAvatar(avatar, username);
        this._renderAvatarLabel();
        this.$('.menu-user').hidden = !username;
        this.$('.menu-username').textContent = username;
        this._fillAvatar(this.$('.menu-avatar'), username);
        const email = typeof this.#user?.email === 'string' ? this.#user.email : '';
        this.$('.menu-email').textContent = email;
        this.$('.menu-email').hidden = !email;
        this._renderAddCredits();
        for ( const link of MENU_LINKS ) {
            this.$(`.${link.className}`).href = new URL(link.path, globalThis.puter.defaultGUIOrigin).href;
        }
        if ( avatar.hidden && !this.$('.menu').hidden ) this._closePanels();
        if ( this.#ready && this.#focusSignIn ) {
            this.#focusSignIn = false;
            if ( ! this.$('.sign-in').hidden ) this.$('.sign-in').focus({ preventScroll: true });
        }
    }

    /** The username's initial, with the profile picture over it once there is one. */
    _fillAvatar (el, username) {
        el.textContent = username ? username[0].toUpperCase() : '?';
        if ( ! this.#picture ) return;
        const img = document.createElement('img');
        img.alt = '';
        // The initial stays underneath for a picture the page's CSP refuses.
        img.addEventListener('error', () => img.remove());
        img.src = this.#picture;
        el.append(img);
    }

    // -- Panels --

    _openPanel () {
        return [...this.$$('.panel')].find(panel => !panel.hidden) ?? null;
    }

    _triggerOf (panel) {
        return this.$(panel.classList.contains('menu') ? '.avatar' : '.apps-button');
    }

    _showPanel (panel) {
        this._closePanels();
        const trigger = this._triggerOf(panel);
        panel.hidden = false;
        if ( typeof panel.showPopover === 'function' && !panel.matches(':popover-open') ) panel.showPopover();
        trigger.setAttribute('aria-expanded', 'true');
        this._positionPanel(panel, trigger);
        document.addEventListener('pointerdown', this.#onDocumentPointerDown, true);
        window.addEventListener('resize', this.#onViewportChange);
        window.addEventListener('scroll', this.#onViewportChange, true);
    }

    _closePanels ({ returnFocus = false } = {}) {
        const open = this._openPanel();
        for ( const panel of this.$$('.panel') ) {
            if ( typeof panel.hidePopover === 'function' && panel.matches(':popover-open') ) panel.hidePopover();
            panel.hidden = true;
            this._triggerOf(panel).setAttribute('aria-expanded', 'false');
        }
        document.removeEventListener('pointerdown', this.#onDocumentPointerDown, true);
        window.removeEventListener('resize', this.#onViewportChange);
        window.removeEventListener('scroll', this.#onViewportChange, true);
        if ( returnFocus && open ) {
            const trigger = this._triggerOf(open);
            if ( ! trigger.hidden ) trigger.focus();
        }
    }

    _positionOpenPanels () {
        const panel = this._openPanel();
        if ( panel ) this._positionPanel(panel, this._triggerOf(panel));
    }

    /** Right-aligns the panel under its trigger, inside the viewport, with the caret at the trigger. */
    _positionPanel (panel, trigger) {
        const rect = trigger.getBoundingClientRect();
        // A trigger the page has hidden or laid out of view leaves nothing to hang from.
        if ( !rect.width && !rect.height ) {
            this._closePanels();
            return;
        }
        const top = Math.round(rect.bottom + 10);
        panel.style.setProperty('--panel-top', `${top}px`);
        panel.style.top = `${top}px`;
        const width = panel.offsetWidth;
        const viewport = document.documentElement.clientWidth || window.innerWidth;
        const left = Math.max(EDGE, Math.min(rect.right + EDGE - width, viewport - EDGE - width));
        panel.style.left = `${Math.round(left)}px`;
        const caret = rect.left + rect.width / 2 - left;
        panel.style.setProperty('--caret-x', `${Math.round(Math.min(width - CARET_INSET, Math.max(CARET_INSET, caret)))}px`);
    }

    /**
     * Opened from the keyboard, focus goes to the first item. Opened with the
     * pointer, it goes to the menu itself, where no item looks focused, so the
     * first ArrowDown lands on the first item.
     */
    _openMenu ({ fromKeyboard = false } = {}) {
        const menu = this.$('.menu');
        // An upgrade made on the page since the account loaded gives it a plan.
        this._renderAddCredits();
        this._showPanel(menu);
        (fromKeyboard ? this.$('.menu-item') : menu).focus({ preventScroll: true });
    }

    /** Moves focus between menu items for an arrow, Home or End key; false for any other key. */
    _moveMenuFocus (key) {
        const items = [...this.$$('.menu .menu-item:not([hidden])')];
        const current = items.indexOf(this.shadowRoot.activeElement);
        const last = items.length - 1;
        const next = {
            ArrowDown: current < 0 || current === last ? 0 : current + 1,
            ArrowUp: current <= 0 ? last : current - 1,
            Home: 0,
            End: last,
        }[key];
        if ( next === undefined ) return false;
        items[next].focus({ preventScroll: true });
        return true;
    }

    _openApps () {
        if ( ! this.#ready ) return;
        if ( ! this.$('.apps-body iframe') ) this._mountApps();
        const panel = this.$('.apps-panel');
        this._showPanel(panel);
        panel.focus({ preventScroll: true });
    }

    /** The app browser for the signed-in user, in the forced theme if any. */
    _appsUrl () {
        const url = new URL('/embed/apps', globalThis.puter.defaultGUIOrigin);
        const hash = new URLSearchParams();
        // The app browser shows the Puter session only to the user named here.
        const uuid = this._signedIn() && this.#token === globalThis.puter.authToken ? this.#user?.uuid : null;
        if ( typeof uuid === 'string' && uuid ) hash.set('user', uuid);
        const theme = this._forcedTheme();
        if ( theme ) hash.set('theme', theme);
        url.hash = hash.toString();
        return url.href;
    }

    _mountApps () {
        const body = this.$('.apps-body');
        const frame = document.createElement('iframe');
        frame.title = this._label('apps-label');
        // The app browser allows a framing page it can name from the referrer.
        frame.setAttribute('referrerpolicy', 'origin');
        frame.style.colorScheme = this._colorScheme();
        body.classList.add('is-loading');
        frame.addEventListener('load', () => body.classList.remove('is-loading'), { once: true });
        frame.src = this._appsUrl();
        body.append(frame);
    }

    /** Discards the app browser, so the next open loads it for whoever is signed in then. */
    _dropApps () {
        this.$('.apps-body iframe')?.remove();
        this.$('.apps-body').classList.remove('is-loading');
    }

    // -- Sign-in --

    _signIn () {
        if ( this.#signingIn ) return;
        const puter = globalThis.puter;
        // A cross-origin isolated page can't see its popup close, so it could never retry.
        this.#signingIn = !globalThis.crossOriginIsolated;
        // Called inside the click, so the sign-in popup isn't blocked.
        puter.auth.signIn().then(
            async () => {
                this.#signingIn = false;
                const user = await Promise.resolve(puter.whoamiCache_).catch(() => null);
                this.emitEvent('signin', { user: user && typeof user === 'object' ? user : null });
            },
            () => {
                // Closed or refused; the button stays for another try.
                this.#signingIn = false;
            },
        );
    }

    _addCredits () {
        // Focus goes back to the account button, where the dialog leaves it when it closes.
        this._closePanels({ returnFocus: true });
        // Called inside the click, so a tab it falls back to isn't blocked.
        void globalThis.puter.ui.showTopUp_();
    }

    _sendFeedback () {
        this._closePanels();
        void globalThis.puter.ui.showFeedbackDialog();
    }

    async _signOut () {
        this.#focusSignIn = Boolean(this.shadowRoot.activeElement);
        this._closePanels();
        try {
            await globalThis.puter.auth.signOut();
        } finally {
            this.#focusSignIn = false;
            // The token goes before the sign-out settles, even when it rejects.
            if ( ! globalThis.puter.authToken ) this.emitEvent('signout');
        }
    }
}

export default PuterUserMenu;
