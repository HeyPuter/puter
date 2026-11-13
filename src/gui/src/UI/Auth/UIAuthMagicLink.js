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

// Email sign-in. An address its provider verifies (Gmail, Outlook) gets that
// provider's button; any other gets a sign-in link by email. The link signs
// in the tab it opens, and when that tab is in this browser this screen signs
// in with it, so a popup can still hand its opener a token.

import { isAttestedOrigin } from '../../helpers/attestedOrigin.js';
import {
    MAGIC_LINK_CHANNEL,
    looksLikeEmail,
    oidcProviderForEmail,
    watchMagicLinkSignIn,
} from '../../helpers/magicLinkSignIn.js';
import { isTouchPrimaryDevice } from '../Dashboard/ContextMenu/ContextMenu.js';
import { formFieldHtml } from '../Dashboard/UIDashboardFormDialog.js';
import { SVG } from '../Dashboard/UIDashboardDialog.js';
import openAuthFlow, {
    authHeadHtml,
    joinAuthFlow,
    navigateAfterSignIn,
    setAuthStatus,
    setFormBusy,
    submitButtonHtml,
    wireAuthHead,
} from './authFlow.js';
import {
    lookUpProviders,
    mayOfferProviders,
    providerButtonHtml,
    providerStartUrl,
    startProviderSignIn,
} from './authProviders.js';
import { pushLoginScreen } from './UIAuthLogin.js';

/** The envelope on the login screen's "Sign in with Email Link" button. */
export const MAGIC_LINK_ICON = SVG('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>');

/**
 * The session the link's tab opened in this browser, if it is `userUuid`'s.
 * The cookie is shared, so this page only needs a GUI token for it.
 *
 * @param {string} userUuid
 * @returns {Promise<{ token: string, user: object } | null>}
 */
const adoptBrowserSession = async (userUuid) => {
    const tokenResp = await fetch(`${window.gui_origin}/get-gui-token`, { credentials: 'include' });
    if ( ! tokenResp.ok ) return null;
    const { token } = await tokenResp.json();
    const whoamiResp = await fetch(`${window.api_origin}/whoami?icon_size=64`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if ( ! whoamiResp.ok ) return null;
    const user = await whoamiResp.json();
    return user?.uuid === userUuid ? { token, user } : null;
};

/**
 * Shows the email sign-in screen in `flow`.
 *
 * With `connect`, the site already signed the user in with `email`, so this
 * reads as connecting that account to Puter rather than signing in again,
 * and the address shows as text the user can change. It takes a sign-in
 * popup whose opener has a name to show; elsewhere it is ignored.
 *
 * @param {import('./authFlow.js').AuthFlow} flow
 * @param {{ email?: string, connect?: boolean }} [opts] `email` prefills the field.
 * @returns {jQuery}
 */
export function pushMagicLinkScreen (flow, { email = '', connect = false } = {}) {
    const id = `auth-magic-link-${window.uuidv4?.() ?? Date.now()}`;
    const opener_origin = window.embedded_in_popup && isAttestedOrigin(window.openerOrigin)
        ? window.openerOrigin
        : '';
    const site = opener_origin ? new URL(opener_origin).hostname : '';
    const connecting = connect && !! site && looksLikeEmail(email);
    let stop_watching = () => {};

    let h = '<div class="dashboard-dialog-body auth-body">';
    h += authHeadHtml(
        flow,
        i18n(connecting ? 'magic_link_connect_title' : 'magic_link_title', [], false),
        { openerNotice: ! connecting },
    );
    h += '<form class="auth-form magic-link-form" novalidate>';
    h += '<div class="dashboard-form-status" role="status" aria-live="polite"></div>';
    if ( connecting ) {
        h += `<p class="magic-link-continue-as">${i18n('magic_link_continue_as', [email.trim()])}</p>`;
    }
    h += `<div class="magic-link-email-field"${connecting ? ' hidden' : ''}>`;
    h += formFieldHtml({
        name: 'email',
        type: 'email',
        label: i18n('email'),
        value: email,
        attrs: { autocomplete: 'email', inputmode: 'email', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' },
    }, id);
    h += '</div>';
    h += submitButtonHtml(i18n(connecting ? 'magic_link_connect_send' : 'magic_link_send', [], false), 'magic-link-send-btn');
    h += '<div class="magic-link-provider" hidden></div>';
    if ( connecting ) {
        h += `<div class="auth-link-row magic-link-change-email"><button type="button" class="auth-link">${i18n('magic_link_use_different_email')}</button></div>`;
    }
    h += `<p class="signup-terms">${i18n(connecting ? 'magic_link_connect_tos_fineprint' : 'magic_link_tos_fineprint', [], false)}</p>`;
    h += '</form>';
    h += '</div>';
    h += '<div class="dashboard-dialog-footer auth-footer">';
    h += `<button type="button" class="auth-link auth-to-login">${i18n('magic_link_password_c2a')}</button>`;
    h += '</div>';

    const $screen = flow.push({
        name: 'magic-link',
        html: h,
        // Connecting has no field showing; the button below takes focus instead.
        autofocus: ! connecting,
        onLeave: () => stop_watching(),
    });
    const $form = $screen.find('.magic-link-form');
    const $email = $form.find('[name="email"]');
    const $send_btn = $form.find('.magic-link-send-btn');
    const $provider = $form.find('.magic-link-provider');
    wireAuthHead($screen);

    const typed_email = () => String($email.val() ?? '').trim();

    // -- Connecting: the site's address, shown as text until the user changes it --
    const showEmailField = () => {
        $form.find('.magic-link-continue-as, .magic-link-change-email').prop('hidden', true);
        $form.find('.magic-link-email-field').prop('hidden', false);
    };
    if ( connecting ) {
        $screen.find('.auth-head').append(`<p class="auth-opener-notice">${i18n('magic_link_connect_message', [site])}</p>`);
        $form.find('.magic-link-change-email .auth-link').on('click', () => {
            if ( flow.isBusy() ) return;
            showEmailField();
            $email.get(0)?.focus({ preventScroll: true });
            $email.get(0)?.select?.();
        });
        // A keyboard popping up on a phone hides half the card; there the user taps.
        if ( ! isTouchPrimaryDevice() ) $send_btn.get(0)?.focus({ preventScroll: true });
    }

    // -- Routing: provider button or sign-in link --
    let providers = [];
    let routed_provider = null;
    const route = () => {
        const next = oidcProviderForEmail(typed_email(), providers);
        if ( next === routed_provider ) return;
        routed_provider = next;
        $provider.html(next ? providerButtonHtml(next, 'login') : '').prop('hidden', ! next);
        $send_btn.prop('hidden', !! next);
    };
    $email.on('input', function () {
        $(this).removeAttr('aria-invalid');
        route();
    });
    if ( mayOfferProviders() ) {
        lookUpProviders(flow).then((data) => {
            providers = Array.isArray(data?.providers) ? data.providers : [];
            if ( ! flow.isClosed() ) route();
        });
    }
    const startRoutedProvider = () => {
        if ( ! routed_provider || flow.isBusy() ) return;
        startProviderSignIn(providerStartUrl(
            routed_provider,
            'login',
            flow.options.referrer ?? window.referrerStr ?? window.openerOrigin,
            typed_email(),
        ));
    };
    $provider.on('click', '.auth-provider-btn', startRoutedProvider);

    $screen.find('.auth-to-login').on('click', () => {
        if ( flow.isBusy() ) return;
        const typed = typed_email();
        if ( ! flow.goTo('login') ) pushLoginScreen(flow, typed ? { email_or_username: typed } : {});
    });

    // -- Sign-in link --
    const onSignedIn = async (user_uuid) => {
        if ( flow.isClosed() ) return;
        flow.setBusy(true);
        let session = null;
        try {
            session = await adoptBrowserSession(user_uuid);
            if ( session ) await window.update_auth_data(session.token, session.user);
        } catch {
            session = null;
        }
        if ( ! session ) {
            flow.setBusy(false);
            return;
        }
        if ( flow.options.reload_on_success ) {
            navigateAfterSignIn(flow.options.redirect_url || window.location.origin + window.location.pathname);
            return;
        }
        flow.finish(true);
    };

    const unlock = () => {
        setFormBusy($form, false);
        flow.setBusy(false);
    };

    $form.on('submit', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if ( flow.isBusy() ) return;
        if ( routed_provider ) {
            startRoutedProvider();
            return;
        }
        const value = typed_email();
        if ( ! looksLikeEmail(value) ) {
            setAuthStatus($screen, i18n('magic_link_invalid_email', [], false), { field: '[name="email"]' });
            return;
        }
        setAuthStatus($screen, '');
        flow.setBusy(true);
        setFormBusy($form, true);

        let resp;
        let body = null;
        try {
            resp = await fetch(`${window.gui_origin}/auth/magic-link/request`, {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: value,
                    ...(opener_origin ? { app_origin: opener_origin } : {}),
                }),
            });
            body = await resp.json();
        } catch {
            // A network failure, or an empty or non-JSON answer: the generic error.
        }
        unlock();
        if ( flow.isClosed() ) return;
        if ( resp?.status === 429 ) {
            setAuthStatus($screen, i18n('magic_link_too_many_requests', [], false));
            return;
        }
        if ( ! resp?.ok || ! body?.request_id ) {
            // A refused address comes back with text saying why, and is
            // changed in the field.
            const refused = resp?.status === 400 && body?.message;
            if ( refused ) showEmailField();
            setAuthStatus($screen, refused
                ? String(body.message)
                : i18n('magic_link_request_failed', [], false), { field: '[name="email"]' });
            return;
        }

        stop_watching();
        stop_watching = watchMagicLinkSignIn({
            requestId: body.request_id,
            openChannel: () => new BroadcastChannel(MAGIC_LINK_CHANNEL),
            onSignedIn,
        });
        // The rest happens from the inbox. The title says so, rather than a
        // second icon under the header; the way back to the login stays below.
        $screen.find('.auth-title').text(i18n('magic_link_sent_title', [], false));
        $form.replaceWith('<div class="dashboard-form-done auth-done magic-link-sent" role="status">'
            + (connecting
                ? `<p>${i18n('magic_link_connect_sent_message', [value])}</p><p>${i18n('magic_link_connect_sent_keep_open', [site])}</p>`
                : `<p>${i18n('magic_link_sent_message', [value])}</p><p>${i18n('magic_link_sent_keep_open')}</p>`)
            + '</div>');
        $screen.find('.auth-to-login').get(0)?.focus({ preventScroll: true });
    });

    return $screen;
}

/**
 * Asks the user to sign in by email, with `email` filled in.
 *
 * @param {Partial<import('./authFlow.js').AuthFlowOptions> & {
 *   email?: string, connect?: boolean, page?: boolean, dismissable?: boolean,
 * }} [options] `connect` as in `pushMagicLinkScreen`; `page` and
 *   `dismissable` as in `openAuthFlow`.
 * @returns {Promise<boolean>} True once signed in, unless the page reloads
 *   first; false when the user dismisses it. Joins an auth flow that is
 *   already open instead of opening another.
 */
export default function UIAuthMagicLink (options = {}) {
    const joined = joinAuthFlow();
    if ( joined ) return joined;
    const flow = openAuthFlow({
        page: options.page,
        dismissable: options.dismissable,
        options,
    });
    pushMagicLinkScreen(flow, { email: options.email, connect: options.connect });
    return flow.result;
}
