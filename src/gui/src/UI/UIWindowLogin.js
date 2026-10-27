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

import UIWindowLogin2FA from './UIWindowLogin2FA.js';
import UIWindow from './UIWindow.js';
import UIWindowRecoverPassword from './UIWindowRecoverPassword.js';
import UIWindowSignup from './UIWindowSignup.js';
import { KNOWN_OIDC_PROVIDERS, OIDC_GENERIC_PROVIDER_ICON, humanizeOidcProviderId } from '../util/openid.js';
import { offersFederatedSignInInPopup } from '../util/popupAuth.js';
import { get_auth_redirect_url, get_oidc_return_to } from '../helpers/authRedirect.js';
import { authLogoHeader, wireAuthLogoHeader } from '../helpers/authLogoHeader.js';
import { isAttestedOrigin } from '../helpers/attestedOrigin.js';

async function UIWindowLogin (options) {
    options = options ?? {};

    if ( options.reload_on_success === undefined )
    {
        options.reload_on_success = true;
    }

    if ( options.redirect_url === undefined )
    {
        // stay on the page the login started from (e.g. an /app/<name>
        // landing), with standalone auth pages going to the root dashboard
        options.redirect_url = get_auth_redirect_url();
    }

    return new Promise(async (resolve) => {
        const internal_id = window.uuidv4();

        let h = '';
        h += '<div style="max-width:100%; width:100%; height:100%; min-height:0; box-sizing:border-box; display:flex; flex-direction:column; justify-content:center; align-items:stretch; padding:0; overflow:auto; color:var(--color-text);">';
        // logo
        const logo_clickable = !!options.window_options?.cover_page && !window.embedded_in_popup;
        h += '<div class="logo-wrapper" style="display:flex; justify-content:center; padding:20px 20px 0 20px; margin-bottom: 0;">';
        h += authLogoHeader({
            logoSrc: window.icons['logo-white.svg'],
            logoClickable: logo_clickable,
            openerOrigin: window.embedded_in_popup && isAttestedOrigin(window.openerOrigin) ? window.openerOrigin : '',
            openerFallbackSrc: window.icons['website.svg'],
        });
        h += '</div>';
        // title
        h += '<div style="padding:10px 20px; text-align:center; margin-bottom:0;">';
        h += `<h1 class="login-form-title">${i18n('log_in')}</h1>`;
        // In a sign-in popup, say which site brought the user here.
        if (window.embedded_in_popup && isAttestedOrigin(window.openerOrigin)) {
            h += `<p class="auth-opener-notice">${i18n('popup_opener_uses_puter', [new URL(window.openerOrigin).hostname])}</p>`;
        }
        h += '</div>';
        // form
        h += '<div style="padding:20px; overflow-y:auto; overflow-x:hidden;">';
        h += '<form class="login-form" style="width:100%; width: 100%; max-width: 400px; margin: 0 auto;">';
        // server messages
        h += '<div class="login-error-msg" style="color:#e74c3c; display:none; margin-bottom:10px; line-height:15px; font-size:13px;"></div>';
        // email or username
        h += '<div style="position: relative; margin-bottom: 20px;">';
        h += `<label style="display:block; margin-bottom:5px;">${i18n('email_or_username')}</label>`;
        if ( options.email_or_username ) {
            h += `<input type="text" class="email_or_username" value="${options.email_or_username}" autocomplete="username"/>`;
        } else {
            h += '<input type="text" class="email_or_username" autocomplete="username"/>';
        }
        h += '</div>';
        // password
        h += '<div style="position: relative; margin-bottom: 20px;">';
        h += '<div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:5px;">';
        h += `<label style="margin-bottom:0;">${i18n('password')}</label>`;
        h += `<span class="forgot-password-link" style="font-size:13px;">${i18n('forgot_pass_c2a')}</span>`;
        h += '</div>';
        h += `<input id="password-${internal_id}" class="password" type="${options.show_password ? 'text' : 'password'}" name="password" autocomplete="current-password"/>`;
        // show/hide icon
        h += `<span style="position: absolute; right: 5%; top: 50%; cursor: pointer;" id="toggle-show-password-${internal_id}">
                                <img class="toggle-show-password-icon" src="${options.show_password ? window.icons['eye-closed.svg'] : window.icons['eye-open.svg']}" width="20" height="20">
                            </span>`;
        h += '</div>';
        // login
        h += `<button type="submit" class="login-btn button button-primary button-block button-normal">${i18n('log_in')}</button>`;
        // OIDC
        h += '<div class="oidc-providers-wrapper" style="display:none; padding: 0 0 10px 0;">';
        h += `<div style="display:flex; align-items:center; gap:10px; margin: 10px 0; font-size:13px; color:#888;"><div style="flex:1; height:1px; background-color:#d0d0d0;"></div><span>${ i18n('or') }</span><div style="flex:1; height:1px; background-color:#d0d0d0;"></div></div>`;
        h += `<button type="button" class="oidc-google-btn oidc-btn button button-block button-normal" style="display:none; align-items:center; justify-content:center; gap:8px;"><img style="width: 20px; height: 20px;" src="data:image/webp;base64,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" />${i18n('sign_in_with_google')}</button>`;
        h += `<button type="button" class="oidc-microsoft-btn oidc-btn button button-block button-normal" style="display:none; align-items:center; justify-content:center; gap:8px; margin-top:8px;"><svg style="width:20px; height:20px;" viewBox="0 0 23 23" fill="none"><rect x="1" y="1" width="10" height="10" fill="#f25022"/><rect x="12" y="1" width="10" height="10" fill="#7fba00"/><rect x="1" y="12" width="10" height="10" fill="#00a4ef"/><rect x="12" y="12" width="10" height="10" fill="#ffb900"/></svg>${i18n('sign_in_with_microsoft')}</button>`;
        h += `<button type="button" class="oidc-apple-btn oidc-btn button button-block button-normal" style="display:none; align-items:center; justify-content:center; gap:8px; margin-top:8px;"><svg style="width:20px; height:20px;" viewBox="0 0 384 512" fill="currentColor"><path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z"/></svg>${i18n('sign_in_with_apple')}</button>`;
        h += '<div class="oidc-custom-providers"></div>';
        h += '</div>';
        h += '</form>';
        h += '</div>';
        // create account link

        // If show_signup_button is undefined, the default behavior is to show it.
        // If show_signup_button is set to false, the button will not be shown.
        if ( options.show_signup_button === undefined || options.show_signup_button ) {
            h += '<div class="c2a-wrapper" style="padding:20px;">';
            h += `<button class="signup-c2a-clickable">${i18n('create_free_account')}</button>`;
            h += '</div>';
        }
        h += '</div>';

        const el_window = await UIWindow({
            title: null,
            app: 'login',
            single_instance: true,
            icon: null,
            uid: null,
            is_dir: false,
            body_content: h,
            has_head: true,
            selectable_body: false,
            draggable_body: false,
            allow_context_menu: false,
            is_draggable: options.is_draggable ?? true,
            is_droppable: false,
            is_resizable: false,
            stay_on_top: false,
            allow_native_ctxmenu: true,
            allow_user_select: true,
            ...options.window_options,
            width: 350,
            dominant: true,
            on_close: () => {
                resolve(false);
            },
            onAppend: function (this_window) {
                if ( options.authError ) {
                    $(this_window).find('.login-error-msg').html(html_encode(options.authError)).fadeIn();
                }
                if ( ! window.disable_login_autofocus )
                {
                    $(this_window).find('.email_or_username').get(0).focus({ preventScroll: true });
                }
            },
            window_class: 'window-login',
            window_css: {
                height: 'initial',
            },
            body_css: {
                width: 'initial',
                padding: '0',
                'background-color': 'rgb(255 255 255)',
                'backdrop-filter': 'blur(3px)',
                'display': 'flex',
                'flex-direction': 'column',
                'justify-content': 'center',
                'align-items': 'center',
            },
        });

        wireAuthLogoHeader(el_window);

        if ( logo_clickable ) {
            $(el_window).find('.auth-logo').on('click', function () {
                // keep desktop users on the desktop; everyone else goes to the root dashboard
                window.location.href = window.location.pathname === '/desktop' ? '/desktop' : '/';
            });
        }

        $(el_window).find('.forgot-password-link').on('click', function (e) {
            UIWindowRecoverPassword({
                window_options: {
                    backdrop: true,
                    // A stay-on-top login window (dashboard mode) sits in the
                    // 99999999+ band; this dialog must join it there or it
                    // opens buried under the login window's backdrop.
                    stay_on_top: isMobile.phone || !!options.window_options?.stay_on_top,
                    close_on_backdrop_click: false,
                },
            });
        });

        (async () => {
            try {
                // A federated hop navigates this popup away and the provider
                // returns it as a plain sign-in popup, losing whatever the popup
                // was opened to do — and, for a permission prompt, handing the
                // opener a token instead of a decision. Don't offer it there.
                // A cross-origin-isolated opener can only get the token through
                // the session relay, which the provider's return doesn't keep.
                if ( window.embedded_in_popup
                    && ( ! offersFederatedSignInInPopup(window.gui_action)
                        || window.url_query_params?.get('cross_origin_isolated') === 'true' ) ) {
                    return;
                }
                const res = await fetch(`${window.api_origin}/auth/oidc/providers`);
                if ( ! res.ok ) return;
                const data = await res.json();
                if ( ! data.providers ) return;

                const wireOidcBtn = (provider, btnClass) => {
                    $(el_window).find(btnClass).css('display', 'flex');
                    $(el_window).find(btnClass).on('click', function () {
                        let url = `${window.gui_origin}/auth/oidc/${provider}/start?flow=login`;

                        // return to the interface the login started from (backend whitelists the path)
                        const return_to = get_oidc_return_to();
                        if ( return_to ) {
                            url += `&return_to=${encodeURIComponent(return_to)}`;
                        }

                        const referrer = options.referrer ?? window.referrerStr ?? window.openerOrigin;
                        if ( referrer ) {
                            url += `&referrer=${encodeURIComponent(referrer)}`;
                        }
                        // A provider login can create the account, so a signup link's code rides along.
                        if ( window.signup_bonus_code ) {
                            url += `&bonusCode=${encodeURIComponent(window.signup_bonus_code)}`;
                        }
                        if ( window.embedded_in_popup && window.url_query_params?.get('msg_id') ) {
                            url += `&embedded_in_popup=true&msg_id=${encodeURIComponent(window.url_query_params.get('msg_id'))}`;
                            if ( window.openerOrigin ) {
                                url += `&opener_origin=${encodeURIComponent(window.openerOrigin)}`;
                            }
                        }
                        window.location.href = url;
                    });
                };

                let hasProvider = false;
                if ( data.providers.includes('google') ) { hasProvider = true; wireOidcBtn('google', '.oidc-google-btn'); }
                if ( data.providers.includes('apple') ) { hasProvider = true; wireOidcBtn('apple', '.oidc-apple-btn'); }
                if ( data.providers.includes('microsoft') ) { hasProvider = true; wireOidcBtn('microsoft', '.oidc-microsoft-btn'); }

                // Any other configured provider (e.g. a self-hosted admin's
                // custom OIDC IdP) gets a generic button.
                data.providers
                    .filter(provider => !KNOWN_OIDC_PROVIDERS.includes(provider))
                    .forEach((provider, idx) => {
                        hasProvider = true;
                        const btnClass = `oidc-custom-btn-${idx}`;
                        const label = humanizeOidcProviderId(provider);
                        $(el_window).find('.oidc-custom-providers').append(
                            `<button type="button" class="${btnClass} button button-block button-normal" style="display:flex; align-items:center; justify-content:center; gap:8px; margin-top:8px;">${OIDC_GENERIC_PROVIDER_ICON}${i18n('sign_in_with_provider', [label])}</button>`,
                        );
                        wireOidcBtn(provider, `.${btnClass}`);
                    });

                if ( hasProvider ) $(el_window).find('.oidc-providers-wrapper').show();
            } catch (_) {
            }
        })();

        $(el_window).find('.login-btn').on('click', function (e) {
            // Prevent default button behavior (important for async requests)
            e.preventDefault();

            // Clear previous error states
            $(el_window).find('.login-error-msg').hide();

            const email_username = $(el_window).find('.email_or_username').val();
            const password = $(el_window).find('.password').val();

            // Basic validation for email/username and password
            if ( ! email_username ) {
                $(el_window).find('.login-error-msg').html(i18n('login_email_username_required'));
                $(el_window).find('.login-error-msg').fadeIn();
                return;
            }

            if ( ! password ) {
                $(el_window).find('.login-error-msg').html(i18n('login_password_required'));
                $(el_window).find('.login-error-msg').fadeIn();
                return;
            }

            // Prepare data for the request
            // When this login was triggered by a 401 reauth_required,
            // forward `auth_id` (and the originating reason) so the
            // backend can re-attach the user/session to the same
            // stable identity.
            const reauth_payload = options.auth_id
                ? { auth_id: options.auth_id, reauth_reason: options.reauth_reason }
                : {};
            let data;
            if ( window.is_email(email_username) ) {
                data = JSON.stringify({
                    email: email_username,
                    password: password,
                    ...reauth_payload,
                });
            } else {
                data = JSON.stringify({
                    username: email_username,
                    password: password,
                    ...reauth_payload,
                });
            }

            let headers = {};
            if ( window.custom_headers )
            {
                headers = window.custom_headers;
            }

            // Disable the login button to prevent multiple submissions
            $(el_window).find('.login-btn').prop('disabled', true);

            $.ajax({
                url: `${window.gui_origin }/login`,
                type: 'POST',
                async: true,
                headers: headers,
                contentType: 'application/json',
                data: data,
                success: async function (data) {
                    // Keep the button disabled on success since we're redirecting or closing
                    if ( data.next_step === 'otp' ) {
                        const verified = await UIWindowLogin2FA(data.otp_jwt_token);
                        if ( ! verified ) {
                            $(el_window).find('.login-btn').prop('disabled', false);
                            return;
                        }
                        data = verified;
                    }

                    await window.update_auth_data(data.token, data.user);

                    if ( options.reload_on_success ) {
                        window.onbeforeunload = null;
                        // Replace with a clean URL to prevent password leakage
                        const cleanUrl = options.redirect_url || window.location.origin + window.location.pathname;
                        window.location.replace(cleanUrl);
                    } else
                    {
                        resolve(true);
                    }
                    $(el_window).close();
                },
                error: function (err) {
                    // First, ensure URL is clean in case of error (prevent password leakage)
                    if ( window.location.search && (
                        window.location.search.includes('password=') ||
                        window.location.search.includes('username=') ||
                        window.location.search.includes('email=')
                    ) ) {
                        const cleanUrl = window.location.origin + window.location.pathname;
                        history.replaceState({}, document.title, cleanUrl);
                    }

                    // Enable 'Log In' button
                    $(el_window).find('.login-btn').prop('disabled', false);

                    // Handle captcha-specific errors
                    const errorText = err.responseText || '';

                    // Try to parse error as JSON
                    try {
                        const errorJson = JSON.parse(errorText);

                        // If it's a message in the JSON, use that
                        if ( errorJson.message ) {
                            $(el_window).find('.login-error-msg').html(errorJson.message);
                            $(el_window).find('.login-error-msg').fadeIn();
                            return;
                        }
                    } catch (e) {
                        // Not JSON, continue with text analysis
                    }

                    // Fall back to original error handling
                    const $errorMessage = $(el_window).find('.login-error-msg');
                    if ( err.status === 404 ) {
                        // Don't include the whole 404 page
                        $errorMessage.html(`Error 404: "${window.gui_origin}/login" not found`);
                    } else if ( err.responseText ) {
                        $errorMessage.html(html_encode(err.responseText));
                    } else {
                        // No message was returned. *Probably* this means we couldn't reach the server.
                        // If this is a self-hosted instance, it's probably a configuration issue.
                        if ( window.app_domain !== 'puter.com' ) {
                            $errorMessage.html(`<div style="text-align: left;">
                                <p>Error reaching "${window.gui_origin}/login". This is likely to be a configuration issue.</p>
                                <p>Make sure of the following:</p>
                                <ul style="padding-left: 2em;">
                                    <li><code>domain</code> in config.json is set to the domain you're using to access puter</li>
                                    <li>DNS resolves for the domain, and the <code>api.</code> subdomain on that domain</li>
                                    <li><code>http_port</code> is set to the port Puter is listening on (<code>auto</code> will use <code>4100</code> unless that port is in use)</li>
                                    <li><code>pub_port</code> is set to the external port (ex: <code>443</code> if you're using a reverse proxy that serves over https)</li>
                                </ul>
                            </div>`);
                        } else {
                            $errorMessage.html(`Failed to log in: Error ${html_encode(err.status)}`);
                        }
                    }
                    $(el_window).find('.login-error-msg').fadeIn();
                },
            });
        });

        $(el_window).find('.login-form').on('submit', function (e) {
            e.preventDefault();
            e.stopPropagation();

            // Instead of triggering the click event, process the login directly
            const email_username = $(el_window).find('.email_or_username').val();
            const password = $(el_window).find('.password').val();

            // Basic validation
            if ( ! email_username ) {
                $(el_window).find('.login-error-msg').html(i18n('login_email_username_required'));
                $(el_window).find('.login-error-msg').fadeIn();
                return false;
            }

            if ( ! password ) {
                $(el_window).find('.login-error-msg').html(i18n('password_required') || 'Password is required');
                $(el_window).find('.login-error-msg').fadeIn();
                return false;
            }

            // Process login using the same function as the button click
            $(el_window).find('.login-btn').click();

            return false;
        });

        $(el_window).find('.signup-c2a-clickable').on('click', async function (e) {
            //destroy this window
            $(el_window).close();
            // create Signup window
            const signup = await UIWindowSignup({
                referrer: options.referrer,
                show_close_button: options.show_close_button,
                reload_on_success: options.reload_on_success,
                redirect_url: options.redirect_url,
                window_options: options.window_options,
                send_confirmation_code: options.send_confirmation_code,
            });
            if ( signup )
            {
                resolve(true);
            }
        });

        $(el_window).find(`#toggle-show-password-${internal_id}`).on('click', function (e) {
            options.show_password = !options.show_password;
            // hide/show password and update icon
            $(el_window).find('.password').attr('type', options.show_password ? 'text' : 'password');
            $(el_window).find('.toggle-show-password-icon').attr('src', options.show_password ? window.icons['eye-closed.svg'] : window.icons['eye-open.svg']);
        });
    });
}

export default UIWindowLogin;
