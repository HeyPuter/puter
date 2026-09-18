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
import {
    appHostOf,
    buildRequestBody,
    looksLikeEmail,
} from '../helpers/magicLinkSignIn.js';

/**
 * Passwordless sign-in. Sends a sign-in link to the email and then only says
 * to check the inbox: the sign-in finishes on the tab the link opens, and
 * this window is left behind.
 *
 * With `opener_origin`, this is a third-party site's popup: the window shows
 * which site is asking and the link signs the user in to that site, landing
 * on `return_url`. Without it, the link signs the user in to Puter itself.
 *
 * Resolves with `{ next: 'login' }` when the user asks for the password
 * window instead, or `false` if the window is closed.
 */
async function UIWindowMagicLinkSignIn (options) {
    options = options ?? {};
    const puter_mode = ! options.opener_origin;
    const host = puter_mode ? '' : appHostOf(options.opener_origin);

    return new Promise(async (resolve) => {
        const internal_id = window.uuidv4();
        let settled = false;

        const settle = (value) => {
            if ( settled ) return;
            settled = true;
            resolve(value);
        };

        let h = '';
        h += '<div style="max-width:100%; width:100%; height:100%; min-height:0; box-sizing:border-box; display:flex; flex-direction:column; justify-content:center; align-items:stretch; padding:0; overflow:auto; color:var(--color-text);">';
        h += '<div class="logo-wrapper" style="display:flex; justify-content:center; padding:20px 20px 0 20px; margin-bottom: 0;">';
        h += `<img src="${window.icons['logo-white.svg']}" class="auth-logo" style="width: 40px; height: 40px; margin: 0 auto; display: block; padding: 15px; background-color: blue; border-radius: 5px;">`;
        h += '</div>';
        h += '<div style="padding:10px 20px; text-align:center; margin-bottom:0;">';
        h += `<h1 class="login-form-title">${i18n('magic_link_title')}</h1>`;
        // A third-party site's popup says which site brought the user here.
        if ( ! puter_mode ) {
            h += `<p class="auth-opener-notice">${i18n('magic_link_app_uses_puter', [host])}</p>`;
        }
        h += '</div>';
        h += '<div style="padding:20px; overflow-y:auto; overflow-x:hidden;">';

        h += '<form class="magic-link-form" style="width:100%; max-width: 400px; margin: 0 auto;">';
        h += '<div style="position: relative; margin-bottom: 20px;">';
        h += `<label for="magic-link-email-${internal_id}" style="display:block; margin-bottom:5px;">${i18n('email')}</label>`;
        h += `<input id="magic-link-email-${internal_id}" class="magic-link-email" type="email" value="${html_encode(options.email ?? '')}" autocomplete="email" spellcheck="false" autocorrect="off" autocapitalize="off"/>`;
        h += '</div>';
        h += `<button type="submit" class="magic-link-send-btn button button-primary button-block button-normal">${i18n('magic_link_continue')}</button>`;
        h += `<p class="signup-terms">${i18n('magic_link_tos_fineprint', [], false)}</p>`;
        h += '<div class="magic-link-error-msg" style="display:none; color:#e74c3c; line-height:18px; font-size:13px; text-align:center;"></div>';
        h += '</form>';
        // Sent state: the rest happens from the inbox.
        h += '<div class="magic-link-sent" style="display:none; width:100%; max-width:400px; margin:0 auto; line-height:20px; font-size:14px; text-align:center;"></div>';

        h += '</div>';
        // password sign-in link
        h += '<div class="c2a-wrapper" style="padding:15px;">';
        h += `<button class="login-c2a-clickable magic-link-login-c2a">${i18n('magic_link_log_in_c2a')}</button>`;
        h += '</div>';
        h += '</div>';

        const el_window = await UIWindow({
            title: null,
            app: 'magic-link-sign-in',
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
            show_close_button: options.show_close_button,
            ...options.window_options,
            width: 350,
            dominant: true,
            center: true,
            on_close: () => {
                settle(false);
            },
            onAppend: function (this_window) {
                const $email = $(this_window).find('.magic-link-email');
                if ( ! $email.val() ) $email.get(0)?.focus({ preventScroll: true });
            },
        });

        const $form = $(el_window).find('.magic-link-form');
        const $error = $(el_window).find('.magic-link-error-msg');
        const $sendBtn = $(el_window).find('.magic-link-send-btn');

        const showError = (message) => {
            $error.html(html_encode(message)).show();
        };
        const showSent = (email) => {
            $form.hide();
            $(el_window).find('.magic-link-sent')
                .html(html_encode(i18n('magic_link_sent_message', { email }, false)))
                .show();
        };

        const sendLink = async () => {
            const email = String($(el_window).find('.magic-link-email').val() ?? '').trim();
            $error.hide();
            if ( ! looksLikeEmail(email) ) {
                showError(i18n('magic_link_invalid_email', [], false));
                return;
            }
            const body = buildRequestBody({
                email,
                returnUrl: options.return_url,
                openerOrigin: options.opener_origin,
            });
            if ( ! body ) {
                showError(i18n('magic_link_request_failed', [], false));
                return;
            }

            $sendBtn.prop('disabled', true);
            try {
                const resp = await fetch(`${window.api_origin}/auth/magic-link/request`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                });
                if ( resp.status === 429 ) {
                    showError(i18n('magic_link_too_many_requests', [], false));
                    return;
                }
                if ( ! resp.ok ) {
                    showError(i18n('magic_link_request_failed', [], false));
                    return;
                }
                showSent(email);
            } catch {
                showError(i18n('magic_link_request_failed', [], false));
            } finally {
                $sendBtn.prop('disabled', false);
            }
        };

        $form.on('submit', (e) => {
            e.preventDefault();
            sendLink();
        });

        $(el_window).find('.magic-link-login-c2a').on('click', () => {
            // Settle before closing: on_close would otherwise settle with false.
            settle({ next: 'login' });
            $(el_window).close();
        });
    });
}

export default UIWindowMagicLinkSignIn;
