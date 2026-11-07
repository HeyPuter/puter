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

// The card that sign-in, sign-up, the account picker, password recovery and
// the second factor share: a dashboard dialog whose screens replace each
// other in place, with a Back button, instead of opening windows over each
// other. One flow is open at a time.
//
// Two presentations. A dialog dims what is under it, and docks as a bottom
// sheet on phones. A page (a cover page, or any sign-in popup) has nothing
// to go back to: an opaque page under a centered card, and the whole screen
// on phones and in popups.

import { isAttestedOrigin } from '../../helpers/attestedOrigin.js';
import { authLogoHeader, wireAuthLogoHeader } from '../../helpers/authLogoHeader.js';
import { get_auth_redirect_url } from '../../helpers/authRedirect.js';
import { syncSessionCookie } from '../../util/sessionAuth.js';
import { isTouchPrimaryDevice } from '../Dashboard/ContextMenu/ContextMenu.js';
import mountDashboardOverlay from '../Dashboard/dashboardOverlay.js';
import { ICONS, SVG } from '../Dashboard/UIDashboardDialog.js';

const BACK_ICON = SVG('<path d="M15 18l-6-6 6-6"/>');

/** @type {AuthFlow | null} */
let active_flow = null;

/**
 * @typedef {object} AuthScreen
 * @property {string} name Matched by `goTo`.
 * @property {string} html The screen's markup. A `.auth-title` names the
 *   dialog while the screen shows.
 * @property {boolean} [autofocus] Focus the first field on show; default true.
 * @property {() => void} [onBack] Makes Back available on the first screen,
 *   where it runs this instead of returning to an earlier screen.
 * @property {() => void} [onLeave] Runs when the screen is taken off the
 *   stack: by Back, `goTo`, or the flow closing.
 */

/**
 * What every screen of a flow does once the user is signed in. Set from the
 * options of the call that opened the flow; screens it leads to share them.
 *
 * @typedef {object} AuthFlowOptions
 * @property {boolean} reload_on_success Navigate to `redirect_url` on success,
 *   rather than settle the flow with `true`.
 * @property {string} [redirect_url] Defaults to the page the flow started on.
 * @property {string} [referrer] Sent with a signup, for user acquisition.
 * @property {boolean} send_confirmation_code Ask a new account to confirm its
 *   email with a code.
 * @property {boolean} show_signup_button Offer to create an account from
 *   the login screen.
 */

/**
 * @param {Partial<AuthFlowOptions>} [options]
 * @returns {AuthFlowOptions}
 */
export const authFlowOptions = (options = {}) => ({
    reload_on_success: options.reload_on_success ?? true,
    // Stay on the page the flow started from (e.g. an /app/<name> landing);
    // standalone auth pages go to the root dashboard.
    redirect_url: options.redirect_url === undefined ? get_auth_redirect_url() : options.redirect_url,
    referrer: options.referrer,
    send_confirmation_code: options.send_confirmation_code ?? false,
    show_signup_button: options.show_signup_button ?? true,
});

/**
 * Leaves for `url` once signed in. A URL that differs from this page's only
 * in its hash (a dashboard `#tab`) would just scroll, never reload, so the
 * page reloads at it instead.
 *
 * @param {string} url
 */
export const navigateAfterSignIn = (url) => {
    window.onbeforeunload = null;
    const target = new URL(url, window.location.href);
    const here = new URL(window.location.href);
    target.hash = '';
    here.hash = '';
    if ( target.href !== here.href ) {
        window.location.replace(url);
        return;
    }
    history.replaceState(history.state, '', new URL(url, window.location.href).href);
    window.location.reload();
};

/**
 * Hands the session cookie back to the account this page is signed in as.
 * A sign-in the server completes after the user dismissed the card has
 * already moved the cookie to the other account, and the endpoints that
 * read the cookie (password, 2FA) would act on that one.
 */
export const keepCurrentSession = () => {
    void syncSessionCookie({ origin: window.gui_origin || window.location.origin, authToken: window.auth_token });
};

/**
 * @typedef {object} AuthFlow
 * @property {AuthFlowOptions} options
 * @property {jQuery} $overlay
 * @property {jQuery} $dialog
 * @property {boolean} page Whether it shows as a page rather than a dialog.
 * @property {boolean} dismissable
 * @property {Promise<unknown>} result Settles once, with `settle`/`finish`'s
 *   value, or `false` when the user dismisses the flow.
 * @property {(screen: AuthScreen) => jQuery} push Shows a screen over the
 *   current one; returns its element.
 * @property {() => void} back
 * @property {(name: string) => boolean} goTo Returns to an earlier screen by
 *   name, if there is one.
 * @property {(busy: boolean) => void} setBusy While busy, only ✕ dismisses
 *   the flow and Back is disabled. Ending it returns focus to where it was,
 *   once that control is enabled again.
 * @property {() => boolean} isBusy
 * @property {() => void} close Takes the card down without settling.
 * @property {(value: unknown) => void} settle
 * @property {(value: unknown) => void} finish `close`, then `settle`.
 * @property {() => boolean} isClosed
 * @property {() => void} focus Brings focus back to the current screen.
 */

/** The open flow, if any. */
export const activeAuthFlow = () => (active_flow && ! active_flow.isClosed() ? active_flow : null);

/**
 * The first enabled, visible field of a screen.
 *
 * @param {jQuery} $screen
 * @returns {HTMLElement | undefined}
 */
const firstField = ($screen) => $screen
    .find('input:not([type=hidden]):not(.p102xyzname), select, textarea')
    .filter(':visible:not(:disabled):not([readonly])')
    .get(0);

/**
 * @param {object} opts
 * @param {boolean} [opts.page] Show as a page; see the top of this file.
 *   Sign-in popups always are.
 * @param {boolean} [opts.dismissable] Offer ✕ and Escape; defaults to
 *   `!page`.
 * @param {boolean} [opts.closeOnBackdrop] A press on the dimmed area
 *   dismisses it too. Off by default: a stray click must not lose typed
 *   credentials.
 * @param {Partial<AuthFlowOptions>} [opts.options]
 * @returns {AuthFlow}
 */
export default function openAuthFlow ({ page = false, dismissable = ! page, closeOnBackdrop = false, options } = {}) {
    // A newer flow wins; the old one's caller hears it was dismissed.
    activeAuthFlow()?.finish(false);

    const id = `auth-${window.uuidv4?.() ?? Date.now()}`;
    const as_page = !! page || !! window.embedded_in_popup;

    let h = '<div class="dashboard-dialog auth-dialog" role="dialog" aria-modal="true" tabindex="-1">';
    h += '<div class="auth-dialog-bar">';
    h += `<button type="button" class="auth-dialog-back" hidden aria-label="${i18n('back')}" title="${i18n('back')}">${BACK_ICON}</button>`;
    if ( dismissable ) {
        h += `<button type="button" class="dashboard-dialog-close" aria-label="${i18n('close')}" title="${i18n('close')}">${ICONS.close}</button>`;
    }
    h += '</div>';
    h += '</div>';

    let resolve;
    const result = new Promise((r) => {
        resolve = r;
    });
    let busy = false;
    /** @type {HTMLElement | null} */
    let el_busy_return = null;
    let settled = false;
    let torn_down = false;
    /** @type {Array<AuthScreen & { $el: jQuery, el_return?: Element | null }>} */
    const stack = [];

    const teardown = () => {
        if ( torn_down ) return;
        torn_down = true;
        if ( active_flow === flow ) active_flow = null;
        // Screens waiting on the user (the second factor) hear they won't get an answer.
        while ( stack.length ) stack.pop().onLeave?.();
    };

    const { $overlay, $dialog, close: closeOverlay, isClosed } = mountDashboardOverlay({
        html: h,
        // A page already fills the screen. Resizing it under iOS's own pan to
        // the focused field makes the form jump up and down as the keyboard opens.
        fitKeyboard: ! as_page,
        canDismiss: (via) => dismissable
            && (via === 'close' || (! busy && (via !== 'backdrop' || closeOnBackdrop))),
        onDismiss: () => {
            teardown();
            flow.settle(false);
        },
    });
    $overlay.addClass('auth-dialog-overlay');
    if ( as_page ) $overlay.addClass('auth-dialog-page');

    const $back = $dialog.find('.auth-dialog-back');
    const top = () => stack[stack.length - 1];

    const focusScreen = (screen) => {
        if ( ! screen || isClosed() ) return;
        // A keyboard popping up mid-animation on a phone hides half the
        // card; there the user taps the field they want.
        const el_field = screen.autofocus !== false && ! isTouchPrimaryDevice()
            ? firstField(screen.$el) ?? screen.$el.find('.auth-provider-btn').filter(':visible').get(0)
            : undefined;
        (el_field ?? $dialog.get(0))?.focus({ preventScroll: true });
    };

    // Back and ✕ float over the top of the screen. Once it scrolls, the bar
    // under them turns opaque, so what passes beneath neither shows through
    // nor takes their taps.
    const syncScrolled = () => {
        const el_body = top()?.$el.find('.auth-body').get(0);
        $dialog.toggleClass('auth-dialog-scrolled', !! el_body && el_body.scrollTop > 0);
    };
    $dialog.get(0).addEventListener('scroll', syncScrolled, { capture: true, passive: true });

    const refresh = () => {
        const screen = top();
        syncScrolled();
        $back.prop('hidden', ! (stack.length > 1 || screen?.onBack));
        $back.prop('disabled', busy);
        const el_title = screen?.$el.find('.auth-title').get(0);
        $dialog.attr('aria-labelledby', el_title?.id || null);
    };

    /** Takes the top screen off the stack and shows the one under it. */
    const pop = () => {
        const screen = stack.pop();
        screen.$el.remove();
        screen.onLeave?.();
        const under = top();
        under.$el.prop('hidden', false);
        return under;
    };

    /** @type {AuthFlow} */
    const flow = {
        options: authFlowOptions(options),
        $overlay,
        $dialog,
        page: as_page,
        dismissable,
        result,
        push (screen) {
            const under = top();
            if ( under ) {
                under.el_return = $dialog.get(0).contains(document.activeElement) ? document.activeElement : null;
                under.$el.prop('hidden', true);
            }
            const $el = $(`<section class="auth-screen" data-screen="${html_encode(screen.name)}">${screen.html}</section>`);
            $el.find('.auth-title').first().attr('id', `${id}-title-${stack.length}`);
            $dialog.append($el);
            const record = { ...screen, $el };
            stack.push(record);
            refresh();
            focusScreen(record);
            return $el;
        },
        back () {
            if ( busy || isClosed() ) return;
            if ( stack.length > 1 ) {
                const under = pop();
                refresh();
                const el_return = under.el_return;
                if ( el_return && under.$el.get(0).contains(el_return) && ! el_return.disabled ) {
                    el_return.focus({ preventScroll: true });
                } else {
                    focusScreen(under);
                }
                return;
            }
            top()?.onBack?.();
        },
        goTo (name) {
            const index = stack.findIndex((screen) => screen.name === name);
            if ( index === -1 ) return false;
            while ( stack.length > index + 1 ) pop();
            refresh();
            focusScreen(top());
            return true;
        },
        setBusy (value) {
            const was_busy = busy;
            busy = !! value;
            // Busy screens lock their fields, and a disabled field drops focus
            // to the page, where the desktop's shortcuts would take the keys.
            const el_dialog = $dialog.get(0);
            const el_active = document.activeElement;
            if ( busy && ! was_busy ) {
                el_busy_return = el_active !== el_dialog && el_dialog.contains(el_active) ? el_active : null;
            }
            if ( busy && el_dialog.contains(el_active) ) el_dialog.focus({ preventScroll: true });
            $dialog.toggleClass('auth-dialog-busy', busy).attr('aria-busy', busy ? 'true' : null);
            refresh();
            if ( busy || ! was_busy ) return;
            // A failed request hands the keys back to where the user was, so
            // Enter can retry. A screen that already moved focus keeps it.
            const el_return = el_busy_return;
            el_busy_return = null;
            if ( el_return && document.activeElement === el_dialog && el_dialog.contains(el_return)
                && ! el_return.disabled && ! el_return.closest('[hidden]') ) {
                el_return.focus({ preventScroll: true });
            }
        },
        isBusy: () => busy,
        close () {
            if ( isClosed() ) return;
            teardown();
            closeOverlay();
        },
        settle (value) {
            if ( settled ) return;
            settled = true;
            resolve(value);
        },
        finish (value) {
            flow.close();
            flow.settle(value);
        },
        isClosed,
        focus: () => focusScreen(top()),
    };

    $back.on('click', () => flow.back());

    // Keys typed here are the card's. The desktop's shortcuts listen on the
    // document (Enter opens the selected item, Delete trashes it, letters
    // search the desktop), so they must not reach it. Escape is handled here
    // for the same reason.
    $overlay.on('keydown keyup keypress', function (e) {
        e.stopPropagation();
        if ( e.type !== 'keydown' || e.key !== 'Escape' ) return;
        e.preventDefault();
        if ( dismissable && ! busy ) $dialog.find('.dashboard-dialog-close').trigger('click');
    });
    // A press on the backdrop (or a page's background) would move focus to
    // the page, and with it the keys; it stays where it was.
    $overlay.on('mousedown', function (e) {
        if ( e.target === this ) e.preventDefault();
    });

    active_flow = flow;
    return flow;
}

/**
 * Joins the flow that is already open, if any: a second sign-in prompt
 * (an app asking while the user is mid-login) waits on the first rather than
 * stacking another card over it.
 *
 * @returns {Promise<unknown> | null}
 */
export const joinAuthFlow = () => {
    const open = activeAuthFlow();
    if ( ! open ) return null;
    // Bring focus back to the card, without taking it from a field the
    // user is typing in there.
    if ( ! open.$dialog.get(0).contains(document.activeElement) ) open.focus();
    return open.result;
};

/**
 * The top of a screen: the Puter logo (beside the opener's, in a sign-in
 * popup), the screen's title, and, in a popup, which site sent the user.
 *
 * @param {AuthFlow} flow
 * @param {string} title Plain text.
 * @param {{ openerNotice?: boolean }} [opts] `openerNotice: false` leaves out
 *   the line explaining that the site uses Puter, for screens shown to someone
 *   who already has an account here.
 * @returns {string}
 */
export const authHeadHtml = (flow, title, { openerNotice = true } = {}) => {
    const opener = window.embedded_in_popup && isAttestedOrigin(window.openerOrigin) ? window.openerOrigin : '';
    let h = '<div class="auth-head">';
    h += authLogoHeader({
        logoSrc: window.icons['logo-white.svg'],
        logoHref: logoHref(flow),
        openerOrigin: opener,
        openerFallbackSrc: window.icons['website.svg'],
    });
    h += `<h1 class="auth-title">${html_encode(title)}</h1>`;
    if ( opener && openerNotice ) {
        h += `<p class="auth-opener-notice">${i18n('popup_opener_uses_puter', [new URL(opener).hostname])}</p>`;
    }
    h += '</div>';
    return h;
};

/**
 * On a cover page, the logo is a way out: desktop users stay on the desktop,
 * everyone else goes to the root dashboard.
 *
 * @param {AuthFlow} flow
 * @returns {string} Empty where the logo leads nowhere.
 */
const logoHref = (flow) => {
    if ( ! flow.page || window.embedded_in_popup ) return '';
    return window.location.pathname === '/desktop' ? '/desktop' : '/';
};

/**
 * Wires a screen's head once it is on the page.
 *
 * @param {jQuery} $screen
 */
export const wireAuthHead = ($screen) => {
    wireAuthLogoHeader($screen.get(0));
};

/**
 * Sets a screen's status line. Plain text unless `html` is given, which the
 * caller has already encoded.
 *
 * @param {jQuery} $screen
 * @param {string} text Empty clears it.
 * @param {{ kind?: 'error'|'info'|'success', html?: string, field?: string }} [opts]
 *   `field` is a selector for the control to mark invalid and focus.
 */
export const setAuthStatus = ($screen, text, { kind = 'error', html, field } = {}) => {
    const $status = $screen.find('.dashboard-form-status').first();
    if ( html !== undefined ) $status.html(html);
    else $status.text(text ?? '');
    const shown = !! (text || html);
    $status
        .toggleClass('dashboard-form-status-error', shown && kind === 'error')
        .toggleClass('dashboard-form-status-info', shown && kind === 'info')
        .toggleClass('auth-status-success', shown && kind === 'success');
    $screen.find('[aria-invalid]').removeAttr('aria-invalid');
    if ( ! shown ) return;
    const el_status = $status.get(0);
    el_status?.scrollIntoView?.({ block: 'nearest' });
    if ( field ) {
        const el_field = $screen.find(field).attr('aria-invalid', 'true').get(0);
        if ( el_field && ! el_field.disabled ) el_field.focus({ preventScroll: true });
    }
};

/**
 * Shows a form's submit button as working, and locks the form's fields,
 * while `busy`.
 *
 * @param {jQuery} $form
 * @param {boolean} busy
 */
export const setFormBusy = ($form, busy) => {
    $form.find('input, select, textarea, button').prop('disabled', busy);
    $form.find('.auth-submit')
        .toggleClass('dashboard-form-busy', busy)
        .attr('aria-busy', busy ? 'true' : null);
};

/**
 * The submit button of an auth form: full width, with a spinner while busy.
 *
 * @param {string} label Plain text.
 * @param {string} [extraClass]
 * @returns {string}
 */
export const submitButtonHtml = (label, extraClass = '') =>
    `<button type="submit" class="dashboard-dialog-btn dashboard-dialog-btn-primary auth-submit ${extraClass}">`
    + '<span class="dashboard-form-spinner" aria-hidden="true"></span>'
    + `<span class="dashboard-form-submit-label">${html_encode(label)}</span>`
    + '</button>';
