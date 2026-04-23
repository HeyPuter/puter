/**
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

import check_password_strength from '../helpers/check_password_strength.js';
import UIWindow from './UIWindow.js';
import UIWindowEmailConfirmationRequired from './UIWindowEmailConfirmationRequired.js';
import UIWindowLogin from './UIWindowLogin.js';

function UIWindowSignup (options) {
    options = options ?? {};
    options.reload_on_success = options.reload_on_success ?? true;
    options.has_head = options.has_head ?? true;
    options.send_confirmation_code = options.send_confirmation_code ?? false;
    options.show_close_button = options.show_close_button ?? true;

    return new Promise(async (resolve) => {
        const internal_id = window.uuidv4();

        let h = '';
        h += '<div style="margin: 0 auto; max-width: 500px; min-width: 400px;">';
        // logo
        h += `<img src="${window.icons['logo-white.svg']}" style="width: 40px; height: 40px; margin: 0 auto; display: block; padding: 10px; background-color: blue; border-radius: 5px;">`;
        // close button
        if ( !options.has_head && options.show_close_button !== false )
        {
            h += '<div class="generic-close-window-button"> &times; </div>';
        }

        // Form
        h += '<div style="padding: 15px;">';

        // title
        h += `<h1 class="signup-form-title">${i18n('create_free_account')}</h1>`;
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
        h += '<div style="overflow: hidden; margin-top: 10px; position: relative;">';
        h += `<label for="password-${internal_id}">${i18n('password')}</label>`;
        h += `<input id="password-${internal_id}" class="password" type="${options.show_password ? 'text' : 'password'}" name="password" autocomplete="new-password" />`;
        // show/hide icon
        h += `<span style="position: absolute; right: 5%; top: 50%; cursor: pointer;" id="toggle-show-password-${internal_id}">
                                    <img class="toggle-show-password-icon" src="${options.show_password ? window.icons['eye-closed.svg'] : window.icons['eye-open.svg']}" width="20" height="20">
                              </span>`;
        h += '</div>';
        // confirm password
        h += '<div style="overflow: hidden; margin-top: 10px; margin-bottom: 10px; position: relative">';
        h += `<label for="confirm-password-${internal_id}">${i18n('signup_confirm_password')}</label>`;
        h += `<input id="confirm-password-${internal_id}" class="confirm-password" type="${options.show_password ? 'text' : 'password'}" name="confirm-password" autocomplete="new-password" />`;
        // show/hide icon
        h += `<span style="position: absolute; right: 5%; top: 50%; cursor: pointer;" id="toggle-show-password-${internal_id}">
                                     <img class="toggle-show-password-icon" src="${options.show_password ? window.icons['eye-closed.svg'] : window.icons['eye-open.svg']}" width="20" height="20">
                              </span>`;
        h += '</div>';
        // bot trap - if this value is submitted server will ignore the request
        h += '<input type="text" name="p102xyzname" class="p102xyzname" value="">';

        // Turnstile widget (only when enabled)
        if ( window.gui_params?.turnstileSiteKey ) {
            h += '<div style="min-height: 20px; display: flex; justify-content: center;">';
            // appearance: always/execute/interaction-only
            // docs: https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/widget-configurations/?utm_source=chatgpt.com#appearance-modes
            h += `<div class="cf-turnstile" data-sitekey="${window.gui_params.turnstileSiteKey}" data-appearance="interaction-only"></div>`;
            h += '</div>';
        }

        // terms and privacy
        h += `<p class="signup-terms">${i18n('tos_fineprint', [], false)}</p>`;
        // Create Account
        h += `<button class="signup-btn button button-primary button-block button-normal">${i18n('create_free_account')}</button>`;
        h += '</form>';
        h += '<div class="oidc-providers-wrapper" style="display:none; padding: 10px 0;">';
        h += `<div style="text-align:center; margin: 10px 0; font-size:13px;">${ i18n('or') }</div>`;
        h += `<button type="button" class="oidc-google-btn button button-block button-normal" style="display:flex; align-items:center; justify-content:center; gap:8px;"><img style="width: 20px; height: 20px;" src="data:image/webp;base64,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" />${i18n('sign_up_with_google')}</button>`;
        h += '</div>';
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
                if ( options.authError ) {
                    $(el_window).find('.signup-error-msg').html(options.authError).fadeIn();
                }
                if ( ! window.disable_signup_autofocus )
                {
                    $(el_window).find('.username').get(0).focus({ preventScroll: true });
                }

                // Initialize Turnstile widget with callback to capture token
                const initTurnstile = () => {
                    if ( window.turnstile && window.gui_params?.turnstileSiteKey ) {
                        window.turnstile.render('.cf-turnstile', {
                            sitekey: window.gui_params.turnstileSiteKey,
                            callback: function (token) {
                                // Store the token for the signup request
                                $(el_window).find('.cf-turnstile').attr('data-token', token);
                                // Enable the signup button once CAPTCHA is completed
                                $(el_window).find('.signup-btn').prop('disabled', false);
                                // Add visual feedback
                                $(el_window).find('.cf-turnstile').addClass('captcha-completed');
                            },
                            'expired-callback': function () {
                                // Reset when token expires
                                $(el_window).find('.cf-turnstile').removeAttr('data-token');
                                $(el_window).find('.cf-turnstile').removeClass('captcha-completed');
                                $(el_window).find('.signup-btn').prop('disabled', true);
                            },
                        });
                    } else {
                        // If Turnstile isn't loaded yet, wait for it
                        setTimeout(initTurnstile, 100);
                    }
                };

                initTurnstile();

                (async () => {
                    try {
                        const res = await fetch(`${window.api_origin}/auth/oidc/providers`);
                        if ( ! res.ok ) return;
                        const data = await res.json();
                        if ( data.providers && data.providers.includes('google') ) {
                            $(el_window).find('.oidc-providers-wrapper').show();
                            $(el_window).find('.oidc-google-btn').on('click', function () {
                                let url = `${window.gui_origin}/auth/oidc/google/start?flow=signup`;
                                if ( window.embedded_in_popup && window.url_query_params?.get('msg_id') ) {
                                    url += `&embedded_in_popup=true&msg_id=${encodeURIComponent(window.url_query_params.get('msg_id'))}`;
                                    if ( window.openerOrigin ) {
                                        url += `&opener_origin=${encodeURIComponent(window.openerOrigin)}`;
                                    }
                                }
                                window.location.href = url;
                            });
                        }
                    } catch (_) {
                    }
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
                'display': 'flex',
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

        $(el_window).find('.login-c2a-clickable').on('click', async function (e) {
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
            if ( login )
            {
                resolve(true);
            }
        });

        $(el_window).find('.signup-btn').on('click', function (e) {
            // Clear previous error states
            $(el_window).find('.signup-error-msg').hide();

            //Username
            let username = $(el_window).find('.username').val();

            if ( ! username ) {
                $(el_window).find('.signup-error-msg').html(i18n('username_required'));
                $(el_window).find('.signup-error-msg').fadeIn();
                return;
            }

            //Email
            let email = $(el_window).find('.email').val();

            // must have an email
            if ( ! email ) {
                $(el_window).find('.signup-error-msg').html(i18n('email_required'));
                $(el_window).find('.signup-error-msg').fadeIn();
                return;
            }
            // must be a valid email
            else if ( ! window.is_email(email) ) {
                $(el_window).find('.signup-error-msg').html(i18n('email_invalid'));
                $(el_window).find('.signup-error-msg').fadeIn();
                return;
            }

            //Password
            let password = $(el_window).find('.password').val();

            // must have a password
            if ( ! password ) {
                $(el_window).find('.signup-error-msg').html(i18n('password_required'));
                $(el_window).find('.signup-error-msg').fadeIn();
                return;
            }
            // check password strength
            const pass_strength = check_password_strength(password);
            if ( ! pass_strength.overallPass ) {
                $(el_window).find('.signup-error-msg').html(i18n('password_strength_error'));
                $(el_window).find('.signup-error-msg').fadeIn();
                return;
            }
            // get confirm password value
            const confirmPassword = $(el_window).find('.confirm-password').val();
            if ( ! confirmPassword ) {
                $(el_window).find('.signup-error-msg').html(i18n('confirm_password_required'));
                $(el_window).find('.signup-error-msg').fadeIn();
                return;
            }
            // check if passwords match
            if ( password !== confirmPassword ) {
                $(el_window).find('.signup-error-msg').html(i18n('passwords_do_not_match'));
                $(el_window).find('.signup-error-msg').fadeIn();
                return;
            }

            // Check if Cloudflare Turnstile CAPTCHA was completed
            let turnstileToken = null;
            if ( window.turnstile && window.gui_params?.turnstileSiteKey ) {
                turnstileToken = $(el_window).find('.cf-turnstile').attr('data-token');
                if ( ! turnstileToken ) {
                    $(el_window).find('.signup-error-msg').html(i18n('captcha_required') || 'Please complete the CAPTCHA verification');
                    $(el_window).find('.signup-error-msg').fadeIn();
                    return;
                }
            }

            //xyzname
            let p102xyzname = $(el_window).find('.p102xyzname').val();

            // disable 'Create Account' button
            $(el_window).find('.signup-btn').prop('disabled', true);

            let headers = {};
            if ( window.custom_headers )
            {
                headers = window.custom_headers;
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

            $.ajax({
                url: `${window.gui_origin }/signup`,
                type: 'POST',
                async: true,
                headers: headers,
                contentType: 'application/json',
                data: JSON.stringify(requestData),
                success: async function (data) {
                    await window.update_auth_data(data.token, data.user);

                    //send out the login event
                    if ( options.reload_on_success ) {
                        window.onbeforeunload = null;
                        // either options.redirect_url or the current page
                        const redirectUrl = options.redirect_url || '/';
                        window.location.replace(redirectUrl);
                    } else if ( options.send_confirmation_code || data.user?.requires_email_confirmation ) {
                        $(el_window).close();
                        let is_verified = await UIWindowEmailConfirmationRequired({
                            stay_on_top: true,
                            has_head: true,
                            reload_on_success: options.reload_on_success,
                            window_options: options.window_options ?? {},
                        });
                        resolve(is_verified);
                    } else {
                        resolve(true);
                    }
                },
                error: function (err) {
                    // re-enable 'Create Account' button so user can try again
                    $(el_window).find('.signup-btn').prop('disabled', false);

                    // Reset Turnstile widget for retry
                    try {
                        if ( window.turnstile ) {
                            window.turnstile?.reset('.cf-turnstile');
                            $(el_window).find('.cf-turnstile').removeAttr('data-token');
                            $(el_window).find('.cf-turnstile').removeClass('captcha-completed');
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

                        // Handle timeout specifically
                        if ( errorJson?.code === 'response_timeout' || errorText.includes('timeout') ) {
                            $(el_window).find('.signup-error-msg').html(i18n('server_timeout') || 'The server took too long to respond. Please try again.');
                            $(el_window).find('.signup-error-msg').fadeIn();
                            return;
                        }

                        // If it's a message in the JSON, use that
                        if ( errorJson.message ) {
                            $(el_window).find('.signup-error-msg').html(errorJson.message);
                            $(el_window).find('.signup-error-msg').fadeIn();
                            return;
                        }
                    } catch (e) {
                        console.log(e);
                        // Not JSON, continue with text analysis
                    }

                    // Default general error handling
                    $(el_window).find('.signup-error-msg').html(errorText || i18n('signup_error') || 'An error occurred during signup. Please try again.');
                    $(el_window).find('.signup-error-msg').fadeIn();
                },
                timeout: 30000, // Add a reasonable timeout
            });
        });

        $(el_window).find('.signup-form').on('submit', function (e) {
            e.preventDefault();
            e.stopPropagation();
            return false;
        });

        $(el_window).find(`#toggle-show-password-${internal_id}, #toggle-show-password-${internal_id}-confirm`).on('click', function (e) {
            // hide/show password/confirm password and update icon
            let inputField = $(this).siblings('input');
            let isPasswordVisible = inputField.attr('type') === 'text';
            inputField.attr('type', isPasswordVisible ? 'password' : 'text');
            $(this).find('.toggle-show-password-icon').attr(
                'src',
                isPasswordVisible ? window.icons['eye-open.svg'] : window.icons['eye-closed.svg'],
            );
        });

        //remove login window
        $('.signup-c2a-clickable').parents('.window').close();
    });
}

export default UIWindowSignup;