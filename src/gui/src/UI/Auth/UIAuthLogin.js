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

// The login screen: email or username and password, the identity provider
// buttons, and the ways to the signup and password recovery screens.

import { bindPasswordReveal, formFieldHtml } from '../Dashboard/UIDashboardFormDialog.js';
import openAuthFlow, {
    authHeadHtml,
    joinAuthFlow,
    keepCurrentSession,
    navigateAfterSignIn,
    setAuthStatus,
    setFormBusy,
    submitButtonHtml,
    wireAuthHead,
} from './authFlow.js';
import { renderProviderButtons } from './authProviders.js';
import { pushTwoFactorScreen } from './UIAuth2FA.js';
import { pushRecoverPasswordScreen } from './UIAuthRecoverPassword.js';
import { pushSignupScreen } from './UIAuthSignup.js';

/**
 * @typedef {object} LoginScreenOptions
 * @property {string} [email_or_username] Prefills the first field.
 * @property {string} [authError] Shown when the screen opens.
 * @property {string} [auth_id] Sent with the login when it follows a
 *   `reauth_required` 401, so the backend re-attaches the same identity.
 * @property {string} [reauth_reason]
 */

/**
 * Clears credentials a link may have put in the address bar.
 */
const clearCredentialsFromUrl = () => {
    const search = window.location.search;
    if ( search && (search.includes('password=') || search.includes('username=') || search.includes('email=')) ) {
        history.replaceState({}, document.title, window.location.origin + window.location.pathname);
    }
};

/**
 * What to tell the user about a failed login request.
 *
 * @param {{ status?: number, responseText?: string }} err
 * @returns {{ text?: string, html?: string }}
 */
export const loginErrorMessage = (err) => {
    const response_text = err?.responseText || '';
    try {
        const json = JSON.parse(response_text);
        if ( json?.message ) return { text: String(json.message) };
    } catch {
        // Not JSON.
    }
    if ( err?.status === 404 ) {
        // Not the whole 404 page.
        return { text: `Error 404: "${window.gui_origin}/login" not found` };
    }
    if ( response_text ) return { text: response_text };
    // No answer at all usually means the server couldn't be reached; on a
    // self-hosted instance that's most likely its configuration.
    if ( window.app_domain !== 'puter.com' ) {
        const origin = html_encode(window.gui_origin);
        return {
            html: '<div class="auth-status-help">'
                + `<p>Error reaching "${origin}/login". This is likely to be a configuration issue.</p>`
                + '<p>Make sure of the following:</p>'
                + '<ul>'
                + '<li><code>domain</code> in config.json is set to the domain you\'re using to access puter</li>'
                + '<li>DNS resolves for the domain, and the <code>api.</code> subdomain on that domain</li>'
                + '<li><code>http_port</code> is set to the port Puter is listening on (<code>auto</code> will use <code>4100</code> unless that port is in use)</li>'
                + '<li><code>pub_port</code> is set to the external port (ex: <code>443</code> if you\'re using a reverse proxy that serves over https)</li>'
                + '</ul></div>',
        };
    }
    return { text: `Failed to log in: Error ${err?.status ?? ''}`.trim() };
};

/**
 * Shows the login screen in `flow`.
 *
 * @param {import('./authFlow.js').AuthFlow} flow
 * @param {LoginScreenOptions} [options]
 * @returns {jQuery}
 */
export function pushLoginScreen (flow, options = {}) {
    const id = `auth-login-${window.uuidv4?.() ?? Date.now()}`;

    let h = '<div class="dashboard-dialog-body auth-body">';
    h += authHeadHtml(flow, i18n('log_in', [], false));
    h += '<form class="auth-form login-form" novalidate>';
    h += '<div class="dashboard-form-status" role="status" aria-live="polite"></div>';
    h += formFieldHtml({
        name: 'email_or_username',
        label: i18n('email_or_username'),
        value: options.email_or_username ?? '',
        attrs: { autocomplete: 'username', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' },
    }, id);
    h += formFieldHtml({
        name: 'password',
        type: 'password',
        label: i18n('password'),
        attrs: { autocomplete: 'current-password' },
    }, id);
    h += `<div class="auth-forgot-row"><button type="button" class="auth-link forgot-password-link">${i18n('forgot_pass_c2a')}</button></div>`;
    h += submitButtonHtml(i18n('log_in', [], false), 'login-btn');
    h += '</form>';
    h += '<div class="auth-providers" hidden>';
    h += `<div class="auth-divider"><span>${i18n('or')}</span></div>`;
    h += '<div class="auth-provider-list"></div>';
    h += '</div>';
    h += '</div>';
    if ( flow.options.show_signup_button ) {
        h += '<div class="dashboard-dialog-footer auth-footer">';
        h += `<button type="button" class="auth-link auth-to-signup">${i18n('create_free_account')}</button>`;
        h += '</div>';
    }

    const $screen = flow.push({
        name: 'login',
        html: h,
        autofocus: ! window.disable_login_autofocus,
    });
    const $form = $screen.find('.login-form');
    const $user = $form.find('[name="email_or_username"]');
    const $password = $form.find('[name="password"]');

    wireAuthHead($screen);
    bindPasswordReveal($form);
    if ( options.authError ) setAuthStatus($screen, options.authError);

    $form.on('input', '.dashboard-form-input', function () {
        $(this).removeAttr('aria-invalid');
    });

    renderProviderButtons($screen.find('.auth-provider-list'), {
        kind: 'login',
        referrer: () => flow.options.referrer ?? window.referrerStr ?? window.openerOrigin,
    }).then((offered) => {
        if ( offered ) $screen.find('.auth-providers').prop('hidden', false);
    });

    $screen.find('.forgot-password-link').on('click', () => {
        if ( flow.isBusy() ) return;
        pushRecoverPasswordScreen(flow, { email_or_username: String($user.val() ?? '').trim() });
    });

    $screen.find('.auth-to-signup').on('click', () => {
        if ( flow.isBusy() ) return;
        if ( ! flow.goTo('signup') ) pushSignupScreen(flow);
    });

    // The form first, so the end of busy can hand focus back to a field.
    const unlock = () => {
        setFormBusy($form, false);
        flow.setBusy(false);
    };

    $form.on('submit', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if ( flow.isBusy() ) return;

        const email_username = String($user.val() ?? '').trim();
        const password = String($password.val() ?? '');
        if ( ! email_username ) {
            setAuthStatus($screen, i18n('login_email_username_required', [], false), { field: '[name="email_or_username"]' });
            return;
        }
        if ( ! password ) {
            setAuthStatus($screen, i18n('login_password_required', [], false), { field: '[name="password"]' });
            return;
        }
        setAuthStatus($screen, '');

        // After a `reauth_required` 401, the login re-attaches the same
        // stable identity.
        const reauth = options.auth_id ? { auth_id: options.auth_id, reauth_reason: options.reauth_reason } : {};
        const body = window.is_email(email_username)
            ? { email: email_username, password, ...reauth }
            : { username: email_username, password, ...reauth };

        flow.setBusy(true);
        setFormBusy($form, true);

        let data;
        try {
            data = await new Promise((resolve, reject) => {
                $.ajax({
                    url: `${window.gui_origin}/login`,
                    type: 'POST',
                    async: true,
                    headers: window.custom_headers ?? {},
                    contentType: 'application/json',
                    data: JSON.stringify(body),
                    success: resolve,
                    error: reject,
                });
            });
        } catch ( err ) {
            clearCredentialsFromUrl();
            unlock();
            if ( flow.isClosed() ) return;
            const message = loginErrorMessage(err);
            setAuthStatus($screen, message.text ?? '', { html: message.html });
            // A refused password is typed again; a refused name is fixed there.
            $password.get(0)?.focus({ preventScroll: true });
            $password.get(0)?.select?.();
            return;
        }
        // Dismissed while the request was out: the caller already heard no,
        // so this browser stays signed in as it was.
        if ( flow.isClosed() ) {
            if ( data?.token ) keepCurrentSession();
            return;
        }

        if ( data?.next_step === 'otp' ) {
            // The second factor is a screen of its own; Back returns here.
            flow.setBusy(false);
            const verified = await pushTwoFactorScreen(flow, data.otp_jwt_token);
            if ( ! verified ) {
                setFormBusy($form, false);
                if ( ! flow.isClosed() ) flow.focus();
                return;
            }
            flow.setBusy(true);
            data = verified;
        }

        try {
            await window.update_auth_data(data.token, data.user);
        } catch ( err ) {
            unlock();
            // Back from a verified code, whose screen would otherwise stay up, busy.
            if ( $screen.prop('hidden') ) flow.goTo('login');
            setAuthStatus($screen, err?.message || i18n('something_went_wrong', [], false));
            return;
        }

        if ( flow.options.reload_on_success ) {
            // A clean URL, so no credentials stay in it. The card stays up,
            // busy, while the page goes.
            navigateAfterSignIn(flow.options.redirect_url || window.location.origin + window.location.pathname);
            return;
        }
        flow.finish(true);
    });

    return $screen;
}

/**
 * Asks the user to log in.
 *
 * @param {Partial<import('./authFlow.js').AuthFlowOptions> & LoginScreenOptions & {
 *   page?: boolean, dismissable?: boolean, closeOnBackdrop?: boolean,
 * }} [options] `page`, `dismissable` and `closeOnBackdrop` as in `openAuthFlow`.
 * @returns {Promise<boolean>} True once signed in, unless the page reloads
 *   first; false when the user dismisses it. Joins an auth flow that is
 *   already open instead of opening another.
 */
export default function UIAuthLogin (options = {}) {
    const joined = joinAuthFlow();
    if ( joined ) return joined;
    const flow = openAuthFlow({
        page: options.page,
        dismissable: options.dismissable,
        closeOnBackdrop: options.closeOnBackdrop,
        options,
    });
    pushLoginScreen(flow, options);
    return flow.result;
}
