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
import update_username_in_gui from '../helpers/update_username_in_gui.js'

async function UIWindowChangeUsername(options){
    options = options ?? {};

    const internal_id = window.uuidv4();
    const h = `
        <div class="change-username settings-form-container">
            <div class="form-error-msg" role="alert" aria-live="polite"></div>
            <div class="form-success-msg" role="alert" aria-live="polite"></div>
            <div class="form-field">
                <label class="form-label" for="confirm-new-username-${internal_id}">${i18n('new_username')}</label>
                <input id="confirm-new-username-${internal_id}" type="text" name="new-username" class="new-username form-input" autocomplete="off" aria-required="true" />
            </div>
            <button class="change-username-btn button button-primary button-block button-normal" aria-label="${i18n('change_username')}">${i18n('change_username')}</button>
        </div>
    `;

    const el_window = await UIWindow({
        title: i18n('change_username'),
        app: 'change-username',
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
            $(this_window).find(`.new-username`).get(0)?.focus({preventScroll:true});
        },
        window_class: 'window-change-username',
        body_css: {
            width: 'initial',
            height: '100%',
            'background-color': 'rgb(245 247 249)',
            'backdrop-filter': 'blur(3px)',
        },
        ...options.window_options,
    })

    $(el_window).find('.change-username-btn').on('click', function(e){
        $(el_window).find('.form-error-msg, .form-success-msg').removeClass('visible');

        const new_username = $(el_window).find('.new-username').val();

        if(!new_username){
            $(el_window).find('.form-error-msg').html(i18n('all_fields_required')).addClass('visible');
            return;
        }

        $(el_window).find('.change-username-btn').addClass('loading');
        $(el_window).find('.new-username').attr('disabled', true);

        $.ajax({
            url: window.api_origin + "/change_username",
            type: 'POST',
            async: true,
            headers: {
                "Authorization": "Bearer "+window.auth_token
            },
            contentType: "application/json",
            data: JSON.stringify({
                new_username: new_username,
            }),
            success: function (data){
                $(el_window).find('.change-username-btn').removeClass('loading');
                $(el_window).find('.form-success-msg').html(i18n('username_changed')).addClass('visible');
                $(el_window).find('input').val('');
                update_username_in_gui(new_username);
                window.user.username = new_username;
                $(el_window).find('.new-username').attr('disabled', false);
            },
            error: function (err){
                $(el_window).find('.change-username-btn').removeClass('loading');
                $(el_window).find('.form-error-msg').html(html_encode(err.responseJSON?.message)).addClass('visible');
                $(el_window).find('.new-username').attr('disabled', false);
            }
        });
    })
}

export default UIWindowChangeUsername