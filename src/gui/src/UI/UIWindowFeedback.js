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

import UIAlert from './UIAlert.js';
import UIWindow from './UIWindow.js';

async function UIWindowQR(options){
    return new Promise(async (resolve) => {
        options = options ?? {};

        if ( ! window.user.email_confirmed ) {
            await UIAlert({
                message: i18n('contact_us_verification_required'),
            });
            return resolve();
        }

        const h = `
            <div class="feedback-container">
                <div class="feedback-sent-success">
                    <img class="feedback-success-icon" src="${html_encode(window.icons['c-check.svg'])}">
                    <p class="feedback-success-message">${i18n('feedback_sent_confirmation')}</p>
                </div>
                <div class="feedback-form">
                    <p class="feedback-c2a">${i18n('feedback_c2a')}</p>
                    <textarea class="feedback-message"></textarea>
                    <button class="button button-primary send-feedback-btn">${i18n('send')}</button>
                </div>
            </div>
        `;

        const el_window = await UIWindow({
            title: i18n('contact_us'),
            app: 'feedback',
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
                $(this_window).find('.feedback-message').get(0).focus({ preventScroll: true });
            },
            window_class: 'window-feedback',
            body_css: {
                width: 'initial',
                height: '100%',
                'background-color': 'rgb(245 247 249)',
                'backdrop-filter': 'blur(3px)',
            },
        });

        $(el_window).find('.send-feedback-btn').on('click', function(e){
            const message = $(el_window).find('.feedback-message').val();
            if ( message )
            {
                $(this).prop('disabled', true);
            }
            $.ajax({
                url: `${window.api_origin}/contactUs`,
                type: 'POST',
                async: true,
                contentType: 'application/json',
                headers: {
                    'Authorization': `Bearer ${window.auth_token}`,
                },
                data: JSON.stringify({
                    message: message,
                }),
                success: async function(data){
                    $(el_window).find('.feedback-form').hide();
                    $(el_window).find('.feedback-sent-success').show(100);
                },
            });
        });
    });
}

export default UIWindowQR;