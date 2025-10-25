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
import check_password_strength from '../helpers/check_password_strength.js'

async function UIWindowChangePassword(options){
    options = options ?? {};

    const internal_id = window.uuidv4();
    const h = `
        <div class="change-password settings-form-container">
            <div class="form-error-msg" role="alert" aria-live="polite"></div>
            <div class="form-success-msg" role="alert" aria-live="polite"></div>
            <div class="form-field">
                <label class="form-label" for="current-password-${internal_id}">${i18n('current_password')}</label>
                <input id="current-password-${internal_id}" class="current-password form-input" type="password" name="current-password" autocomplete="current-password" aria-required="true" />
            </div>
            <div class="form-field">
                <label class="form-label" for="new-password-${internal_id}">${i18n('new_password')}</label>
                <input id="new-password-${internal_id}" type="password" class="new-password form-input" name="new-password" autocomplete="new-password" aria-required="true" />
            </div>
            <div class="form-field">
                <label class="form-label" for="confirm-new-password-${internal_id}">${i18n('confirm_new_password')}</label>
                <input id="confirm-new-password-${internal_id}" type="password" name="confirm-new-password" class="confirm-new-password form-input" autocomplete="new-password" aria-required="true" />
            </div>
            <button class="change-password-btn button button-primary button-block button-normal" aria-label="${i18n('change_password')}">${i18n('change_password')}</button>
        </div>
    `;

    const el_window = await UIWindow({
        title: i18n('window_title_change_password'),
        app: 'change-passowrd',
        single_instance: true,
        icon: null,
        uid: null,
        is_dir: false,
        body_content: h,
        has_head: true,
        selectable_body: false,
        draggable_body: false,
        allow_context_menu: false,
        is_resizable: false,
        is_droppable: false,
        init_center: true,
        allow_native_ctxmenu: false,
        allow_user_select: false,
        width: 380,
        height: 'auto',
        dominant: true,
        show_in_taskbar: false,
        onAppend: function(this_window){
            $(this_window).find(`.current-password`).get(0).focus({preventScroll:true});
        },
        window_class: 'window-change-password',
        body_css: {
            width: 'initial',
            height: '100%',
            'background-color': 'rgb(245 247 249)',
            'backdrop-filter': 'blur(3px)',
        },
        ...options.window_options,   
    })

    $(el_window).find('.change-password-btn').on('click', function(e){
        const current_password = $(el_window).find('.current-password').val();
        const new_password = $(el_window).find('.new-password').val();
        const confirm_new_password = $(el_window).find('.confirm-new-password').val();

        // hide messages
        $(el_window).find('.form-error-msg, .form-success-msg').removeClass('visible');

        // check if all fields are filled
        if(!current_password || !new_password || !confirm_new_password){
            $(el_window).find('.form-error-msg').html(i18n('all_fields_required')).addClass('visible');
            return;
        }
        // check if new password and confirm new password are the same
        else if(new_password !== confirm_new_password){
            $(el_window).find('.form-error-msg').html(i18n('passwords_do_not_match')).addClass('visible');
            return;
        }
        // check password strength
        const pass_strength = check_password_strength(new_password);
        if(!pass_strength.overallPass){
            $(el_window).find('.form-error-msg').html(i18n('password_strength_error')).addClass('visible');
            return;
        }

        $.ajax({
            url: window.api_origin + "/user-protected/change-password",
            type: 'POST',
            async: true,
            headers: {
                "Authorization": "Bearer "+window.auth_token
            },
            contentType: "application/json",
            data: JSON.stringify({ 
                password: current_password, 
                new_pass: new_password,
            }),				
            success: function (data){
                $(el_window).find('.form-success-msg').html(i18n('password_changed')).addClass('visible');
                $(el_window).find('input').val('');
            },
            error: function (err){
                $(el_window).find('.form-error-msg').html(html_encode(err.responseText)).addClass('visible');
            }
        });	
    })
}

export default UIWindowChangePassword