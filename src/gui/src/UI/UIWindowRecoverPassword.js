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

import UIWindow from './UIWindow.js'
import UIAlert from './UIAlert.js'

function UIWindowRecoverPassword(options){
    return new Promise(async (resolve) => {
        options = options ?? {};

        let h = '';
        h += `<div style="-webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; color: #3e5362;">`;
            h += `<h3 style="text-align:center; font-weight: 400; font-size: 20px;">${i18n('recover_password')}</h3>`;
            h += `<form class="pass-recovery-form">`;
                h += `<p style="text-align:center; padding: 0 20px;"></p>`;
                h += `<div class="error"></div>`;
                h += `<label>${i18n('email_or_username')}</label>`;
                h += `<input class="pass-recovery-username-or-email" type="text"/>`;
                h += `<button type="submit" class="send-recovery-email button button-block button-primary" style="margin-top:10px;">${i18n('send_password_recovery_email')}</button>`;
            h += `</form>`;
        h += `</div>`;

        const el_window = await UIWindow({
            title: null,
            backdrop: options.backdrop ?? false,
            icon: null,
            uid: null,
            is_dir: false,
            body_content: h,
            has_head: options.has_head ?? true,
            selectable_body: false,
            draggable_body: true,
            allow_context_menu: false,
            is_draggable: options.is_draggable ?? true,
            is_droppable: false,
            is_resizable: false,
            stay_on_top: options.stay_on_top ?? false,
            allow_native_ctxmenu: true,
            allow_user_select: true,
            width: 350,
            dominant: true,
            ...options.window_options,
            onAppend: function(el_window){
                $(el_window).find('.pass-recovery-username-or-email').first().focus();
            },
            window_class: 'window-item-properties',
            window_css:{
                height: 'initial',
            },
            body_css: {
                padding: '10px',
                width: 'initial',
                height: 'initial',
                'background-color': 'rgba(231, 238, 245)',
                'backdrop-filter': 'blur(3px)',
            }
        })
        $(el_window).find('.pass-recovery-form').on('submit', function(e){
            e.preventDefault();
            e.stopPropagation();
            return false;
        })

        // Send recovery email
        $(el_window).find('.send-recovery-email').on('click', function(e){
            let email, username;
            let input = $(el_window).find('.pass-recovery-username-or-email').val();
            if(window.is_email(input))
                email = input;
            else
                username = input;

            // todo validation before sending
            $.ajax({
                url: window.api_origin + "/send-pass-recovery-email",
                type: 'POST',
                async: true,
                contentType: "application/json",
                data: JSON.stringify({
                    email: email,
                    username: username,
                }),    
                statusCode: {
                    401: function () {
                        window.logout();
                    },
                },        
                success: async function (res){
                    $(el_window).close();
                    await UIAlert({
                        message: res.message,
                        body_icon: window.icons['c-check.svg'],
                        stay_on_top: true,
                        backdrop: true,
                        window_options: {
                            backdrop: true,
                            close_on_backdrop_click: false,
                        }
                    })           
                },
                error: function (err){
                    $(el_window).find('.error').html(html_encode(err.responseText));
                    $(el_window).find('.error').fadeIn();
                },
                complete: function(){
                }
            })
        })
    })
}

export default UIWindowRecoverPassword