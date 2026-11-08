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
]);

/** Lifecycle messages to the framing page carry this as `msg`. */
export const POPUP_FRAME_MSG = 'puterPopupFrame';

// The popup's query parameters a framing page may pass, in the fragment.
const FRAGMENT_PARAMS = ['msg_id', 'options', 'request_auth'];

// The account checks a sign-in can show (email, phone, card), which are
// windows rather than auth screens.
const ACCOUNT_CHECK_WINDOWS = '.window-confirm-email-using-code, .window-confirm-phone-using-code, .window-card-verification';

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
 * @returns {((state: 'loading' | 'ready' | 'unavailable' | 'closed' | 'provider', fields?: Record<string, string>) => void) | null}
 */
export const startPopupFrame = (win, hostOrigin) => {
    if ( ! hostOrigin || win.parent === win ) return null;
    const parent = win.parent;
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
 *
 * @param {Window} win
 */
export const focusOnFrameFocus = (win) => {
    const focus = win.HTMLElement.prototype.focus;
    let latest = null;
    win.HTMLElement.prototype.focus = function (...args) {
        latest = { el: this, args };
        return focus.apply(this, args);
    };
    const forget = () => {
        latest = null;
        win.HTMLElement.prototype.focus = focus;
    };
    win.addEventListener('pointerdown', forget, { capture: true, once: true });
    win.addEventListener('keydown', forget, { capture: true, once: true });
    win.addEventListener('focus', () => {
        const active = win.document.activeElement;
        if ( ! latest?.el.isConnected || (active && active !== win.document.body) ) return;
        focus.apply(latest.el, latest.args);
    });
};

/**
 * Closes a framed sign-in on Escape in one of its account checks, as Escape
 * on its auth screens does. Those screens handle Escape themselves; the
 * account checks are windows, which don't.
 *
 * @param {Window} win
 */
export const closeAccountChecksOnEscape = (win) => {
    win.document.addEventListener('keydown', (e) => {
        // Safari sends the Escape that ends an IME conversion as keyCode 229
        // with isComposing false.
        if ( e.key !== 'Escape' || e.defaultPrevented || e.isComposing || e.keyCode === 229 ) return;
        const el = e.target === win.document.body ? win.document.querySelector('.window-active') : e.target;
        if ( el?.closest?.(ACCOUNT_CHECK_WINDOWS) ) win.close();
    });
};
