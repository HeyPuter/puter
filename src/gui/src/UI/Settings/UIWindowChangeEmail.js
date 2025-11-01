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
import UIWindow from '../UIWindow.js';

// TODO: DRY: We could specify a validator and endpoint instead of writing
// a DOM tree and event handlers for each of these. (low priority)
async function UIWindowChangeEmail(options){
    options = options ?? {};

    const password_entry = new PasswordEntry({});
    const place_password_entry = Placeholder();

    const internal_id = window.uuidv4();
    const h = `
        <div class="change-email settings-form-container">
            <div class="form-error-msg" role="alert" aria-live="polite"></div>
            <div class="form-success-msg" role="alert" aria-live="polite"></div>
            <div class="form-field">
                <label class="form-label" for="confirm-new-email-${internal_id}">${i18n('new_email')}</label>
                <input id="confirm-new-email-${internal_id}" type="text" name="new-email" class="new-email form-input" autocomplete="off" aria-required="true" />
            </div>
            <div class="form-field">
                <label class="form-label">${i18n('account_password')}</label>
                ${place_password_entry.html}
            </div>
            <button class="change-email-btn button button-primary button-block button-normal" aria-label="${i18n('change_email')}">${i18n('change_email')}</button>
        </div>
    `;

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
        width: 380,
        height: 'auto',
        dominant: true,
        show_in_taskbar: false,
        onAppend: function(this_window){
            $(this_window).find('.new-email').get(0)?.focus({ preventScroll: true });
        },
        window_class: 'window-change-email',
        body_css: {
            width: 'initial',
            height: '100%',
            'background-color': 'rgb(245 247 249)',
            'backdrop-filter': 'blur(3px)',
        },
        ...options.window_options,
    });

    password_entry.attach(place_password_entry);

    $(el_window).find('.change-email-btn').on('click', function(e){
        $(el_window).find('.form-error-msg, .form-success-msg').removeClass('visible');

        const new_email = $(el_window).find('.new-email').val();

        if ( !new_email ){
            $(el_window).find('.form-error-msg').html(i18n('all_fields_required')).addClass('visible');
            return;
        }

        $(el_window).find('.change-email-btn').addClass('loading');
        $(el_window).find('.new-email').attr('disabled', true);

        $.ajax({
            url: `${window.api_origin}/user-protected/change-email`,
            type: 'POST',
            async: true,
            headers: {
                'Authorization': `Bearer ${window.auth_token}`,
            },
            contentType: 'application/json',
            data: JSON.stringify({
                new_email: new_email,
                password: password_entry.get('value'),
            }),
            success: function(data){
                $(el_window).find('.change-email-btn').removeClass('loading');
                $(el_window).find('.form-success-msg').html(i18n('email_change_confirmation_sent')).addClass('visible');
                $(el_window).find('input').val('');
                window.user.email = new_email;
                $(el_window).find('.new-email').attr('disabled', false);
            },
            error: function(err){
                $(el_window).find('.change-email-btn').removeClass('loading');
                $(el_window).find('.form-error-msg').html(html_encode(err.responseJSON?.message)).addClass('visible');
                $(el_window).find('.new-email').attr('disabled', false);
            },
        });
    });
}

export default UIWindowChangeEmail;