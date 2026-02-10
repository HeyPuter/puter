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

import UIWindow from './UIWindow.js';

function UIWindowCopyToken (options = {}) {
    return new Promise(async (resolve) => {
        let h = '';

        if ( options.show_header ) {
            h += `<div style="
                display: flex;
                flex-direction: column;
                align-items: center;
                padding: 30px 20px 20px;
                background: linear-gradient(135deg, #3b82f6 0%, #6366f1 100%);
                border-bottom: 1px solid #ced7e1;
            ">`;
            h += `<div style="
                    width: 60px;
                    height: 60px;
                    background: rgba(255,255,255,0.2);
                    border-radius: 16px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    margin-bottom: 14px;
                ">`;
            h += `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>
                    </svg>`;
            h += '</div>';
            h += `<h2 style="margin: 0; font-size: 17px; font-weight: 600; color: white;">${i18n('auth_token')}</h2>`;
            h += `<p style="margin: 6px 0 0; font-size: 13px; color: rgba(255,255,255,0.8); text-align: center; line-height: 1.4;">${i18n('copy_token_message')}</p>`;
            h += '</div>';
        }

        h += '<div class="copy-token" style="padding: 20px; border-bottom: 1px solid #ced7e1;">';
        if ( ! options.show_header ) {
            h += `<div class="form-label" style="margin-bottom: 5px; font-size: 13px; color: #666;">${i18n('copy_token_message')}</div>`;
        }
        h += `<div style="display: flex; gap: 8px; margin-top: ${options.show_header ? '0' : '15'}px; margin-bottom: 15px;">`;
        h += `<input type="text" class="token-input" readonly value="${html_encode(window.auth_token)}" style="flex: 1; font-family: monospace; font-size: 13px;" />`;
        h += `<button class="button button-primary copy-token-btn">${i18n('copy')}</button>`;
        h += '</div>';
        h += '<div class="token-copied-msg form-success-msg" style="display: none; text-align: center;">';
        h += i18n('token_copied');
        h += '</div>';
        h += '</div>';

        const el_window = await UIWindow({
            title: i18n('auth_token'),
            app: 'copy-token',
            single_instance: true,
            icon: null,
            uid: null,
            is_dir: false,
            body_content: h,
            has_head: !options.show_header,
            selectable_body: false,
            draggable_body: options.show_header,
            allow_context_menu: false,
            is_resizable: false,
            is_droppable: false,
            init_center: true,
            allow_native_ctxmenu: false,
            allow_user_select: false,
            width: 450,
            height: 'auto',
            dominant: true,
            show_in_taskbar: false,
            window_class: 'window-publishWebsite',
            body_css: {
                width: 'initial',
                height: '100%',
                padding: '0',
                'background-color': 'rgb(245 247 249)',
                'backdrop-filter': 'blur(3px)',
            },
            ...options.window_options,
        });

        $(el_window).find('.copy-token-btn').on('click', function () {
            const $btn = $(this);
            navigator.clipboard.writeText(window.auth_token).then(() => {
                $(el_window).find('.token-copied-msg').fadeIn();
                $btn.text(i18n('token_copied'));
                setTimeout(() => {
                    $(el_window).find('.token-copied-msg').fadeOut();
                    $btn.text(i18n('copy'));
                }, 2000);
            });
        });

        $(el_window).on('close', () => {
            resolve();
        });
    });
}

def(UIWindowCopyToken, 'ui.window.UIWindowCopyToken');

export default UIWindowCopyToken;
