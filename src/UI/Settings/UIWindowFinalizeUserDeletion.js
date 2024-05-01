/**
 * Copyright (C) 2024 Puter Technologies Inc.
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

import UIWindow from '../UIWindow.js'

async function UIWindowFinalizeUserDeletion(options){
    return new Promise(async (resolve) => {
        options = options ?? {};

        let h = '';

        // if user is temporary, ask them to type in 'confirm' to delete their account
        if(window.user.is_temp){
            h += `<div style="padding: 20px;">`;
                h += `<div class="generic-close-window-button disable-user-select"> &times; </div>`;
                h += `<img src="${window.icons['danger.svg']}"  class="account-deletion-confirmation-icon">`;
                h += `<p class="account-deletion-confirmation-prompt">${i18n('type_confirm_to_delete_account')}</p>`;
                // error message
                h += `<div class="error-message"></div>`;
                // input field
                h += `<input type="text" class="confirm-temporary-user-deletion" placeholder="${i18n('type_confirm_to_delete_account')}">`;
                h += `<button class="button button-block button-danger proceed-with-user-deletion">${i18n('delete_account')}</button>`;
                h += `<button class="button button-block button-secondary cancel-user-deletion">${i18n('cancel')}</button>`;
            h += `</div>`;
        }
        // otherwise ask for password
        else{
            h += `<div style="padding: 20px;">`;
                h += `<div class="generic-close-window-button disable-user-select"> &times; </div>`;
                h += `<img src="${window.icons['danger.svg']}" class="account-deletion-confirmation-icon">`;
                h += `<p class="account-deletion-confirmation-prompt">${i18n('enter_password_to_confirm_delete_user')}</p>`;
                // error message
                h += `<div class="error-message"></div>`;
                // input field
                h += `<input type="password" class="confirm-user-deletion-password" placeholder="${i18n('current_password')}">`;
                h += `<button class="button button-block button-danger proceed-with-user-deletion">${i18n('delete_account')}</button>`;
                h += `<button class="button button-block button-secondary cancel-user-deletion">${i18n('cancel')}</button>`;
            h += `</div>`;
        }

        const el_window = await UIWindow({
            title: i18n('confirm_delete_user_title'),
            icon: null,
            uid: null,
            is_dir: false,
            body_content: h,
            has_head: false,
            selectable_body: false,
            draggable_body: false,
            allow_context_menu: false,
            is_draggable: true,
            is_resizable: false,
            is_droppable: false,
            init_center: true,
            allow_native_ctxmenu: true,
            allow_user_select: true,
            backdrop: true,
            onAppend: function(el_window){
            },
            width: 500,
            dominant: false,
            window_css: {
                height: 'initial',
                padding: '0',
                border: 'none',
                boxShadow: '0 0 10px rgba(0,0,0,.2)',
            }
        });

        $(el_window).find('.generic-close-window-button').on('click', function(){
            $(el_window).close();
        });

        $(el_window).find('.cancel-user-deletion').on('click', function(){
            $(el_window).close();
        });

        $(el_window).find('.proceed-with-user-deletion').on('click', function(){
            $(el_window).find('.error-message').hide();
            // if user is temporary, check if they typed 'confirm'
            if(window.user.is_temp){
                if($(el_window).find('.confirm-temporary-user-deletion').val() !== 'confirm'){
                    $(el_window).find('.error-message').html(i18n('type_confirm_to_delete_account'), false);
                    $(el_window).find('.error-message').show();
                    return;
                }
            }
            // otherwise, check if password is correct
            else{
                if($(el_window).find('.confirm-user-deletion-password').val() === ''){
                    $(el_window).find('.error-message').html(i18n('all_fields_required'), false);
                    $(el_window).find('.error-message').show();
                    return;
                }
            }

            // delete user
            $.ajax({
                url: window.api_origin + "/delete-own-user",
                type: 'POST',
                async: true,
                contentType: "application/json",
                headers: {
                    "Authorization": "Bearer " + window.auth_token
                },
                data: JSON.stringify({
                    password: $(el_window).find('.confirm-user-deletion-password').val(),
                }),
                statusCode: {
                    401: function () {
                        window.logout();
                    },
                    400: function(){
                        $(el_window).find('.error-message').html(i18n('incorrect_password'));
                        $(el_window).find('.error-message').show();
                    }
                },
                success: function(data){
                    if(data.success){
                        // mark user as deleted
                        window.user.deleted = true;
                        // log user out
                        window.logout();
                    }
                    else{
                        $(el_window).find('.error-message').html(html_encode(data.error));
                        $(el_window).find('.error-message').show();

                    }
                }
            });
        });
    })
}

export default UIWindowFinalizeUserDeletion;