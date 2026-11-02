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

import UIWindow from './UIWindow.js';
import UIWindowLogin2FA from './UIWindowLogin2FA.js';
import { authLogoHeader, wireAuthLogoHeader } from '../helpers/authLogoHeader.js';
import { appHostOf, consumeErrorMessage } from '../helpers/magicLinkSignIn.js';

const TURNSTILE_SCRIPT_WAIT_MS = 10_000;

/**
 * A captcha token per call when the deployment runs Turnstile, else null.
 * New accounts need one, and a token is only good once.
 */
const turnstileTokens = (container) => {
    const site_key = window.gui_params?.turnstileSiteKey;
    let widget_id = null;
    let pending = null;
    return async () => {
        if ( ! site_key ) return null;
        for ( let waited = 0; !window.turnstile && waited < TURNSTILE_SCRIPT_WAIT_MS; waited += 100 ) {
            await new Promise((r) => setTimeout(r, 100));
        }
        if ( ! window.turnstile ) return null;
        const token = new Promise((r) => {
            pending = r;
        });
        if ( widget_id === null ) {
            widget_id = window.turnstile.render(container, {
                sitekey: site_key,
                appearance: 'interaction-only',
                callback: (t) => pending?.(t),
                'error-callback': () => pending?.(null),
            });
        } else {
            window.turnstile.reset(widget_id);
        }
        return token;
    };
};

/**
 * The page a sign-in link opens. Spends the link (asking first when another
 * browser requested it), runs 2FA when the account has it, and resolves the
 * `/login`-shaped result plus the link's `request_id` and `app_origin`, or
 * null when the user gives up.
 */
async function UIWindowMagicLinkConsume (link_token) {
    return new Promise(async (resolve) => {
        let settled = false;
        const settle = (value) => {
            if ( settled ) return;
            settled = true;
            resolve(value);
        };

        let h = '';
        h += '<div style="max-width:100%; width:100%; box-sizing:border-box; display:flex; flex-direction:column; align-items:stretch; padding:0; color:var(--color-text);">';
        h += '<div class="logo-wrapper" style="display:flex; justify-content:center; padding:20px 20px 0 20px;">';
        h += authLogoHeader({ logoSrc: window.icons['logo-white.svg'] });
        h += '</div>';
        h += '<div style="padding:10px 20px 20px; text-align:center; max-width:400px; margin:0 auto;">';
        h += `<h1 class="login-form-title">${i18n('magic_link_consume_title')}</h1>`;
        h += `<p class="magic-link-status">${i18n('magic_link_signing_in')}</p>`;
        h += '<div class="magic-link-confirm" style="display:none;">';
        h += '<p class="magic-link-confirm-msg" style="line-height:20px;"></p>';
        h += `<button type="button" class="magic-link-confirm-btn button button-primary button-block button-normal">${i18n('magic_link_confirm_continue')}</button>`;
        h += '</div>';
        h += '<div class="magic-link-error-msg" style="display:none; color:#e74c3c; line-height:18px; font-size:13px; margin-bottom:10px;"></div>';
        h += `<button type="button" class="magic-link-done-btn button button-block button-normal" style="display:none; margin-top:8px;">${i18n('magic_link_back_to_puter')}</button>`;
        h += '<div class="magic-link-captcha" style="display:flex; justify-content:center; margin-top:10px;"></div>';
        h += '</div>';
        h += '</div>';

        const el_window = await UIWindow({
            title: null,
            app: 'magic-link-consume',
            single_instance: true,
            icon: null,
            uid: null,
            is_dir: false,
            body_content: h,
            has_head: false,
            selectable_body: false,
            draggable_body: false,
            allow_context_menu: false,
            is_draggable: false,
            is_droppable: false,
            is_resizable: false,
            stay_on_top: false,
            allow_native_ctxmenu: true,
            allow_user_select: true,
            show_close_button: false,
            cover_page: true,
            width: 350,
            dominant: true,
            center: true,
            on_close: () => settle(null),
            window_class: 'window-login',
            window_css: {
                height: 'initial',
            },
            body_css: {
                width: 'initial',
                padding: '0',
                'background-color': 'rgb(255 255 255)',
                'backdrop-filter': 'blur(3px)',
            },
        });

        wireAuthLogoHeader(el_window);

        const $status = $(el_window).find('.magic-link-status');
        const $confirm = $(el_window).find('.magic-link-confirm');
        const $error = $(el_window).find('.magic-link-error-msg');
        const $done_btn = $(el_window).find('.magic-link-done-btn');
        const next_captcha = turnstileTokens($(el_window).find('.magic-link-captcha').get(0));

        let fingerprint = null;
        try {
            fingerprint = await window.getDeviceFingerprint?.();
        } catch ( _ ) {
            // Sign-in must never block or fail because of device signals.
        }

        const show_error = (message) => {
            $status.hide();
            $confirm.hide();
            $error.html('text' in message ? html_encode(message.text) : i18n(message.key)).show();
            $done_btn.show();
        };

        const consume = async (confirm) => {
            const captcha = await next_captcha();
            let resp;
            let body = null;
            try {
                resp = await fetch(`${window.gui_origin}/auth/magic-link/consume`, {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        token: link_token,
                        ...(confirm ? { confirm: true } : {}),
                        ...(captcha ? { 'cf-turnstile-response': captcha } : {}),
                        ...(fingerprint ? { fingerprint } : {}),
                    }),
                });
                body = await resp.json();
            } catch ( _ ) {
                // Network failure or a non-JSON answer: the generic message.
            }
            if ( ! resp?.ok || ! body ) {
                show_error(consumeErrorMessage(resp?.status ?? 0, body));
                return;
            }

            if ( body.next_step === 'confirm' ) {
                $status.hide();
                const host = body.app_origin ? appHostOf(body.app_origin) : '';
                $(el_window).find('.magic-link-confirm-msg').html(host
                    ? i18n('magic_link_confirm_message_app', [body.email, host])
                    : i18n('magic_link_confirm_message', [body.email]));
                $confirm.show();
                $done_btn.show();
                return;
            }

            let signed_in = body;
            if ( body.next_step === 'otp' ) {
                signed_in = await UIWindowLogin2FA(body.otp_jwt_token);
                if ( ! signed_in?.token ) {
                    show_error({ key: 'auth_error_generic' });
                    return;
                }
            }
            settle({
                token: signed_in.token,
                user: signed_in.user,
                request_id: body.request_id,
                app_origin: body.app_origin ?? null,
            });
            $(el_window).close();
        };

        $(el_window).find('.magic-link-confirm-btn').on('click', async function () {
            $(this).prop('disabled', true);
            $done_btn.hide();
            await consume(true);
            $(this).prop('disabled', false);
        });
        $done_btn.on('click', () => {
            settle(null);
            $(el_window).close();
        });

        await consume(false);
    });
}

export default UIWindowMagicLinkConsume;
