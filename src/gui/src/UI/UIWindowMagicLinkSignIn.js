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
    POLL_INTERVAL_MS,
    appHostOf,
    buildRequestBody,
    generatePopupSecret,
    looksLikeEmail,
} from '../helpers/magicLinkSignIn.js';

/**
 * Passwordless sign-in for a third-party site's popup. Shows which site is
 * asking, sends a sign-in link to the prefilled email (the button doubles
 * as resend), then waits for the link to be clicked and resolves with the
 * opener's token.
 *
 * Resolves with `{ token, app_uid }` once the link is used, or `false`
 * if the window is closed.
 */
async function UIWindowMagicLinkSignIn (options) {
    options = options ?? {};
    const host = appHostOf(options.opener_origin);
    const session = options.session ?? window.uuidv4();
    const popupSecret = generatePopupSecret();

    return new Promise(async (resolve) => {
        const internal_id = window.uuidv4();
        let poll = null;
        let settled = false;

        const settle = (value) => {
            if ( settled ) return;
            settled = true;
            if ( poll ) clearInterval(poll);
            resolve(value);
        };

        let h = '';
        h += '<div style="max-width:100%; width:100%; height:100%; min-height:0; box-sizing:border-box; display:flex; flex-direction:column; justify-content:center; align-items:stretch; padding:0; overflow:auto; color:var(--color-text);">';
        h += '<div class="logo-wrapper" style="display:flex; justify-content:center; padding:20px 20px 0 20px; margin-bottom: 0;">';
        h += `<img src="${window.icons['logo-white.svg']}" class="auth-logo" style="width: 40px; height: 40px; margin: 0 auto; display: block; padding: 15px; background-color: blue; border-radius: 5px;">`;
        h += '</div>';
        h += '<div style="padding:10px 20px; text-align:center; margin-bottom:0;">';
        h += `<h1 style="font-size:18px; margin-bottom:6px;">${i18n('magic_link_title')}</h1>`;
        h += `<p style="margin:0; font-size:13px; color:#5f6b7a; line-height:18px;">${i18n('magic_link_app_uses_puter', { host })}</p>`;
        h += '</div>';
        h += '<div style="padding:20px; overflow-y:auto; overflow-x:hidden;">';

        h += '<form class="magic-link-form" style="width:100%; max-width: 400px; margin: 0 auto;">';
        h += '<div style="position: relative; margin-bottom: 20px;">';
        h += `<label for="magic-link-email-${internal_id}" style="display:block; margin-bottom:5px;">${i18n('email')}</label>`;
        h += `<input id="magic-link-email-${internal_id}" class="magic-link-email" type="email" value="${html_encode(options.email ?? '')}" autocomplete="email" spellcheck="false" autocorrect="off" autocapitalize="off"/>`;
        h += '</div>';
        h += `<button type="submit" class="magic-link-send-btn button button-primary button-block button-normal">${i18n('magic_link_continue')}</button>`;
        h += '<div class="magic-link-status-msg" style="visibility:hidden; min-height:36px; margin-top:12px; line-height:18px; font-size:13px; text-align:center;"></div>';
        h += '</form>';

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
        const $status = $(el_window).find('.magic-link-status-msg');
        const $sendBtn = $(el_window).find('.magic-link-send-btn');

        const showStatus = (message, color) => {
            $status.html(html_encode(message)).css({ color, visibility: 'visible' });
        };
        const showError = (message) => showStatus(message, '#e74c3c');
        const showSuccess = (message) => showStatus(message, '#2e7d32');

        const startPolling = () => {
            if ( poll ) clearInterval(poll);
            poll = setInterval(async () => {
                try {
                    const resp = await fetch(`${window.api_origin}/auth/magic-link/wait`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ session, popup_secret: popupSecret }),
                    });
                    if ( ! resp.ok ) return;
                    const data = await resp.json();
                    if ( ! data?.auth_token ) return;
                    settle({ token: data.auth_token, app_uid: data.app_uid });
                    $(el_window).close();
                } catch {
                    // Network hiccup; the next tick tries again.
                }
            }, POLL_INTERVAL_MS);
        };

        const sendLink = async () => {
            const email = String($(el_window).find('.magic-link-email').val() ?? '').trim();
            $status.css('visibility', 'hidden');
            if ( ! looksLikeEmail(email) ) {
                showError(i18n('magic_link_invalid_email', [], false));
                return;
            }
            const body = buildRequestBody({
                email,
                session,
                returnUrl: options.return_url,
                openerOrigin: options.opener_origin,
                popupSecret,
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
                showSuccess(i18n('magic_link_sent_message', { email }, false));
                startPolling();
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

    });
}

export default UIWindowMagicLinkSignIn;
