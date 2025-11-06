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

import Placeholder from '../../util/Placeholder.js';
import PasswordEntry from '../Components/PasswordEntry.js';
import UIWindow from '../UIWindow.js'

// TODO: DRY: We could specify a validator and endpoint instead of writing
// a DOM tree and event handlers for each of these. (low priority)
async function UIWindowChangeEmail(options){
    options = options ?? {};

    const password_entry = new PasswordEntry({});
    const place_password_entry = Placeholder();

    const internal_id = window.uuidv4();
    let h = '';
    h += `<div class="change-email" style="padding: 20px; border-bottom: 1px solid #ced7e1;">`;
        // error msg
        h += `<div class="form-error-msg"></div>`;
        // success msg
        h += `<div class="form-success-msg"></div>`;
        // new email
        h += `<div style="overflow: hidden; margin-top: 10px; margin-bottom: 30px;">`;
            h += `<label for="confirm-new-email-${internal_id}">${i18n('new_email')}</label>`;
            h += `<input id="confirm-new-email-${internal_id}" type="text" name="new-email" class="new-email" autocomplete="off" />`;
        h += `</div>`;
        // password confirmation
        h += `<div style="overflow: hidden; margin-top: 10px; margin-bottom: 30px;">`;
            h += `<label>${i18n('account_password')}</label>`;
            h += `${place_password_entry.html}`;
        h += `</div>`;

        // Change Email
        h += `<button class="change-email-btn button button-primary button-block button-normal">${i18n('change_email')}</button>`;
    h += `</div>`;

    const el_window = await UIWindow({
        title: i18n('change_email'),
        app: 'change-email',
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
            $(this_window).find(`.new-email`).get(0)?.focus({preventScroll:true});
        },
        window_class: 'window-publishWebsite',
        body_css: {
            width: 'initial',
            height: '100%',
            'background-color': 'rgb(245 247 249)',
            'backdrop-filter': 'blur(3px)',
        },    
        ...options.window_options
    })

    password_entry.attach(place_password_entry);

    $(el_window).find('.change-email-btn').on('click', function(e){
        // hide previous error/success msg
        $(el_window).find('.form-success-msg, .form-success-msg').hide();

        const new_email = $(el_window).find('.new-email').val();
        const password = $(el_window).find('.password').val();

        if(!new_email){
            $(el_window).find('.form-error-msg').html(i18n('all_fields_required'));
            $(el_window).find('.form-error-msg').fadeIn();
            return;
        }

        $(el_window).find('.form-error-msg').hide();

        // disable button
        $(el_window).find('.change-email-btn').addClass('disabled');
        // disable input
        $(el_window).find('.new-email').attr('disabled', true);
    
        $.ajax({
            url: window.api_origin + "/user-protected/change-email",
            type: 'POST',
            async: true,
            headers: {
                "Authorization": "Bearer "+window.auth_token
            },
            contentType: "application/json",
            data: JSON.stringify({ 
                new_email: new_email, 
                password: password_entry.get('value'),
            }),				
            success: function (data){
                $(el_window).find('.form-success-msg').html(i18n('email_change_confirmation_sent'));
                $(el_window).find('.form-success-msg').fadeIn();
                $(el_window).find('input').val('');
                // update email
                window.user.email = new_email;
                // enable button
                $(el_window).find('.change-email-btn').removeClass('disabled');
                // enable input
                $(el_window).find('.new-email').attr('disabled', false);
            },
            error: function (err){
                $(el_window).find('.form-error-msg').html(html_encode(err.responseJSON?.message));
                $(el_window).find('.form-error-msg').fadeIn();
                // enable button
                $(el_window).find('.change-email-btn').removeClass('disabled');
                // enable input
                $(el_window).find('.new-email').attr('disabled', false);
            }
        });	
    })
}

export default UIWindowChangeEmail