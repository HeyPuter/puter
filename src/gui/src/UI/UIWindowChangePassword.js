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
    let h = '';
    h += `<div class="change-password" style="padding: 20px; border-bottom: 1px solid #ced7e1;">`;
        // error msg
        h += `<div class="form-error-msg"></div>`;
        // success msg
        h += `<div class="form-success-msg"></div>`;
        // current password
        h += `<div style="overflow: hidden; margin-bottom: 20px;">`;
            h += `<label for="current-password-${internal_id}">${i18n('current_password')}</label>`;
            h += `<input id="current-password-${internal_id}" class="current-password" type="password" name="current-password" autocomplete="current-password" />`;
        h += `</div>`;
        // new password
        h += `<div style="overflow: hidden; margin-top: 20px; margin-bottom: 20px;">`;
            h += `<label for="new-password-${internal_id}">${i18n('new_password')}</label>`;
            h += `<input id="new-password-${internal_id}" type="password" class="new-password" name="new-password" autocomplete="off" />`;
        h += `</div>`;
        // confirm new password
        h += `<div style="overflow: hidden; margin-top: 20px; margin-bottom: 20px;">`;
            h += `<label for="confirm-new-password-${internal_id}">${i18n('confirm_new_password')}</label>`;
            h += `<input id="confirm-new-password-${internal_id}" type="password" name="confirm-new-password" class="confirm-new-password" autocomplete="off" />`;
        h += `</div>`;

        // Change Password
        h += `<button class="change-password-btn button button-primary button-block button-normal">${i18n('change_password')}</button>`;
    h += `</div>`;

    const el_window = await UIWindow({
        title: 'Change Password',
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
        width: 350,
        height: 'auto',
        dominant: true,
        show_in_taskbar: false,
        onAppend: function(this_window){
            $(this_window).find(`.current-password`).get(0).focus({preventScroll:true});
        },
        window_class: 'window-publishWebsite',
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

        // hide success message
        $(el_window).find('.form-success-msg').hide();

        // check if all fields are filled
        if(!current_password || !new_password || !confirm_new_password){
            $(el_window).find('.form-error-msg').html('All fields are required.');
            $(el_window).find('.form-error-msg').fadeIn();
            return;
        }
        // check if new password and confirm new password are the same
        else if(new_password !== confirm_new_password){
            $(el_window).find('.form-error-msg').html(i18n('passwords_do_not_match'));
            $(el_window).find('.form-error-msg').fadeIn();
            return;
        }
        // check password strength
        const pass_strength = check_password_strength(new_password);
        if(!pass_strength.overallPass){
            $(el_window).find('.form-error-msg').html(i18n('password_strength_error'));
            $(el_window).find('.form-error-msg').fadeIn();
            return;
        }

        $(el_window).find('.form-error-msg').hide();

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
                $(el_window).find('.form-success-msg').html(i18n('password_changed'));
                $(el_window).find('.form-success-msg').fadeIn();
                $(el_window).find('input').val('');
            },
            error: function (err){
                $(el_window).find('.form-error-msg').html(html_encode(err.responseText));
                $(el_window).find('.form-error-msg').fadeIn();
            }
        });	
    })
}

export default UIWindowChangePassword