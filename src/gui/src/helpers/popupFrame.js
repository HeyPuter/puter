/*
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * A GUI popup that a first-party page shows in a frame instead of a window,
 * served at `/embed/<action>`. It runs the popup boot unchanged: the framing
 * page stands in for `window.opener`, and closing asks it to remove the frame.
 */

/** Popup actions a first-party page can frame. */
export const FRAMED_POPUP_ACTIONS = new Set([
    'sign-in',
    'show-open-file-picker',
    'show-save-file-picker',
    'show-directory-picker',
    'upgrade',
    'request-email-confirmation',
]);

// Actions a frame shows only for the user the framing page is signed in as.
const HOST_USER_ACTIONS = new Set([
    'show-open-file-picker',
    'show-save-file-picker',
    'show-directory-picker',
    'upgrade',
    'request-email-confirmation',
]);

// Actions framed over the whole page with no box, which their own dialog's
// scrim covers.
const TRANSPARENT_ACTIONS = new Set(['upgrade', 'request-email-confirmation']);

const UPGRADE_REASONS = new Set(['funds', 'subscription', 'storage']);
const UPGRADE_METHOD_MAX = 200;

// Modal UI the upgrade dialog and the GUI's windows show. Once some has shown
// and all of it has been gone this long, the dialog closed without reporting
// it, and the frame mustn't be left covering the page.
const UPGRADE_MODAL_UI = '.window, [aria-modal="true"]';
const UPGRADE_GONE_MS = 500;
// How long a hidden frame waits for the page to show it before opening anyway.
const FRAME_SIZE_TIMEOUT_MS = 1000;
// A focus() the frame ignored is retried this often, this many times.
const FOCUS_RETRY_MS = 50;
const FOCUS_RETRIES = 20;

/** Lifecycle messages to the framing page carry this as `msg`. */
export const POPUP_FRAME_MSG = 'puterPopupFrame';

// The popup's query parameters a framing page may pass, in the fragment.
const FRAGMENT_PARAMS = ['msg_id', 'options', 'request_auth'];

// The account checks a sign-in can show (email, phone, card), and the
// save-account window an email confirmation shows a temporary account first,
// which are windows rather than auth screens.
const ACCOUNT_CHECK_WINDOWS = '.window-confirm-email-using-code, .window-confirm-phone-using-code, .window-card-verification, .window-save-account';

// What a framed popup shows first; until one is on the page the framing page
// keeps the frame hidden behind its loading scrim.
const VISIBLE_UI = '.window, .dashboard-dialog-overlay, .captcha-modal';

/**
 * The action a `/embed/<action>` path frames, or null for any other path.
 *
 * @param {string} pathname
 * @returns {string | null}
 */
export const framedPopupAction = (pathname) => {
    const match = /^\/embed\/([a-z-]+)\/?$/.exec(String(pathname ?? ''));
    return match && FRAMED_POPUP_ACTIONS.has(match[1]) ? match[1] : null;
};

/**
 * Whether a framed `action` serves only the framing page's own user, named in
 * the fragment as `user`.
 *
 * @param {string | null | undefined} action
 * @returns {boolean}
 */
export const framesHostUser = (action) => HOST_USER_ACTIONS.has(action);

/**
 * Whether a framed `action` lets the framing page show through around its
 * dialog.
 *
 * @param {string | null | undefined} action
 * @returns {boolean}
 */
export const isTransparentPopupFrame = (action) => TRANSPARENT_ACTIONS.has(action);

/**
 * The popup parameters the framing page put in the fragment, and no others.
 * The route refuses a query string, so nothing else reaches the boot.
 *
 * @param {string} hash - `location.hash`
 * @returns {URLSearchParams}
 */
export const framedPopupParams = (hash) => {
    const given = new URLSearchParams(String(hash ?? '').replace(/^#/, ''));
    const params = new URLSearchParams();
    for ( const key of FRAGMENT_PARAMS ) {
        if ( given.has(key) ) params.set(key, given.get(key));
    }
    return params;
};

/**
 * Starts a framed popup in `win`: the framing page, at the origin the server
 * pinned with frame-ancestors, becomes `opener`, `close()` asks it to remove
 * the frame, and it hears `ready` once the popup shows something. Returns a
 * function that sends it a lifecycle state, with any fields that go with it,
 * or null when there is no framing page to answer (opened on its own, or
 * framed by a page the server refused).
 *
 * @param {Window} win
 * @param {string | null | undefined} hostOrigin - `gui_params.embed_host_origin`
 * @returns {((state: 'loading' | 'ready' | 'unavailable' | 'closed' | 'provider', fields?: Record<string, unknown>) => void) | null}
 */
export const startPopupFrame = (win, hostOrigin) => {
    if ( ! hostOrigin || win.parent === win ) return null;
    const parent = win.parent;
    if ( isTransparentPopupFrame(framedPopupAction(win.location?.pathname)) ) {
        win.document.documentElement.classList.add('popup-frame-transparent');
    }
    const tell = (state, fields = {}) =>
        parent.postMessage({ ...fields, msg: POPUP_FRAME_MSG, state }, hostOrigin);

    win.opener = parent;
    win.close = () => tell('closed');
    // The popup closes with `window.open('', '_self').close()` as well, which
    // must reach the `close` above rather than navigate the frame.
    const open = win.open.bind(win);
    win.open = (url, target, ...rest) =>
        url === '' && target === '_self' ? win : open(url, target, ...rest);

    const announceReady = () => {
        if ( ! win.document.querySelector(VISIBLE_UI) ) return false;
        tell('ready');
        return true;
    };
    const observer = new win.MutationObserver(() => {
        if ( announceReady() ) observer.disconnect();
    });
    observer.observe(win.document.body, { childList: true, subtree: true });

    tell('loading');
    return tell;
};

/**
 * Gives a framed popup's latest focus() back whenever the frame gains focus
 * with nothing focused, until the user presses a key or the pointer in it. A
 * cross-origin frame can't take focus until the framing page focuses it, which
 * also resets it, so a save picker's file name would start unfocused.
 * Firefox and WebKit also ignore a focus() for a moment after the page shows
 * the frame, without a `focus` event after it, so one that didn't take is
 * retried for a while.
 *
 * @param {Window} win
 */
export const focusOnFrameFocus = (win) => {
    const focus = win.HTMLElement.prototype.focus;
    let latest = null;
    let retryTimer = null;
    let retries = 0;
    // Whether the latest focus() still needs giving back.
    const pending = () => {
        const active = win.document.activeElement;
        return !!latest?.el.isConnected && (!active || active === win.document.body);
    };
    const giveBack = () => {
        if ( pending() ) focus.apply(latest.el, latest.args);
    };
    const retry = () => {
        retryTimer = null;
        giveBack();
        if ( pending() && ++retries < FOCUS_RETRIES ) retryTimer = setTimeout(retry, FOCUS_RETRY_MS);
    };
    win.HTMLElement.prototype.focus = function (...args) {
        latest = { el: this, args };
        const result = focus.apply(this, args);
        clearTimeout(retryTimer);
        retryTimer = null;
        retries = 0;
        if ( pending() ) retryTimer = setTimeout(retry, FOCUS_RETRY_MS);
        return result;
    };
    const forget = () => {
        latest = null;
        clearTimeout(retryTimer);
        retryTimer = null;
        win.HTMLElement.prototype.focus = focus;
    };
    win.addEventListener('pointerdown', forget, { capture: true, once: true });
    win.addEventListener('keydown', forget, { capture: true, once: true });
    win.addEventListener('focus', giveBack);
};

/**
 * Closes a framed sign-in or email confirmation on Escape in one of its
 * account windows, as Escape on the sign-in's auth screens does. Those
 * screens handle Escape themselves; the account windows don't.
 *
 * @param {Window} win
 * @param {(accountWindow: Element) => void} [close] - closes the account window
 *   Escape was pressed in, when its own closing is what answers the frame;
 *   without it the frame closes
 */
export const closeAccountChecksOnEscape = (win, close = () => win.close()) => {
    win.document.addEventListener('keydown', (e) => {
        // Safari sends the Escape that ends an IME conversion as keyCode 229
        // with isComposing false.
        if ( e.key !== 'Escape' || e.defaultPrevented || e.isComposing || e.keyCode === 229 ) return;
        const el = e.target === win.document.body ? win.document.querySelector('.window-active') : e.target;
        const accountWindow = el?.closest?.(ACCOUNT_CHECK_WINDOWS);
        if ( accountWindow ) close(accountWindow);
    });
};

/**
 * Whether a framed upgrade can show for the GUI session `session` (its
 * `/whoami`): the deployment has an upgrade dialog that reports when it
 * closes, and no account check is waiting, which a frame couldn't be closed
 * from.
 *
 * @param {Window} win
 * @param {Record<string, unknown> | null} session
 * @returns {boolean}
 */
export const canShowUpgradeFrame = (win, session) =>
    win.UIUpgradeAccount?.embeddable === true &&
    !!session &&
    !session.requires_email_confirmation &&
    !session.requires_phone_verification &&
    !session.requires_card_verification &&
    !session.requires_password_change;

/**
 * Whether a framed email confirmation can show for the GUI session `session`
 * (its `/whoami`): no check other than the email is waiting, since those show
 * at boot with no way to close the frame.
 *
 * @param {Record<string, unknown> | null} session
 * @returns {boolean}
 */
export const canShowEmailConfirmationFrame = (session) =>
    !!session &&
    !session.requires_phone_verification &&
    !session.requires_card_verification &&
    !session.requires_password_change;

/**
 * Confirms the email of the framed user with `confirm`, which shows the GUI's
 * windows for it. An email already confirmed resolves true without showing
 * anything, so the page never shows the frame.
 *
 * @param {Window} win
 * @param {() => Promise<boolean>} confirm
 * @param {(state: 'ready') => void} tell
 * @returns {Promise<boolean>}
 */
export const confirmEmailInFrame = async (win, confirm, tell) => {
    if ( win.user?.email_confirmed === true ) return true;
    // The windows center themselves when they open.
    await whenFrameSized(win, () => tell('ready'));
    return (await confirm()) === true;
};

/**
 * What prompted a framed upgrade, from its `reason` and `method` fragment
 * parameters, keeping only well-formed values.
 *
 * @param {string} hash - `location.hash`
 * @returns {{ reason?: string, method?: string }}
 */
export const framedUpgradeDetails = (hash) => {
    const given = new URLSearchParams(String(hash ?? '').replace(/^#/, ''));
    const details = {};
    const reason = given.get('reason');
    if ( UPGRADE_REASONS.has(reason) ) details.reason = reason;
    const method = given.get('method');
    if ( method && method.length <= UPGRADE_METHOD_MAX ) details.method = method;
    return details;
};

/**
 * Shows the deployment's upgrade dialog in a framed popup and tells the
 * framing page it's ready once it's open, or before it opens when the page
 * still hides the frame. Resolves whether the user upgraded,
 * once the dialog closes, or false once every dialog and window it showed has
 * gone without it reporting a close.
 *
 * @param {Window} win
 * @param {{ appUid?: string, reason?: string, method?: string }} attribution - what prompted it;
 *   an empty one is passed as null, so the dialog credits the prompt it remembers
 * @param {(state: 'ready') => void} tell
 * @returns {Promise<boolean>}
 */
export const showFramedUpgrade = (win, attribution, tell) => new Promise((resolve, reject) => {
    let settled = false;
    let seen = false;
    let goneTimer = null;
    const settle = (finish) => {
        if ( settled ) return;
        settled = true;
        observer.disconnect();
        clearTimeout(goneTimer);
        finish();
    };
    const shown = () => !!win.document.querySelector(UPGRADE_MODAL_UI);
    const check = () => {
        if ( shown() ) {
            seen = true;
            clearTimeout(goneTimer);
            goneTimer = null;
        } else if ( seen && ! goneTimer ) {
            goneTimer = setTimeout(() => {
                goneTimer = null;
                if ( ! shown() ) settle(() => resolve(false));
            }, UPGRADE_GONE_MS);
        }
    };
    const observer = new win.MutationObserver(check);
    observer.observe(win.document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-modal'] });

    let toldReady = false;
    const ready = () => {
        if ( toldReady || settled ) return;
        toldReady = true;
        tell('ready');
    };
    const open = () => {
        const dialog = new win.UIUpgradeAccount({
            attribution: Object.keys(attribution).length ? attribution : null,
            onClose: (result) => settle(() => resolve(result?.upgraded === true)),
        });
        return dialog.open_as_window();
    };
    whenFrameSized(win, ready)
        .then(open)
        .then(() => {
            check();
            ready();
        }, (e) => settle(() => reject(e)));
});

/**
 * Resolves once the frame has a viewport. The page keeps a loading frame
 * hidden, which Chromium and WebKit lay out at 0x0, and a GUI window opened
 * then (such as an alert) centers itself on that. Without one, `reveal` asks
 * the page to show the frame first.
 *
 * @param {Window} win
 * @param {() => void} reveal
 * @returns {Promise<void>}
 */
const whenFrameSized = (win, reveal) => new Promise((resolve) => {
    const sized = () => win.innerWidth > 0 && win.innerHeight > 0;
    if ( sized() ) {
        resolve();
        return;
    }
    let timer = null;
    const done = () => {
        win.removeEventListener('resize', onResize);
        clearTimeout(timer);
        resolve();
    };
    const onResize = () => {
        if ( sized() ) done();
    };
    win.addEventListener('resize', onResize);
    // Opening on a 0x0 viewport is better than never opening.
    timer = setTimeout(done, FRAME_SIZE_TIMEOUT_MS);
    reveal();
});
