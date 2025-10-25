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

import UIWindow from '../UIWindow.js'

async function UIWindowFinalizeUserDeletion(options){
    return new Promise(async (resolve) => {
        options = options ?? {};

        const h = window.user.is_temp ? `
            <div class="deletion-dialog-content">
                <div class="generic-close-window-button disable-user-select" role="button" aria-label="${i18n('close')}"> &times; </div>
                <img src="${window.icons['danger.svg']}" class="account-deletion-confirmation-icon" alt="${i18n('warning')}" role="img">
                <p class="account-deletion-confirmation-prompt">${i18n('type_confirm_to_delete_account')}</p>
                <div class="form-error-msg" role="alert" aria-live="polite"></div>
                <input type="text" class="confirm-temporary-user-deletion form-input" placeholder="${i18n('type_confirm_to_delete_account')}" aria-label="${i18n('type_confirm_to_delete_account')}" aria-required="true">
                <button class="button button-block button-danger proceed-with-user-deletion" aria-label="${i18n('delete_account')}">${i18n('delete_account')}</button>
                <button class="button button-block button-secondary cancel-user-deletion" aria-label="${i18n('cancel')}">${i18n('cancel')}</button>
            </div>
        ` : `
            <div class="deletion-dialog-content">
                <div class="generic-close-window-button disable-user-select" role="button" aria-label="${i18n('close')}"> &times; </div>
                <img src="${window.icons['danger.svg']}" class="account-deletion-confirmation-icon" alt="${i18n('warning')}" role="img">
                <p class="account-deletion-confirmation-prompt">${i18n('enter_password_to_confirm_delete_user')}</p>
                <div class="form-error-msg" role="alert" aria-live="polite"></div>
                <input type="password" class="confirm-user-deletion-password form-input" placeholder="${i18n('current_password')}" aria-label="${i18n('current_password')}" aria-required="true">
                <button class="button button-block button-danger proceed-with-user-deletion" aria-label="${i18n('delete_account')}">${i18n('delete_account')}</button>
                <button class="button button-block button-secondary cancel-user-deletion" aria-label="${i18n('cancel')}">${i18n('cancel')}</button>
            </div>
        `;

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
            $(el_window).find('.form-error-msg').removeClass('visible');

            if(window.user.is_temp){
                const confirm = $(el_window).find('.confirm-temporary-user-deletion').val().toLowerCase();

                if(confirm !== 'confirm' && confirm !== i18n('confirm').toLowerCase()){
                    $(el_window).find('.form-error-msg').html(i18n('type_confirm_to_delete_account')).addClass('visible');
                    return;
                }
            }
            else{
                if($(el_window).find('.confirm-user-deletion-password').val() === ''){
                    $(el_window).find('.form-error-msg').html(i18n('all_fields_required')).addClass('visible');
                    return;
                }
            }

            $(el_window).find('.proceed-with-user-deletion').addClass('loading');

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
                        $(el_window).find('.proceed-with-user-deletion').removeClass('loading');
                        $(el_window).find('.form-error-msg').html(i18n('incorrect_password')).addClass('visible');
                    }
                },
                success: function(data){
                    if(data.success){
                        window.user.deleted = true;
                        window.logout();
                    }
                    else{
                        $(el_window).find('.proceed-with-user-deletion').removeClass('loading');
                        $(el_window).find('.form-error-msg').html(html_encode(data.error)).addClass('visible');
                    }
                }
            });
        });
    })
}

export default UIWindowFinalizeUserDeletion;