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

import UIWindow from './UIWindow.js';
import UIAlert from './UIAlert.js';

function UIWindowRecoverPassword(options){
    return new Promise(async (resolve) => {
        options = options ?? {};

        const h = `
            <div class="auth-container">
                <div class="auth-logo-wrapper">
                    <img class="auth-logo" src="${window.icons['logo-white.svg']}">
                </div>
                <div class="auth-title">
                    <h1>${i18n('recover_password')}</h1>
                </div>
                <div class="auth-form-wrapper">
                    <form class="auth-form pass-recovery-form">
                        <div class="auth-error-msg error"></div>
                        <div class="auth-form-group">
                            <label class="auth-label">${i18n('email_or_username')}</label>
                            <input class="auth-input pass-recovery-username-or-email" type="text" autocomplete="username"/>
                        </div>
                        <button type="submit" class="send-recovery-email button button-primary button-block button-normal">${i18n('send_password_recovery_email')}</button>
                    </form>
                </div>
            </div>
        `;

        const el_window = await UIWindow({
            title: null,
            backdrop: options.backdrop ?? false,
            icon: null,
            uid: null,
            is_dir: false,
            body_content: h,
            has_head: options.has_head ?? true,
            selectable_body: false,
            draggable_body: false,
            allow_context_menu: false,
            is_draggable: options.is_draggable ?? true,
            is_droppable: false,
            is_resizable: false,
            stay_on_top: options.stay_on_top ?? false,
            allow_native_ctxmenu: true,
            allow_user_select: true,
            width: 400,
            dominant: true,
            ...options.window_options,
            onAppend: function(el_window){
                $(el_window).find('.pass-recovery-username-or-email').first().focus();
            },
            window_class: 'window-recover-password',
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
        $(el_window).find('.pass-recovery-form').on('submit', function(e){
            e.preventDefault();
            e.stopPropagation();
            return false;
        });

        // Send recovery email
        $(el_window).find('.send-recovery-email').on('click', function(e){
            let email, username;
            let input = $(el_window).find('.pass-recovery-username-or-email').val();
            if ( window.is_email(input) )
            {
                email = input;
            }
            else
            {
                username = input;
            }

            // todo validation before sending
            $.ajax({
                url: `${window.api_origin}/send-pass-recovery-email`,
                type: 'POST',
                async: true,
                contentType: 'application/json',
                data: JSON.stringify({
                    email: email,
                    username: username,
                }),
                statusCode: {
                    401: function() {
                        window.logout();
                    },
                },
                success: async function(res){
                    $(el_window).close();
                    await UIAlert({
                        message: res.message,
                        body_icon: window.icons['c-check.svg'],
                        stay_on_top: true,
                        backdrop: true,
                        window_options: {
                            backdrop: true,
                            close_on_backdrop_click: false,
                        },
                    });
                },
                error: function(err){
                    $(el_window).find('.error').html(html_encode(err.responseText));
                    $(el_window).find('.error').fadeIn();
                },
                complete: function(){
                },
            });
        });
    });
}

export default UIWindowRecoverPassword;