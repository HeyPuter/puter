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

// The signup screen: the identity provider buttons, the email form behind
// them, and the account checks (email, phone, card) a new account may have
// to pass once created.

import check_password_strength from '../../helpers/checkPasswordStrength.js';
import { bonusRequirementsKey, checkSignupBonusCode } from '../../helpers/signupBonusCode.js';
import { bindPasswordReveal, formFieldHtml } from '../Dashboard/UIDashboardFormDialog.js';
import UIWindowCardVerificationRequired from '../UIWindowCardVerificationRequired.js';
import UIWindowEmailConfirmationRequired from '../UIWindowEmailConfirmationRequired.js';
import UIWindowPhoneVerificationRequired from '../UIWindowPhoneVerificationRequired.js';
import openAuthFlow, {
    authHeadHtml,
    joinAuthFlow,
    navigateAfterSignIn,
    setAuthStatus,
    setFormBusy,
    submitButtonHtml,
    wireAuthHead,
} from './authFlow.js';
import { mayOfferProviders, renderProviderButtons } from './authProviders.js';
import { pushLoginScreen } from './UIAuthLogin.js';

const SIGNUP_TIMEOUT_MS = 30000;
const TURNSTILE_POLL_MS = 100;
// How long the email form waits for the provider lookup before showing anyway.
const PROVIDERS_WAIT_MS = 1500;

/**
 * @typedef {object} SignupScreenOptions
 * @property {string} [username] Prefills the field.
 * @property {string} [email] Prefills the field.
 * @property {string} [authError] Shown when the screen opens.
 */

/**
 * What a checked bonus code grants, above the form and the provider buttons.
 *
 * @param {jQuery} $screen
 * @param {{ valid: boolean, display?: { title: string, description: string }, requirements?: object } | null} result
 */
const renderBonusNotice = ($screen, result) => {
    const $notice = $screen.find('.signup-bonus-notice');
    if ( ! result ) {
        $notice.prop('hidden', true).empty();
        return;
    }
    if ( ! result.valid ) {
        $notice.addClass('signup-bonus-notice-invalid')
            .html(`<p>${i18n('signup_bonus_code_invalid_retry')}</p>`)
            .prop('hidden', false);
        return;
    }
    const requirements_key = bonusRequirementsKey(result.requirements);
    let h = `<strong>${html_encode(result.display.title)}</strong>`;
    h += `<p>${html_encode(result.display.description)}</p>`;
    if ( requirements_key ) h += `<p class="signup-bonus-requirements">${i18n(requirements_key)}</p>`;
    $notice.removeClass('signup-bonus-notice-invalid').html(h).prop('hidden', false);
};

/**
 * Covers the page with the reason signups are refused here.
 *
 * @param {string} message Plain text.
 */
const showSignupBlocked = (message) => {
    const overlay = document.createElement('div');
    overlay.classList.add('signup-blocked-overlay');
    overlay.innerHTML = `
        <div class="signup-blocked-content">
            <img src="${html_encode(window.icons['logo.svg'] || window.icons['logo-white.svg'] || '')}" style="width:64px;margin-bottom:24px;" alt="" />
            <p>${html_encode(message || 'Signup Not Allowed')}</p>
            <p>If you already have an account, try <a href="/action/login">logging in</a>. Otherwise, contact <a href="mailto:support@puter.com">support@puter.com</a> for assistance.</p>
        </div>
    `;
    document.body.appendChild(overlay);
};

/**
 * Runs the checks a new account has to pass, in the server's order (see
 * assertVerifiedAccount): email → phone (SMS) → card, or card → phone →
 * email when the account clears email last.
 *
 * @param {object} user The new account, as the signup answered.
 * @param {boolean} show_email Ask for the emailed code here.
 * @param {boolean} reload_on_success
 * @param {boolean} page Signup was a page, so the checks cover it too
 *   rather than float over whatever was under it.
 * @returns {Promise<boolean>} Whether the email was confirmed (true when not asked).
 */
const runVerificationGates = async (user, show_email, reload_on_success, page) => {
    const window_options = page ? { cover_page: true, has_head: false } : {};
    let email_verified = true;
    const emailGate = async () => {
        if ( ! show_email ) return;
        // No ✕: the signup card it replaced is already gone, so there's
        // nothing to go back to.
        email_verified = await UIWindowEmailConfirmationRequired({
            show_close_button: false,
            stay_on_top: true,
            has_head: true,
            reload_on_success,
            window_options,
        });
    };
    // A user the SMS path keeps failing may take the card fallback instead;
    // that resolves 'card' and clears the card gate along with the phone
    // gate (see UIWindowPhoneVerificationRequired).
    let card_cleared_by_fallback = false;
    const phoneGate = async () => {
        if ( ! user?.requires_phone_verification ) return;
        let phone_ok = false;
        do {
            phone_ok = await UIWindowPhoneVerificationRequired({
                show_close_button: false,
                stay_on_top: true,
                has_head: true,
                window_options,
            });
        } while ( ! phone_ok );
        card_cleared_by_fallback = phone_ok === 'card';
    };
    const cardGate = async () => {
        if ( ! user?.requires_card_verification || card_cleared_by_fallback ) return;
        let card_ok = false;
        do {
            card_ok = await UIWindowCardVerificationRequired({
                show_close_button: false,
                stay_on_top: true,
                has_head: true,
                window_options,
            });
        } while ( ! card_ok );
    };
    if ( user?.email_gate_last ) {
        await cardGate();
        await phoneGate();
        await emailGate();
    } else {
        await emailGate();
        await phoneGate();
        await cardGate();
    }
    return email_verified;
};

/**
 * Where to go after a signup that reloads. Signup can interrupt a direct app
 * landing (the login cover page's "Sign up", the account picker's "Create
 * Account", the must_login_or_signup fallback); landing on '/' afterwards
 * would drop the app the URL asked for, so app landings are kept and the
 * reloaded boot replays them. The query string is left behind, as login
 * does, so no credentials stay in it.
 *
 * @param {string | undefined} redirect_url
 * @returns {string}
 */
export const signupRedirectUrl = (redirect_url) => {
    if ( redirect_url ) return redirect_url;
    const on_app_landing = /^\/(?:desktop\/)?app\/[^/]+\/?$/.test(window.location.pathname);
    return on_app_landing ? window.location.origin + window.location.pathname : '/';
};

/**
 * Shows the signup screen in `flow`.
 *
 * @param {import('./authFlow.js').AuthFlow} flow
 * @param {SignupScreenOptions} [options]
 * @returns {jQuery}
 */
export function pushSignupScreen (flow, options = {}) {
    const id = `auth-signup-${window.uuidv4?.() ?? Date.now()}`;
    const turnstile_key = window.gui_params?.turnstileSiteKey;
    // The email form stays hidden until the providers are known, so it
    // doesn't show and then fold away behind "Sign up with email".
    let awaiting_providers = mayOfferProviders() && ! options.username && ! options.email;

    let h = '<div class="dashboard-dialog-body auth-body">';
    h += authHeadHtml(flow, i18n('create_free_account', [], false));
    // Above the provider buttons, not in the form: the form hides behind
    // them, and an identity provider's refusal shows here too.
    h += '<div class="dashboard-form-status auth-screen-status" role="status" aria-live="polite"></div>';
    h += '<div class="signup-bonus-notice" hidden></div>';
    h += '<div class="auth-providers oidc-providers-wrapper" hidden>';
    h += '<div class="auth-provider-list"></div>';
    h += '</div>';
    h += '<div class="signup-with-email-wrapper" hidden>';
    h += `<button type="button" class="dashboard-dialog-btn auth-provider-btn signup-with-email-btn">${i18n('sign_up_with_email')}</button>`;
    h += '</div>';
    h += `<form class="auth-form signup-form" novalidate${awaiting_providers ? ' hidden' : ''}>`;
    h += formFieldHtml({
        name: 'username',
        label: i18n('username'),
        value: options.username ?? '',
        attrs: { autocomplete: 'username', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', 'data-gramm_editor': 'false' },
    }, id);
    h += formFieldHtml({
        name: 'email',
        type: 'email',
        label: i18n('email'),
        value: options.email ?? '',
        attrs: { autocomplete: 'email', inputmode: 'email', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', 'data-gramm_editor': 'false' },
    }, id);
    h += formFieldHtml({
        name: 'password',
        type: 'password',
        label: i18n('password'),
        attrs: { autocomplete: 'new-password' },
    }, id);
    h += formFieldHtml({
        name: 'confirm_password',
        type: 'password',
        label: i18n('signup_confirm_password'),
        attrs: { autocomplete: 'new-password' },
    }, id);
    // Bot trap: the server ignores a request that fills it in.
    h += '<input type="text" name="p102xyzname" class="p102xyzname" value="" tabindex="-1" autocomplete="off" aria-hidden="true">';
    if ( turnstile_key ) {
        h += `<div class="auth-turnstile"><div class="cf-turnstile" data-sitekey="${html_encode(turnstile_key)}" data-appearance="interaction-only"></div></div>`;
    }
    h += submitButtonHtml(i18n('create_free_account', [], false), 'signup-btn');
    h += '</form>';
    h += `<p class="signup-terms">${i18n('tos_fineprint', [], false)}</p>`;
    h += '</div>';
    h += '<div class="dashboard-dialog-footer auth-footer">';
    h += `<button type="button" class="auth-link auth-to-login">${i18n('log_in')}</button>`;
    h += '</div>';

    const $screen = flow.push({
        name: 'signup',
        html: h,
        autofocus: ! window.disable_signup_autofocus,
    });
    const $form = $screen.find('.signup-form');
    const field = (name) => $form.find(`[name="${name}"]`);
    const $turnstile = $form.find('.cf-turnstile');
    let turnstile_widget = null;
    let offers_providers = false;

    wireAuthHead($screen);
    bindPasswordReveal($form);
    if ( options.authError ) setAuthStatus($screen, options.authError);

    $form.on('input', '.dashboard-form-input', function () {
        $(this).removeAttr('aria-invalid');
    });

    const showForm = () => {
        $form.prop('hidden', false);
        $screen.find('.signup-with-email-wrapper').prop('hidden', true);
    };

    // Form signups are closed here, so the providers are the only way in.
    const showOidcOnly = () => {
        $form.prop('hidden', true);
        $screen.find('.signup-with-email-wrapper').prop('hidden', true);
        $screen.find('.oidc-providers-wrapper').prop('hidden', false);
    };

    // Turnstile renders into the form once its script has loaded.
    const initTurnstile = () => {
        if ( ! turnstile_key || ! $turnstile.length || flow.isClosed() ) return;
        if ( ! window.turnstile ) {
            setTimeout(initTurnstile, TURNSTILE_POLL_MS);
            return;
        }
        turnstile_widget = window.turnstile.render($turnstile.get(0), {
            sitekey: turnstile_key,
            callback: (token) => {
                $turnstile.attr('data-token', token).addClass('captcha-completed');
            },
            'expired-callback': () => {
                $turnstile.removeAttr('data-token').removeClass('captcha-completed');
            },
        });
    };
    initTurnstile();

    if ( window.signup_bonus_code ) {
        (async () => {
            let fingerprint = null;
            try {
                fingerprint = await window.getDeviceFingerprint?.();
            } catch {
                // The check works without device signals.
            }
            const result = await checkSignupBonusCode(window.signup_bonus_code, {
                origin: window.gui_origin,
                fingerprint,
            });
            // Unknown (null) keeps the code; signup has the final say.
            if ( result && ! result.valid ) window.signup_bonus_code = null;
            renderBonusNotice($screen, result);
        })();
    }

    // With focus on the card itself, nothing on the screen was focusable yet.
    const focusWasParked = () => document.activeElement === flow.$dialog.get(0);
    const stopAwaitingProviders = () => {
        const was_awaiting = awaiting_providers;
        awaiting_providers = false;
        clearTimeout(form_fallback);
        return was_awaiting;
    };
    const revealForm = () => {
        if ( ! stopAwaitingProviders() || flow.isClosed() ) return;
        showForm();
        if ( focusWasParked() ) flow.focus();
    };
    const form_fallback = awaiting_providers ? setTimeout(revealForm, PROVIDERS_WAIT_MS) : undefined;

    renderProviderButtons($screen.find('.auth-provider-list'), {
        kind: 'signup',
        flow,
        referrer: () => flow.options.referrer ?? window.referrerStr,
    }).then((offered) => {
        if ( ! offered ) {
            revealForm();
            return;
        }
        stopAwaitingProviders();
        if ( flow.isClosed() ) return;
        offers_providers = true;
        $screen.find('.oidc-providers-wrapper').prop('hidden', false);
        if ( offered.signupOidcOnly ) {
            showOidcOnly();
            return;
        }
        // The email form waits behind its own button, unless the user has
        // already typed into it.
        const started = $form.find('.dashboard-form-input').filter(function () {
            return !! $(this).val();
        }).length > 0;
        if ( started ) return;
        const had_focus = $form.get(0).contains(document.activeElement);
        $form.prop('hidden', true);
        $screen.find('.signup-with-email-wrapper').prop('hidden', false);
        if ( had_focus || focusWasParked() ) flow.focus();
    });

    $screen.find('.signup-with-email-btn').on('click', () => {
        showForm();
        field('username').get(0)?.focus({ preventScroll: true });
    });

    $screen.find('.auth-to-login').on('click', () => {
        if ( flow.isBusy() ) return;
        if ( ! flow.goTo('login') ) pushLoginScreen(flow);
    });

    const resetTurnstile = () => {
        try {
            if ( window.turnstile && turnstile_widget !== null ) {
                window.turnstile.reset(turnstile_widget);
                $turnstile.removeAttr('data-token').removeClass('captcha-completed');
            }
        } catch ( e ) {
            console.log(e);
        }
    };

    const fail = (text, field_name) => {
        setAuthStatus($screen, text, field_name ? { field: `[name="${field_name}"]` } : {});
    };

    $form.on('submit', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if ( flow.isBusy() ) return;

        const username = String(field('username').val() ?? '').trim();
        const email = String(field('email').val() ?? '').trim();
        const password = String(field('password').val() ?? '');
        const confirm_password = String(field('confirm_password').val() ?? '');

        if ( ! username ) return fail(i18n('username_required', [], false), 'username');
        if ( ! email ) return fail(i18n('email_required', [], false), 'email');
        if ( ! window.is_email(email) ) return fail(i18n('email_invalid', [], false), 'email');
        if ( ! password ) return fail(i18n('password_required', [], false), 'password');
        if ( ! check_password_strength(password).overallPass ) return fail(i18n('password_strength_error', [], false), 'password');
        if ( ! confirm_password ) return fail(i18n('confirm_password_required', [], false), 'confirm_password');
        if ( password !== confirm_password ) return fail(i18n('passwords_do_not_match', [], false), 'confirm_password');

        let turnstile_token = null;
        if ( window.turnstile && turnstile_key ) {
            turnstile_token = $turnstile.attr('data-token');
            if ( ! turnstile_token ) return fail(i18n('captcha_required', [], false));
        }
        setAuthStatus($screen, '');

        flow.setBusy(true);
        setFormBusy($form, true);

        // A device signal for abuse prevention; signup never waits on or
        // fails because of it.
        let fingerprint = null;
        try {
            fingerprint = await window.getDeviceFingerprint?.();
        } catch {
            // Omitted.
        }

        const request = {
            username,
            email,
            password,
            referrer: flow.options.referrer ?? window.referrerStr,
            send_confirmation_code: flow.options.send_confirmation_code,
            p102xyzname: String($form.find('.p102xyzname').val() ?? ''),
            'cf-turnstile-response': turnstile_token,
        };
        if ( fingerprint ) request.fingerprint = fingerprint;
        if ( window.signup_bonus_code ) request.bonusCode = window.signup_bonus_code;

        let data;
        try {
            data = await new Promise((resolve, reject) => {
                $.ajax({
                    url: `${window.gui_origin}/signup`,
                    type: 'POST',
                    async: true,
                    headers: window.custom_headers ?? {},
                    contentType: 'application/json',
                    data: JSON.stringify(request),
                    success: resolve,
                    error: reject,
                    timeout: SIGNUP_TIMEOUT_MS,
                });
            });
        } catch ( err ) {
            setFormBusy($form, false);
            flow.setBusy(false);
            resetTurnstile();
            handleError(err);
            return;
        }

        try {
            await window.update_auth_data(data.token, data.user);
        } catch ( err ) {
            setFormBusy($form, false);
            flow.setBusy(false);
            fail(err?.message || i18n('signup_error', [], false));
            return;
        }

        const reload_on_success = flow.options.reload_on_success;
        const show_email = ! reload_on_success
            && !! (flow.options.send_confirmation_code || data.user?.requires_email_confirmation);
        let email_verified = true;
        if ( data.user?.requires_phone_verification || data.user?.requires_card_verification || show_email ) {
            // The checks are windows of their own; the card makes way for them.
            flow.close();
            email_verified = await runVerificationGates(data.user, show_email, reload_on_success, flow.page);
        }

        if ( reload_on_success ) {
            navigateAfterSignIn(signupRedirectUrl(flow.options.redirect_url));
            return;
        }
        flow.finish(email_verified);
    });

    const handleError = (err) => {
        const error_text = err?.responseText || '';
        let json = null;
        try {
            json = JSON.parse(error_text);
        } catch {
            // Not JSON.
        }

        if ( json?.code === 'signup_blocked' ) {
            showSignupBlocked(json.message);
            return;
        }
        // Form signups closed after this screen loaded. Without provider
        // buttons (some popups), the server's message below says so instead.
        if ( json?.code === 'signup_oidc_only' && offers_providers ) {
            showOidcOnly();
            return;
        }
        if ( json?.code === 'bonus_code_invalid' ) {
            // The next attempt signs up without it; the offer no longer applies.
            window.signup_bonus_code = null;
            renderBonusNotice($screen, null);
            fail(i18n('signup_bonus_code_invalid_retry', [], false));
            return;
        }
        if ( json?.code === 'response_timeout' || err?.statusText === 'timeout' || error_text.includes('timeout') ) {
            fail(i18n('server_timeout', [], false));
            return;
        }
        if ( json?.message ) {
            fail(String(json.message));
            return;
        }
        fail(error_text || i18n('signup_error', [], false));
    };

    return $screen;
}

/**
 * Asks the user to create an account.
 *
 * @param {Partial<import('./authFlow.js').AuthFlowOptions> & SignupScreenOptions & {
 *   page?: boolean, dismissable?: boolean, closeOnBackdrop?: boolean,
 * }} [options] `page`, `dismissable` and `closeOnBackdrop` as in `openAuthFlow`.
 * @returns {Promise<boolean>} True once signed up (or false if a requested
 *   email confirmation wasn't completed), unless the page reloads first;
 *   false when the user dismisses it. Joins an auth flow that is already
 *   open instead of opening another.
 */
export default function UIAuthSignup (options = {}) {
    const joined = joinAuthFlow();
    if ( joined ) return joined;
    const flow = openAuthFlow({
        page: options.page,
        dismissable: options.dismissable,
        closeOnBackdrop: options.closeOnBackdrop,
        options,
    });
    pushSignupScreen(flow, options);
    return flow.result;
}
