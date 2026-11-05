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

import TeePromise from '../util/TeePromise.js';
import UIWindow from './UIWindow.js';

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

let login2faCssInjected = false;
const injectLogin2faCss = () => {
    if ( login2faCssInjected ) return;
    login2faCssInjected = true;
    $('<style/>').text(LOGIN_2FA_CSS).appendTo('head');
};

/** Verify an existing first-factor challenge with TOTP or a recovery code. */
export default async function UIWindowLogin2FA (challengeToken) {
    injectLogin2faCss();
    const p = new TeePromise();
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
    h2fa += `<div class="login-2fa-spinner"><div class="login-2fa-spinner-icon"></div><span>${i18n('verifying')}</span></div>`;
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
        on_close: () => p.resolve(null),
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
                    token: challengeToken,
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
            $w.find('.login-2fa-spinner').removeClass('visible');
            p.resolve(next_data);
            $(win).close();
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
        // Codes are 8-char base32; a pasted one usually
        // carries the newline it was copied with.
        const value = $(this).val().trim().toUpperCase();
        if ( value.length !== 8 ) return;
        let error_i18n_key = 'something_went_wrong';
        try {
            // Root origin, like `/login/otp` above: the
            // route is `guiOriginOnly` and carries no
            // `subdomain`, so on `api_origin` the
            // subdomain gate skips it and Express 404s.
            const resp = await fetch(`${window.gui_origin}/login/recovery-code`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    token: challengeToken,
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
            p.resolve(next_data);
            $(win).close();
        } catch (e) {
            $w.find('.login-2fa-recovery-error').text(i18n(error_i18n_key)).show();
        }
    });

    // Focus first OTP input
    setTimeout(() => $inputs.first().focus(), 150);
    return p;
}
