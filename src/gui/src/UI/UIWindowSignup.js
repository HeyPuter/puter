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

import check_password_strength from '../helpers/checkPasswordStrength.js';
import UIWindow from './UIWindow.js';
import UIWindowEmailConfirmationRequired from './UIWindowEmailConfirmationRequired.js';
import UIWindowPhoneVerificationRequired from './UIWindowPhoneVerificationRequired.js';
import UIWindowCardVerificationRequired from './UIWindowCardVerificationRequired.js';
import UIWindowLogin from './UIWindowLogin.js';
import { KNOWN_OIDC_PROVIDERS, OIDC_GENERIC_PROVIDER_ICON, OIDC_PROVIDER_ICONS, humanizeOidcProviderId } from '../util/openid.js';
import { offersFederatedSignIn } from '../util/popupAuth.js';
import { get_auth_redirect_url, oidcStartUrl } from '../helpers/authRedirect.js';
import { authLogoHeader, wireAuthLogoHeader } from '../helpers/authLogoHeader.js';
import { isAttestedOrigin } from '../helpers/attestedOrigin.js';
import { bonusRequirementsKey, checkSignupBonusCode } from '../helpers/signupBonusCode.js';

// What a checked bonus code grants, above the form (and the provider buttons).
function renderBonusNotice(el_window, result) {
    const $notice = $(el_window).find('.signup-bonus-notice');
    if (!result) {
        $notice.hide().empty();
        return;
    }
    if (!result.valid) {
        $notice
            .addClass('signup-bonus-notice-invalid')
            .html(`<p>${i18n('signup_bonus_code_invalid_retry')}</p>`)
            .show();
        return;
    }
    const requirementsKey = bonusRequirementsKey(result.requirements);
    let h = `<strong>${html_encode(result.display.title)}</strong>`;
    h += `<p>${html_encode(result.display.description)}</p>`;
    if (requirementsKey) {
        h += `<p class="signup-bonus-requirements">${i18n(requirementsKey)}</p>`;
    }
    $notice.removeClass('signup-bonus-notice-invalid').html(h).show();
}

function UIWindowSignup(options) {
    options = options ?? {};
    options.reload_on_success = options.reload_on_success ?? true;
    options.has_head = options.has_head ?? true;
    options.send_confirmation_code = options.send_confirmation_code ?? false;
    options.show_close_button = options.show_close_button ?? true;
    if (options.redirect_url === undefined) {
        // stay on the page the signup started from (e.g. an /app/<name>
        // landing), with standalone auth pages going to the root dashboard
        options.redirect_url = get_auth_redirect_url();
    }

    return new Promise(async (resolve) => {
        const internal_id = window.uuidv4();

        const logo_clickable =
            !!options.window_options?.cover_page && !window.embedded_in_popup;

        let h = '';
        h +=
            '<div style="margin: 0 auto;">';
        // logo
        h += authLogoHeader({
            logoSrc: window.icons['logo-white.svg'],
            logoClickable: logo_clickable,
            openerOrigin: window.embedded_in_popup && isAttestedOrigin(window.openerOrigin) ? window.openerOrigin : '',
            openerFallbackSrc: window.icons['website.svg'],
        });
        // close button
        if (!options.has_head && options.show_close_button !== false) {
            h += '<div class="generic-close-window-button"> &times; </div>';
        }

        // Form
        h += '<div style="padding: 15px;">';

        // title
        h += `<h1 class="signup-form-title">${i18n('create_free_account')}</h1>`;
        // In a sign-in popup, say which site brought the user here.
        if (window.embedded_in_popup && isAttestedOrigin(window.openerOrigin)) {
            h += `<p class="auth-opener-notice">${i18n('popup_opener_uses_puter', [new URL(window.openerOrigin).hostname])}</p>`;
        }
        h += '<div class="signup-bonus-notice" style="display:none;"></div>';
        // signup form
        h += '<form class="signup-form">';
        // error msg
        h += '<div class="signup-error-msg"></div>';
        // username
        h += '<div style="overflow: hidden;">';
        h += `<label for="username-${internal_id}">${i18n('username')}</label>`;
        h += `<input id="username-${internal_id}" value="${html_encode(options.username ?? '')}" class="username" type="text" autocomplete="username" spellcheck="false" autocorrect="off" autocapitalize="off" data-gramm_editor="false"/>`;
        h += '</div>';
        // email
        h += '<div style="overflow: hidden; margin-top: 10px;">';
        h += `<label for="email-${internal_id}">${i18n('email')}</label>`;
        h += `<input id="email-${internal_id}" value="${html_encode(options.email ?? '')}" class="email" type="email" autocomplete="email" spellcheck="false" autocorrect="off" autocapitalize="off" data-gramm_editor="false"/>`;
        h += '</div>';
        // password
        h +=
            '<div style="overflow: hidden; margin-top: 10px; position: relative;">';
        h += `<label for="password-${internal_id}">${i18n('password')}</label>`;
        h += `<input id="password-${internal_id}" class="password" type="${options.show_password ? 'text' : 'password'}" name="password" autocomplete="new-password" />`;
        // show/hide icon
        h += `<span style="position: absolute; right: 5%; top: 50%; cursor: pointer;" id="toggle-show-password-${internal_id}">
                                    <img class="toggle-show-password-icon" src="${options.show_password ? window.icons['eye-closed.svg'] : window.icons['eye-open.svg']}" width="20" height="20">
                              </span>`;
        h += '</div>';
        // confirm password
        h +=
            '<div style="overflow: hidden; margin-top: 10px; margin-bottom: 10px; position: relative">';
        h += `<label for="confirm-password-${internal_id}">${i18n('signup_confirm_password')}</label>`;
        h += `<input id="confirm-password-${internal_id}" class="confirm-password" type="${options.show_password ? 'text' : 'password'}" name="confirm-password" autocomplete="new-password" />`;
        // show/hide icon
        h += `<span style="position: absolute; right: 5%; top: 50%; cursor: pointer;" id="toggle-show-password-${internal_id}">
                                     <img class="toggle-show-password-icon" src="${options.show_password ? window.icons['eye-closed.svg'] : window.icons['eye-open.svg']}" width="20" height="20">
                              </span>`;
        h += '</div>';
        // bot trap - if this value is submitted server will ignore the request
        h +=
            '<input type="text" name="p102xyzname" class="p102xyzname" value="">';

        // Turnstile widget (only when enabled)
        if (window.gui_params?.turnstileSiteKey) {
            h +=
                '<div style="min-height: 20px; display: flex; justify-content: center;">';
            // appearance: always/execute/interaction-only
            // docs: https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/widget-configurations/?utm_source=chatgpt.com#appearance-modes
            h += `<div class="cf-turnstile" data-sitekey="${window.gui_params.turnstileSiteKey}" data-appearance="interaction-only"></div>`;
            h += '</div>';
        }

        // Create Account
        h += `<button class="signup-btn button button-primary button-block button-normal">${i18n('create_free_account')}</button>`;
        h += '</form>';
        h +=
            '<div class="oidc-providers-wrapper" style="display:none; padding: 10px 0;">';
        h += `<button type="button" class="oidc-google-btn oidc-btn button button-block button-normal" style="display:none; align-items:center; justify-content:center; gap:8px;">${OIDC_PROVIDER_ICONS.google}${i18n('sign_up_with_google')}</button>`;
        h += `<button type="button" class="oidc-microsoft-btn oidc-btn button button-block button-normal" style="display:none; align-items:center; justify-content:center; gap:8px; margin-top:8px;">${OIDC_PROVIDER_ICONS.microsoft}${i18n('sign_up_with_microsoft')}</button>`;
        h += `<button type="button" class="oidc-apple-btn oidc-btn button button-block button-normal" style="display:none; align-items:center; justify-content:center; gap:8px; margin-top:8px;">${OIDC_PROVIDER_ICONS.apple}${i18n('sign_up_with_apple')}</button>`;
        h += '<div class="oidc-custom-providers"></div>';
        h += '</div>';
        // "Sign up with email" button, shown only when OIDC providers are available
        h += `<div class="signup-with-email-wrapper" style="display:none;">`;
        h += `<button class="signup-with-email-btn oidc-btn button button-block button-normal">${i18n('sign_up_with_email')}</button>`;
        h += `</div>`;
        // terms and privacy
        h += `<p class="signup-terms">${i18n('tos_fineprint', [], false)}</p>`;
        h += '</div>';
        // login link
        // create account link
        h += '<div class="c2a-wrapper" style="padding:15px;">';
        h += `<button class="login-c2a-clickable">${i18n('log_in')}</button>`;
        h += '</div>';
        h += '</div>';

        const el_window = await UIWindow({
            title: null,
            app: 'signup',
            single_instance: true,
            icon: null,
            uid: null,
            is_dir: false,
            body_content: h,
            draggable_body: false,
            has_head: true,
            selectable_body: false,
            allow_context_menu: false,
            is_draggable: true,
            is_droppable: false,
            is_resizable: false,
            stay_on_top: false,
            allow_native_ctxmenu: true,
            allow_user_select: true,
            ...options.window_options,
            dominant: true,
            center: true,
            onAppend: function (el_window) {
                if (options.authError) {
                    $(el_window)
                        .find('.signup-error-msg')
                        .html(html_encode(options.authError))
                        .fadeIn();
                }
                if (!window.disable_signup_autofocus) {
                    $(el_window)
                        .find('.username')
                        .get(0)
                        .focus({ preventScroll: true });
                }
                wireAuthLogoHeader(el_window);
                if (logo_clickable) {
                    $(el_window)
                        .find('.auth-logo')
                        .on('click', function () {
                            // keep desktop users on the desktop; everyone else goes to the root dashboard
                            window.location.href =
                                window.location.pathname === '/desktop'
                                    ? '/desktop'
                                    : '/';
                        });
                }

                // Initialize Turnstile widget with callback to capture token
                const initTurnstile = () => {
                    if (
                        window.turnstile &&
                        window.gui_params?.turnstileSiteKey
                    ) {
                        window.turnstile.render('.cf-turnstile', {
                            sitekey: window.gui_params.turnstileSiteKey,
                            callback: function (token) {
                                // Store the token for the signup request
                                $(el_window)
                                    .find('.cf-turnstile')
                                    .attr('data-token', token);
                                // Enable the signup button once CAPTCHA is completed
                                $(el_window)
                                    .find('.signup-btn')
                                    .prop('disabled', false);
                                // Add visual feedback
                                $(el_window)
                                    .find('.cf-turnstile')
                                    .addClass('captcha-completed');
                            },
                            'expired-callback': function () {
                                // Reset when token expires
                                $(el_window)
                                    .find('.cf-turnstile')
                                    .removeAttr('data-token');
                                $(el_window)
                                    .find('.cf-turnstile')
                                    .removeClass('captcha-completed');
                                $(el_window)
                                    .find('.signup-btn')
                                    .prop('disabled', true);
                            },
                        });
                    } else {
                        // If Turnstile isn't loaded yet, wait for it
                        setTimeout(initTurnstile, 100);
                    }
                };

                initTurnstile();

                if (window.signup_bonus_code) {
                    (async () => {
                        let fingerprint = null;
                        try {
                            fingerprint =
                                await window.getDeviceFingerprint?.();
                        } catch (_) {
                            // the check works without device signals
                        }
                        const result = await checkSignupBonusCode(
                            window.signup_bonus_code,
                            { origin: window.gui_origin, fingerprint },
                        );
                        // Unknown (null) keeps the code; signup has the final say.
                        if (result && !result.valid) {
                            window.signup_bonus_code = null;
                        }
                        renderBonusNotice(el_window, result);
                    })();
                }

                (async () => {
                    try {
                        // A federated hop navigates this popup away and the
                        // provider returns it as a plain sign-in popup, losing
                        // whatever the popup was opened to do — and, for a
                        // permission prompt, handing the opener a token instead
                        // of a decision. Don't offer it there. A
                        // cross-origin-isolated opener can only get the token
                        // through the session relay, which the provider's
                        // return doesn't keep.
                        if (
                            !offersFederatedSignIn({
                                embeddedInPopup: !!window.embedded_in_popup,
                                action: window.gui_action,
                                crossOriginIsolated:
                                    window.url_query_params?.get(
                                        'cross_origin_isolated',
                                    ) === 'true',
                            })
                        ) {
                            return;
                        }
                        const res = await fetch(
                            `${window.api_origin}/auth/oidc/providers`,
                        );
                        if (!res.ok) return;
                        const data = await res.json();
                        if (!data.providers) return;

                        const wireOidcBtn = (provider, btnClass) => {
                            $(el_window).find(btnClass).css('display', 'flex');
                            $(el_window)
                                .find(btnClass)
                                .on('click', function () {
                                    window.location.href = oidcStartUrl({
                                        provider,
                                        flow: 'signup',
                                        referrer:
                                            options.referrer ??
                                            window.referrerStr,
                                    });
                                });
                        };

                        let hasProvider = false;
                        if (data.providers.includes('google')) {
                            hasProvider = true;
                            wireOidcBtn('google', '.oidc-google-btn');
                        }
                        if (data.providers.includes('apple')) {
                            hasProvider = true;
                            wireOidcBtn('apple', '.oidc-apple-btn');
                        }
                        if (data.providers.includes('microsoft')) {
                            hasProvider = true;
                            wireOidcBtn('microsoft', '.oidc-microsoft-btn');
                        }

                        // Any other configured provider (e.g. a self-hosted
                        // admin's custom OIDC IdP) gets a generic button.
                        data.providers
                            .filter(
                                provider =>
                                    !KNOWN_OIDC_PROVIDERS.includes(provider),
                            )
                            .forEach((provider, idx) => {
                                hasProvider = true;
                                const btnClass = `oidc-custom-btn-${idx}`;
                                const label =
                                    humanizeOidcProviderId(provider);
                                $(el_window)
                                    .find('.oidc-custom-providers')
                                    .append(
                                        `<button type="button" class="${btnClass} button button-block button-normal" style="display:flex; align-items:center; justify-content:center; gap:8px; margin-top:8px;">${OIDC_GENERIC_PROVIDER_ICON}${i18n('sign_up_with_provider', [label])}</button>`,
                                    );
                                wireOidcBtn(provider, `.${btnClass}`);
                            });

                        if (hasProvider) {
                            $(el_window).find('.oidc-providers-wrapper').show();
                            // Hide the signup form and show the "Sign up with email" button
                            $(el_window).find('.signup-form').hide();
                            $(el_window).find('.signup-form-title').hide();
                            $(el_window)
                                .find('.signup-with-email-wrapper')
                                .show();
                            $(el_window)
                                .find('.signup-with-email-btn')
                                .on('click', function () {
                                    $(el_window).find('.signup-form').show();
                                    $(el_window)
                                        .find('.signup-form-title')
                                        .show();
                                    $(el_window)
                                        .find('.signup-with-email-wrapper')
                                        .hide();
                                    $(el_window)
                                        .find('.username')
                                        .get(0)
                                        ?.focus({ preventScroll: true });
                                });
                        }
                    } catch (_) {}
                })();
            },
            window_class: 'window-signup',
            window_css: {
                height: 'initial',
            },
            body_css: {
                width: 'initial',
                'background-color': 'white',
                'backdrop-filter': 'blur(3px)',
                display: 'flex',
                'flex-direction': 'column',
                'justify-content': 'center',
                'align-items': 'center',
                padding: '20px 10px 10px 10px',
            },
            // Add custom CSS for CAPTCHA states
            custom_css: `
                .cf-turnstile.captcha-completed {
                    border: 2px solid #4CAF50;
                    border-radius: 4px;
                    padding: 2px;
                }
                .signup-btn:disabled {
                    opacity: 0.6;
                    cursor: not-allowed;
                }
            `,
        });

        $(el_window)
            .find('.login-c2a-clickable')
            .on('click', async function (e) {
                $('.login-c2a-clickable').parents('.window').close();
                const login = await UIWindowLogin({
                    referrer: options.referrer,
                    reload_on_success: options.reload_on_success,
                    redirect_url: options.redirect_url,
                    window_options: options.window_options,
                    show_close_button: options.show_close_button,
                    send_confirmation_code: options.send_confirmation_code,
                    show_password: false,
                });
                if (login) {
                    resolve(login);
                }
            });

        $(el_window)
            .find('.signup-btn')
            .on('click', async function (e) {
                // Clear previous error states
                $(el_window).find('.signup-error-msg').hide();

                //Username
                let username = $(el_window).find('.username').val();

                if (!username) {
                    $(el_window)
                        .find('.signup-error-msg')
                        .html(i18n('username_required'));
                    $(el_window).find('.signup-error-msg').fadeIn();
                    return;
                }

                //Email
                let email = $(el_window).find('.email').val();

                // must have an email
                if (!email) {
                    $(el_window)
                        .find('.signup-error-msg')
                        .html(i18n('email_required'));
                    $(el_window).find('.signup-error-msg').fadeIn();
                    return;
                }
                // must be a valid email
                else if (!window.is_email(email)) {
                    $(el_window)
                        .find('.signup-error-msg')
                        .html(i18n('email_invalid'));
                    $(el_window).find('.signup-error-msg').fadeIn();
                    return;
                }

                //Password
                let password = $(el_window).find('.password').val();

                // must have a password
                if (!password) {
                    $(el_window)
                        .find('.signup-error-msg')
                        .html(i18n('password_required'));
                    $(el_window).find('.signup-error-msg').fadeIn();
                    return;
                }
                // check password strength
                const pass_strength = check_password_strength(password);
                if (!pass_strength.overallPass) {
                    $(el_window)
                        .find('.signup-error-msg')
                        .html(i18n('password_strength_error'));
                    $(el_window).find('.signup-error-msg').fadeIn();
                    return;
                }
                // get confirm password value
                const confirmPassword = $(el_window)
                    .find('.confirm-password')
                    .val();
                if (!confirmPassword) {
                    $(el_window)
                        .find('.signup-error-msg')
                        .html(i18n('confirm_password_required'));
                    $(el_window).find('.signup-error-msg').fadeIn();
                    return;
                }
                // check if passwords match
                if (password !== confirmPassword) {
                    $(el_window)
                        .find('.signup-error-msg')
                        .html(i18n('passwords_do_not_match'));
                    $(el_window).find('.signup-error-msg').fadeIn();
                    return;
                }

                // Check if Cloudflare Turnstile CAPTCHA was completed
                let turnstileToken = null;
                if (window.turnstile && window.gui_params?.turnstileSiteKey) {
                    turnstileToken = $(el_window)
                        .find('.cf-turnstile')
                        .attr('data-token');
                    if (!turnstileToken) {
                        $(el_window)
                            .find('.signup-error-msg')
                            .html(
                                i18n('captcha_required') ||
                                    'Please complete the CAPTCHA verification',
                            );
                        $(el_window).find('.signup-error-msg').fadeIn();
                        return;
                    }
                }

                //xyzname
                let p102xyzname = $(el_window).find('.p102xyzname').val();

                // disable 'Create Account' button
                $(el_window).find('.signup-btn').prop('disabled', true);

                let headers = {};
                if (window.custom_headers) {
                    headers = window.custom_headers;
                }

                // Device signal for abuse prevention; omitted when unavailable
                let fingerprint = null;
                try {
                    fingerprint = await window.getDeviceFingerprint?.();
                } catch (_) {
                    // signup must never block or fail because of device signals
                }

                // Include captcha in request only if required
                const requestData = {
                    username: username,
                    email: email,
                    password: password,
                    referrer: options.referrer ?? window.referrerStr,
                    send_confirmation_code: options.send_confirmation_code,
                    p102xyzname: p102xyzname,
                    'cf-turnstile-response': turnstileToken,
                };
                if (fingerprint) {
                    requestData.fingerprint = fingerprint;
                }
                if (window.signup_bonus_code) {
                    requestData.bonusCode = window.signup_bonus_code;
                }

                $.ajax({
                    url: `${window.gui_origin}/signup`,
                    type: 'POST',
                    async: true,
                    headers: headers,
                    contentType: 'application/json',
                    data: JSON.stringify(requestData),
                    success: async function (data) {
                        await window.update_auth_data(data.token, data.user);

                        let email_verified = true;
                        const show_email_dialog =
                            !options.reload_on_success &&
                            (options.send_confirmation_code ||
                                data.user?.requires_email_confirmation);
                        if (
                            data.user?.requires_phone_verification ||
                            data.user?.requires_card_verification ||
                            show_email_dialog
                        ) {
                            $(el_window).close();
                            // Verification gates run in order: email →
                            // phone (SMS) → card, matching the server-side
                            // order in assertVerifiedAccount.
                            if (show_email_dialog) {
                                email_verified =
                                    await UIWindowEmailConfirmationRequired({
                                        stay_on_top: true,
                                        has_head: true,
                                        reload_on_success:
                                            options.reload_on_success,
                                        window_options:
                                            options.window_options ?? {},
                                    });
                            }
                            // A user the SMS path keeps failing may take the
                            // card fallback instead; that resolves 'card' and
                            // clears the card gate along with the phone gate
                            // (see UIWindowPhoneVerificationRequired).
                            let card_gate_cleared_by_fallback = false;
                            if (data.user?.requires_phone_verification) {
                                let phone_ok = false;
                                do {
                                    phone_ok =
                                        await UIWindowPhoneVerificationRequired(
                                            {
                                                show_close_button: false,
                                                stay_on_top: true,
                                                has_head: true,
                                                window_options:
                                                    options.window_options ??
                                                    {},
                                            },
                                        );
                                } while (!phone_ok);
                                card_gate_cleared_by_fallback =
                                    phone_ok === 'card';
                            }
                            // Card verification is the last gate.
                            if (
                                data.user?.requires_card_verification &&
                                !card_gate_cleared_by_fallback
                            ) {
                                let card_ok = false;
                                do {
                                    card_ok =
                                        await UIWindowCardVerificationRequired({
                                            show_close_button: false,
                                            stay_on_top: true,
                                            has_head: true,
                                            window_options:
                                                options.window_options ?? {},
                                        });
                                } while (!card_ok);
                            }
                        }

                        if (options.reload_on_success) {
                            window.onbeforeunload = null;
                            // Signup can interrupt a direct app landing (the
                            // login cover page's "Sign up", the session
                            // picker's "Create Account", the
                            // must_login_or_signup fallback) — landing on '/'
                            // afterwards would silently drop the app the URL
                            // asked for, so app landings are preserved and
                            // the reloaded boot replays them, launch and
                            // dashboard intro included (the query string is
                            // deliberately left behind, mirroring login's
                            // credential-leak hygiene). Every other route
                            // keeps the historical '/' — notably
                            // /action/signup, where coming back to the same
                            // path would just show this window again.
                            const on_app_landing =
                                /^\/(?:desktop\/)?app\/[^/]+\/?$/.test(
                                    window.location.pathname,
                                );
                            const redirectUrl =
                                options.redirect_url ||
                                (on_app_landing
                                    ? window.location.origin +
                                      window.location.pathname
                                    : '/');
                            window.location.replace(redirectUrl);
                        } else {
                            resolve(email_verified);
                        }
                    },
                    error: function (err) {
                        // re-enable 'Create Account' button so user can try again
                        $(el_window)
                            .find('.signup-btn')
                            .prop('disabled', false);

                        // Reset Turnstile widget for retry
                        try {
                            if (window.turnstile) {
                                window.turnstile?.reset('.cf-turnstile');
                                $(el_window)
                                    .find('.cf-turnstile')
                                    .removeAttr('data-token');
                                $(el_window)
                                    .find('.cf-turnstile')
                                    .removeClass('captcha-completed');
                            }
                        } catch (e) {
                            console.log(e);
                        }

                        // Process error response
                        const errorText = err.responseText || '';

                        // Handle JSON error response
                        try {
                            // Try to parse error as JSON
                            const errorJson = JSON.parse(errorText);

                            // Handle signup blocked with full-screen overlay
                            if (errorJson?.code === 'signup_blocked') {
                                const overlay = document.createElement('div');
                                overlay.classList.add('signup-blocked-overlay');
                                const blockedMsg =
                                    errorJson.message || 'Signup Not Allowed';
                                overlay.innerHTML = `
                                <div class="signup-blocked-content">
                                    <img src="${window.icons['logo.svg'] || window.icons['logo-white.svg'] || ''}" style="width:64px;margin-bottom:24px;" />
                                    <p>${html_encode(blockedMsg)}</p>
                                    <p>If you already have an account, try <a href="/action/login">logging in</a>. Otherwise, contact <a href="mailto:support@puter.com">support@puter.com</a> for assistance.</p>
                                </div>
                            `;
                                document.body.appendChild(overlay);
                                return;
                            }

                            // Drop the code so the next attempt signs up without it.
                            if (errorJson?.code === 'bonus_code_invalid') {
                                window.signup_bonus_code = null;
                                // The error below says it; the offer no longer applies.
                                renderBonusNotice(el_window, null);
                                $(el_window)
                                    .find('.signup-error-msg')
                                    .html(i18n('signup_bonus_code_invalid_retry'));
                                $(el_window).find('.signup-error-msg').fadeIn();
                                return;
                            }

                            // Handle timeout specifically
                            if (
                                errorJson?.code === 'response_timeout' ||
                                errorText.includes('timeout')
                            ) {
                                $(el_window)
                                    .find('.signup-error-msg')
                                    .html(
                                        i18n('server_timeout') ||
                                            'The server took too long to respond. Please try again.',
                                    );
                                $(el_window).find('.signup-error-msg').fadeIn();
                                return;
                            }

                            // If it's a message in the JSON, use that
                            if (errorJson.message) {
                                $(el_window)
                                    .find('.signup-error-msg')
                                    .html(errorJson.message);
                                $(el_window).find('.signup-error-msg').fadeIn();
                                return;
                            }
                        } catch (e) {
                            console.log(e);
                            // Not JSON, continue with text analysis
                        }

                        // Default general error handling
                        $(el_window)
                            .find('.signup-error-msg')
                            .html(
                                errorText ||
                                    i18n('signup_error') ||
                                    'An error occurred during signup. Please try again.',
                            );
                        $(el_window).find('.signup-error-msg').fadeIn();
                    },
                    timeout: 30000, // Add a reasonable timeout
                });
            });

        $(el_window)
            .find('.signup-form')
            .on('submit', function (e) {
                e.preventDefault();
                e.stopPropagation();
                return false;
            });

        $(el_window)
            .find(
                `#toggle-show-password-${internal_id}, #toggle-show-password-${internal_id}-confirm`,
            )
            .on('click', function (e) {
                // hide/show password/confirm password and update icon
                let inputField = $(this).siblings('input');
                let isPasswordVisible = inputField.attr('type') === 'text';
                inputField.attr(
                    'type',
                    isPasswordVisible ? 'password' : 'text',
                );
                $(this)
                    .find('.toggle-show-password-icon')
                    .attr(
                        'src',
                        isPasswordVisible
                            ? window.icons['eye-open.svg']
                            : window.icons['eye-closed.svg'],
                    );
            });

        //remove login window
        $('.signup-c2a-clickable').parents('.window').close();
    });
}

export default UIWindowSignup;
