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

/** Resolves true once a seat replaces the password its administrator chose. */
function UIWindowPasswordChangeRequired (options) {
    return new Promise(async (resolve) => {
        options = options ?? {};
        options.window_options = options.window_options ?? {};

        let h = '';
        if ( options.show_close_button !== false ) {
            h += '<div class="qr-code-window-close-btn generic-close-window-button"> &times; </div>';
        }
        h += '<div style="-webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; color: #3e5362; max-width: 350px; margin: 0 auto; padding: 20px;">';
        h += `<h3 style="text-align:center; font-weight: 500; font-size: 20px; margin-top: 0;">${i18n('password_change_required_title')}</h3>`;
        h += `<p style="text-align:center;">${i18n('password_change_required_hint')}</p>`;
        h += '<div class="form-error-msg"></div>';
        h += '<form>';
        h += `<label for="pcr-current">${i18n('current_password')}</label>`;
        h += '<input id="pcr-current" class="pcr-current" type="password" autocomplete="current-password" />';
        h += `<label for="pcr-new">${i18n('new_password')}</label>`;
        h += '<input id="pcr-new" class="pcr-new" type="password" autocomplete="new-password" />';
        h += `<label for="pcr-confirm">${i18n('confirm_new_password')}</label>`;
        h += '<input id="pcr-confirm" class="pcr-confirm" type="password" autocomplete="new-password" />';
        h += `<button type="submit" class="button button-block button-primary pcr-btn" style="margin-top:16px;">${i18n('change_password')}</button>`;
        h += '</form>';
        h += '</div>';

        const el_window = await UIWindow({
            title: null,
            icon: null,
            uid: null,
            is_dir: false,
            body_content: h,
            has_head: false,
            selectable_body: false,
            draggable_body: true,
            allow_context_menu: false,
            is_resizable: false,
            is_droppable: false,
            init_center: true,
            allow_native_ctxmenu: false,
            allow_user_select: false,
            backdrop: true,
            width: 390,
            height: 'auto',
            dominant: true,
            show_in_taskbar: false,
            onAppend: function (this_window) {
                $(this_window).find('.pcr-current').get(0)?.focus({ preventScroll: true });
            },
            window_class: 'window-login',
            body_css: {
                width: 'initial',
                height: '100%',
                'background-color': 'rgb(245 247 249)',
                'backdrop-filter': 'blur(3px)',
            },
            ...options.window_options,
        });

        const origin = window.gui_origin || window.api_origin || '';
        const $err = $(el_window).find('.form-error-msg');

        const fail = (message) => {
            $err.html(html_encode(message)).fadeIn();
            $(el_window).find('.pcr-btn').removeClass('disabled');
            $(el_window).find('.pcr-current, .pcr-new, .pcr-confirm').attr('disabled', false);
        };

        $(el_window).find('form').on('submit', async function (e) {
            e.preventDefault();
            const current_password = $(el_window).find('.pcr-current').val();
            const new_password = $(el_window).find('.pcr-new').val();
            const confirm_new_password = $(el_window).find('.pcr-confirm').val();

            $err.hide();
            if ( !current_password || !new_password || !confirm_new_password ) {
                return fail(i18n('all_fields_required'));
            }
            if ( new_password !== confirm_new_password ) {
                return fail(i18n('passwords_do_not_match'));
            }
            // Otherwise the account is still on the credential its admin holds.
            if ( new_password === current_password ) {
                return fail(i18n('password_change_required_same'));
            }
            const strength = check_password_strength(new_password);
            if ( !strength.overallPass ) {
                return fail(i18n('password_strength_error'));
            }

            $(el_window).find('.pcr-btn').addClass('disabled');
            $(el_window).find('.pcr-current, .pcr-new, .pcr-confirm').attr('disabled', true);

            let res;
            try {
                res = await fetch(`${origin}/user-protected/change-password`, {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        password: current_password,
                        new_pass: new_password,
                    }),
                });
            } catch (err) {
                return fail(err?.message || 'Request failed');
            }

            if ( res.ok ) {
                if ( window.user ) window.user.requires_password_change = false;
                $(el_window).close();
                resolve(true);
                return;
            }
            const data = await res.json().catch(() => ({}));
            fail(data.message || res.statusText || 'Request failed');
        });
    });
}

export default UIWindowPasswordChangeRequired;
