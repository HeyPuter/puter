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

import TeePromise from '../util/TeePromise.js';
import UIWindow from './UIWindow.js';
import UIWindowRecoverPassword from './UIWindowRecoverPassword.js';
import UIWindowSignup from './UIWindowSignup.js';

// ── 2FA Login CSS (injected once) ───────────────────────────────────────────
const LOGIN_2FA_CSS = `
.login-2fa {
    display: flex;
    flex-direction: column;
    align-items: center;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #1a2233;
    user-select: none;
    -webkit-user-select: none;
}

.login-2fa-icon {
    width: 52px;
    height: 52px;
    border-radius: 50%;
    background: #eff6ff;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 20px;
    flex-shrink: 0;
}

/* ── Screens ──────────────────────────────────────────────────────────── */
.login-2fa-screen {
    display: none;
    flex-direction: column;
    align-items: center;
    width: 100%;
    animation: login-2fa-fade-in 0.25s ease;
}
.login-2fa-screen.active {
    display: flex;
}
@keyframes login-2fa-fade-in {
    from { opacity: 0; transform: translateY(6px); }
    to   { opacity: 1; transform: translateY(0); }
}

.login-2fa-title {
    font-size: 18px;
    font-weight: 700;
    color: #1a2233;
    text-align: center;
    margin: 0 0 6px;
}
.login-2fa-desc {
    font-size: 14px;
    line-height: 1.6;
    color: #64748b;
    text-align: center;
    margin: 0 0 24px;
    padding: 0;
}

/* ── OTP code inputs ──────────────────────────────────────────────────── */
.login-2fa-code-inputs {
    display: flex;
    gap: 8px;
    justify-content: center;
    margin-bottom: 8px;
    width: 100%;
    max-width: 300px;
}
.login-2fa-code-inputs input {
    width: 44px;
    height: 52px;
    text-align: center;
    font-size: 22px;
    font-weight: 600;
    font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
    border: 2px solid #e2e8f0;
    border-radius: 10px;
    background: #fff;
    color: #1a2233;
    outline: none;
    transition: border-color 0.15s ease, box-shadow 0.15s ease;
    caret-color: #3b82f6;
    -moz-appearance: textfield;
}
.login-2fa-code-inputs input::-webkit-outer-spin-button,
.login-2fa-code-inputs input::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
}
.login-2fa-code-inputs input:focus {
    border-color: #3b82f6;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
}
.login-2fa-code-inputs input.error {
    border-color: #ef4444;
    box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.1);
    animation: login-2fa-shake 0.4s ease;
}
@keyframes login-2fa-shake {
    0%, 100% { transform: translateX(0); }
    20% { transform: translateX(-4px); }
    40% { transform: translateX(4px); }
    60% { transform: translateX(-3px); }
    80% { transform: translateX(2px); }
}

/* ── Error message ────────────────────────────────────────────────────── */
.login-2fa-error {
    font-size: 13px;
    color: #ef4444;
    text-align: center;
    min-height: 20px;
    margin-bottom: 4px;
}

/* ── Spinner ──────────────────────────────────────────────────────────── */
.login-2fa-spinner {
    display: none;
    justify-content: center;
    align-items: center;
    gap: 8px;
    padding: 8px 0;
    font-size: 13px;
    color: #64748b;
}
.login-2fa-spinner.visible {
    display: flex;
}
.login-2fa-spinner-icon {
    width: 16px;
    height: 16px;
    border: 2px solid #e2e8f0;
    border-top-color: #3b82f6;
    border-radius: 50%;
    animation: login-2fa-spin 0.6s linear infinite;
}
@keyframes login-2fa-spin {
    to { transform: rotate(360deg); }
}

/* ── Link button ──────────────────────────────────────────────────────── */
.login-2fa-link-btn {
    background: none;
    border: none;
    color: #3b82f6;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    padding: 8px 0;
    margin-top: 8px;
    transition: color 0.15s ease;
}
.login-2fa-link-btn:hover {
    color: #2563eb;
    text-decoration: underline;
}

/* ── Recovery input ───────────────────────────────────────────────────── */
.login-2fa-recovery-input {
    width: 100%;
    max-width: 300px;
    box-sizing: border-box;
    height: 52px;
    font-size: 22px;
    font-weight: 600;
    text-align: center;
    font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
    letter-spacing: 2px;
    border: 2px solid #e2e8f0;
    border-radius: 10px;
    background: #fff;
    color: #1a2233;
    outline: none;
    transition: border-color 0.15s ease, box-shadow 0.15s ease;
    caret-color: #3b82f6;
}
.login-2fa-recovery-input:focus {
    border-color: #3b82f6;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
}

/* ── Recovery error ───────────────────────────────────────────────────── */
.login-2fa-recovery-error {
    display: none;
    font-size: 13px;
    color: #ef4444;
    text-align: center;
    padding: 8px 14px;
    background: #fef2f2;
    border: 1px solid #fecaca;
    border-radius: 8px;
    margin-bottom: 12px;
    width: 100%;
    max-width: 300px;
    box-sizing: border-box;
}

/* ── Responsive ───────────────────────────────────────────────────────── */
@media (max-width: 420px) {
    .login-2fa-code-inputs {
        gap: 6px;
    }
    .login-2fa-code-inputs input {
        width: 38px;
        height: 46px;
        font-size: 19px;
        border-radius: 8px;
    }
    .login-2fa-recovery-input {
        height: 46px;
        font-size: 19px;
    }
    .login-2fa-title {
        font-size: 16px;
    }
    .login-2fa-desc {
        font-size: 13px;
        margin-bottom: 18px;
    }
}
`;

let login_2fa_css_injected = false;
const inject_login_2fa_css = () => {
    if ( login_2fa_css_injected ) return;
    login_2fa_css_injected = true;
    $('<style/>').text(LOGIN_2FA_CSS).appendTo('head');
};

async function UIWindowLogin (options) {
    options = options ?? {};

    if ( options.reload_on_success === undefined )
    {
        options.reload_on_success = true;
    }

    if ( options.redirect_url === undefined )
    {
        if ( window.location?.href?.toLowerCase().endsWith('/action/login') )
        {
            options.redirect_url = '/';
        }
        else
        {
            options.redirect_url = window.location.href;
        }
    }

    return new Promise(async (resolve) => {
        const internal_id = window.uuidv4();

        let h = '';
        h += '<div style="max-width:100%; width:100%; height:100%; min-height:0; box-sizing:border-box; display:flex; flex-direction:column; justify-content:center; align-items:stretch; padding:0; overflow:auto; color:var(--color-text);">';
        // logo
        h += '<div class="logo-wrapper" style="display:flex; justify-content:center; padding:20px 20px 0 20px; margin-bottom: 0;">';
        h += `<img src="${window.icons['logo-white.svg']}" style="width: 40px; height: 40px; margin: 0 auto; display: block; padding: 15px; background-color: blue; border-radius: 5px;">`;
        h += '</div>';
        // title
        h += '<div style="padding:10px 20px; text-align:center; margin-bottom:0;">';
        h += `<h1 style="font-size:18px; margin-bottom:0;">${i18n('log_in')}</h1>`;
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
        h += `<label style="display:block; margin-bottom:5px;">${i18n('password')}</label>`;
        h += `<input id="password-${internal_id}" class="password" type="${options.show_password ? 'text' : 'password'}" name="password" autocomplete="current-password"/>`;
        // show/hide icon
        h += `<span style="position: absolute; right: 5%; top: 50%; cursor: pointer;" id="toggle-show-password-${internal_id}">
                                <img class="toggle-show-password-icon" src="${options.show_password ? window.icons['eye-closed.svg'] : window.icons['eye-open.svg']}" width="20" height="20">
                            </span>`;
        h += '</div>';
        // login
        h += `<button type="submit" class="login-btn button button-primary button-block button-normal">${i18n('log_in')}</button>`;
        // password recovery
        h += `<p style="text-align:center; margin-bottom: 0;"><span class="forgot-password-link">${i18n('forgot_pass_c2a')}</span></p>`;
        // OIDC
        h += '<div class="oidc-providers-wrapper" style="display:none; padding: 0 0 10px 0;">';
        h += `<div style="text-align:center; margin: 10px 0; font-size:13px; color:var(--color-text-muted);">${ i18n('or') }</div>`;
        h += `<button type="button" class="oidc-google-btn button button-block button-normal" style="display:none; align-items:center; justify-content:center; gap:8px;"><img style="width: 20px; height: 20px;" src="data:image/webp;base64,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" />${i18n('sign_in_with_google')}</button>`;
        h += `<button type="button" class="oidc-apple-btn button button-block button-normal" style="display:none; align-items:center; justify-content:center; gap:8px; margin-top:8px;"><svg style="width:20px; height:20px;" viewBox="0 0 384 512" fill="currentColor"><path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z"/></svg>${i18n('sign_in_with_apple')}</button>`;
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
                    $(this_window).find('.login-error-msg').html(options.authError).fadeIn();
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

        $(el_window).find('.forgot-password-link').on('click', function (e) {
            UIWindowRecoverPassword({
                window_options: {
                    backdrop: true,
                    stay_on_top: isMobile.phone,
                    close_on_backdrop_click: false,
                },
            });
        });

        (async () => {
            try {
                const res = await fetch(`${window.api_origin}/auth/oidc/providers`);
                if ( ! res.ok ) return;
                const data = await res.json();
                if ( ! data.providers ) return;

                const wireOidcBtn = (provider, btnClass) => {
                    $(el_window).find(btnClass).css('display', 'flex');
                    $(el_window).find(btnClass).on('click', function () {
                        let url = `${window.gui_origin}/auth/oidc/${provider}/start?flow=login`;

                        const referrer = options.referrer ?? window.referrerStr ?? window.openerOrigin;
                        if ( referrer ) {
                            url += `&referrer=${encodeURIComponent(referrer)}`;
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
            let data;
            if ( window.is_email(email_username) ) {
                data = JSON.stringify({
                    email: email_username,
                    password: password,
                });
            } else {
                data = JSON.stringify({
                    username: email_username,
                    password: password,
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
                    let p = Promise.resolve();
                    if ( data.next_step === 'otp' ) {
                        inject_login_2fa_css();
                        p = new TeePromise();
                        let win;

                        // ── Build 2FA verification HTML ──
                        let h2fa = '';
                        h2fa += '<div class="login-2fa">';

                        // ── Shield icon ──
                        h2fa += '<div class="login-2fa-icon">';
                        h2fa += '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>';
                        h2fa += '</div>';

                        // ── OTP screen ──
                        h2fa += '<div class="login-2fa-screen active" data-screen="otp">';
                        h2fa += `<h3 class="login-2fa-title">${i18n('login2fa_otp_title')}</h3>`;
                        h2fa += `<p class="login-2fa-desc">${i18n('login2fa_otp_instructions')}</p>`;
                        h2fa += '<div class="login-2fa-code-inputs">';
                        for ( let i = 0; i < 6; i++ ) {
                            h2fa += `<input type="text" inputmode="numeric" maxlength="1" autocomplete="off" data-idx="${i}" />`;
                        }
                        h2fa += '</div>';
                        h2fa += '<div class="login-2fa-error"></div>';
                        h2fa += `<div class="login-2fa-spinner"><div class="login-2fa-spinner-icon"></div><span>${i18n('verifying') || 'Verifying...'}</span></div>`;
                        h2fa += `<button type="button" class="login-2fa-link-btn login-2fa-to-recovery">${i18n('login2fa_use_recovery_code')}</button>`;
                        h2fa += '</div>';

                        // ── Recovery screen ──
                        h2fa += '<div class="login-2fa-screen" data-screen="recovery">';
                        h2fa += `<h3 class="login-2fa-title">${i18n('login2fa_recovery_title')}</h3>`;
                        h2fa += `<p class="login-2fa-desc">${i18n('login2fa_recovery_instructions')}</p>`;
                        h2fa += '<div class="login-2fa-recovery-error"></div>';
                        h2fa += `<input type="text" class="login-2fa-recovery-input" placeholder="${html_encode(i18n('login2fa_recovery_placeholder'))}" maxlength="8" autocomplete="off" />`;
                        h2fa += `<button type="button" class="login-2fa-link-btn login-2fa-to-otp">${i18n('login2fa_recovery_back')}</button>`;
                        h2fa += '</div>';

                        h2fa += '</div>';

                        win = await UIWindow({
                            title: null,
                            app: 'login-2fa',
                            single_instance: true,
                            icon: null,
                            uid: null,
                            is_dir: false,
                            body_content: h2fa,
                            has_head: false,
                            selectable_body: false,
                            draggable_body: false,
                            allow_context_menu: false,
                            is_resizable: false,
                            is_droppable: false,
                            init_center: true,
                            allow_native_ctxmenu: false,
                            allow_user_select: false,
                            width: Math.min(400, window.innerWidth - 24),
                            height: 'auto',
                            dominant: true,
                            show_in_taskbar: false,
                            is_draggable: false,
                            backdrop: true,
                            stay_on_top: true,
                            window_class: 'window-login-2fa',
                            body_css: {
                                width: 'initial',
                                height: '100%',
                                'background-color': '#f8fafc',
                                padding: '32px 28px 24px',
                            },
                            on_close: () => {
                                $(el_window).find('.login-btn').prop('disabled', false);
                            },
                        });

                        const $w = $(win);

                        // ── Screen navigation ──
                        function showScreen (name) {
                            $w.find('.login-2fa-screen').removeClass('active');
                            $w.find(`.login-2fa-screen[data-screen="${name}"]`).addClass('active');
                            if ( name === 'otp' ) {
                                setTimeout(() => $w.find('.login-2fa-code-inputs input').first().focus(), 80);
                            } else {
                                setTimeout(() => $w.find('.login-2fa-recovery-input').focus(), 80);
                            }
                        }

                        $w.find('.login-2fa-to-recovery').on('click', () => {
                            $w.find('.login-2fa-code-inputs input').val('').removeClass('error');
                            $w.find('.login-2fa-error').text('');
                            showScreen('recovery');
                        });
                        $w.find('.login-2fa-to-otp').on('click', () => {
                            $w.find('.login-2fa-recovery-input').val('');
                            $w.find('.login-2fa-recovery-error').text('').hide();
                            showScreen('otp');
                        });

                        // ── OTP code input handling ──
                        const $inputs = $w.find('.login-2fa-code-inputs input');
                        let is_verifying = false;

                        $inputs.on('input', function () {
                            const val = $(this).val().replace(/\D/g, '');
                            $(this).val(val.slice(0, 1));
                            $(this).removeClass('error');
                            $w.find('.login-2fa-error').text('');

                            if ( val && $(this).data('idx') < 5 ) {
                                $inputs.eq($(this).data('idx') + 1).focus();
                            }

                            const code = $inputs.map(function () { return $(this).val(); }).get().join('');
                            if ( code.length === 6 && ! is_verifying ) {
                                verifyOtp(code);
                            }
                        });

                        $inputs.on('keydown', function (e) {
                            const idx = $(this).data('idx');
                            if ( e.key === 'Backspace' && ! $(this).val() && idx > 0 ) {
                                $inputs.eq(idx - 1).focus().val('');
                            }
                            if ( e.key === 'ArrowLeft' && idx > 0 ) {
                                e.preventDefault();
                                $inputs.eq(idx - 1).focus();
                            }
                            if ( e.key === 'ArrowRight' && idx < 5 ) {
                                e.preventDefault();
                                $inputs.eq(idx + 1).focus();
                            }
                        });

                        $inputs.on('paste', function (e) {
                            e.preventDefault();
                            const pasted = (e.originalEvent.clipboardData || window.clipboardData)
                                .getData('text').replace(/\D/g, '').slice(0, 6);
                            if ( ! pasted ) return;
                            for ( let i = 0; i < 6; i++ ) {
                                $inputs.eq(i).val(pasted[i] || '');
                            }
                            $inputs.eq(Math.min(pasted.length, 6) - 1).focus();
                            if ( pasted.length === 6 && ! is_verifying ) {
                                verifyOtp(pasted);
                            }
                        });

                        async function verifyOtp (code) {
                            is_verifying = true;
                            $inputs.attr('disabled', true);
                            $w.find('.login-2fa-spinner').addClass('visible');
                            $w.find('.login-2fa-error').text('');
                            let error_i18n_key = 'something_went_wrong';
                            try {
                                const resp = await fetch(`${window.gui_origin}/login/otp`, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                        token: data.otp_jwt_token,
                                        code: code,
                                    }),
                                });
                                if ( resp.status === 429 ) {
                                    error_i18n_key = 'confirm_code_generic_too_many_requests';
                                    throw new Error('expected error');
                                }
                                const next_data = await resp.json();
                                if ( ! next_data.proceed ) {
                                    error_i18n_key = 'confirm_code_generic_incorrect';
                                    throw new Error('expected error');
                                }
                                data = next_data;
                                $w.find('.login-2fa-spinner').removeClass('visible');
                                $(win).close();
                                p.resolve();
                            } catch (e) {
                                $w.find('.login-2fa-spinner').removeClass('visible');
                                $w.find('.login-2fa-error').text(i18n(error_i18n_key));
                                $inputs.addClass('error').attr('disabled', false);
                                setTimeout(() => {
                                    $inputs.val('').removeClass('error');
                                    $inputs.first().focus();
                                }, 1200);
                            }
                            is_verifying = false;
                        }

                        // ── Recovery code handling ──
                        $w.find('.login-2fa-recovery-input').on('input', async function () {
                            const value = $(this).val();
                            if ( value.length !== 8 ) return;
                            let error_i18n_key = 'something_went_wrong';
                            try {
                                const resp = await fetch(`${window.api_origin}/login/recovery-code`, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                        token: data.otp_jwt_token,
                                        code: value,
                                    }),
                                });
                                if ( resp.status === 429 ) {
                                    error_i18n_key = 'confirm_code_generic_too_many_requests';
                                    throw new Error('expected error');
                                }
                                const next_data = await resp.json();
                                if ( ! next_data.proceed ) {
                                    error_i18n_key = 'confirm_code_generic_incorrect';
                                    throw new Error('expected error');
                                }
                                data = next_data;
                                $(win).close();
                                p.resolve();
                            } catch (e) {
                                $w.find('.login-2fa-recovery-error').text(i18n(error_i18n_key)).show();
                            }
                        });

                        // Focus first OTP input
                        setTimeout(() => $inputs.first().focus(), 150);
                    }

                    await p;

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
                $(el_window).find('.login-error-msg').html(i18n('email_or_username_required') || 'Email or username is required');
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
