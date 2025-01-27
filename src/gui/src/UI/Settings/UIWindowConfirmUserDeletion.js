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
import UIWindowFinalizeUserDeletion from './UIWindowFinalizeUserDeletion.js'

async function UIWindowConfirmUserDeletion(options){
    return new Promise(async (resolve) => {
        options = options ?? {};

        let h = '';
        h += `<div style="padding: 20px;">`;
            h += `<div class="generic-close-window-button disable-user-select"> &times; </div>`;
            h += `<img src="${window.icons['danger.svg']}" class="account-deletion-confirmation-icon">`;
            h += `<p class="account-deletion-confirmation-prompt">${i18n('confirm_delete_user')}</p>`;
            h += `<button class="button button-block button-danger proceed-with-user-deletion">${i18n('proceed_with_account_deletion')}</button>`;
            h += `<button class="button button-block button-secondary cancel-user-deletion">${i18n('cancel')}</button>`;
        h += `</div>`;

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
            dominant: true,
            window_css: {
                height: 'initial',
                padding: '0',
                border: 'none',
                boxShadow: '0 0 10px rgba(0,0,0,.2)',
                borderRadius: '5px',
                backgroundColor: 'white',
                color: 'black',
            },
            ...options.window_options,
        });

        $(el_window).find('.generic-close-window-button').on('click', function(){
            $(el_window).close();
        });

        $(el_window).find('.cancel-user-deletion').on('click', function(){
            $(el_window).close();
        });

        $(el_window).find('.proceed-with-user-deletion').on('click', function(){
            UIWindowFinalizeUserDeletion();
            $(el_window).close();
        });
    })
}

export default UIWindowConfirmUserDeletion;