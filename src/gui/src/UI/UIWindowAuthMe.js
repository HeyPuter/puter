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

/**
 * UIWindowAuthMe - Authorization dialog for redirecting with auth token
 *
 * Shows a security-focused dialog asking the user to approve redirecting
 * to a third-party URL with their authentication token.
 *
 * @param {Object} options
 * @param {string} options.redirect_url - The URL to redirect to after approval
 * @returns {Promise<boolean>} - Resolves to true if approved, false if cancelled
 */
async function UIWindowAuthMe (options = {}) {
    return new Promise(async (resolve) => {
        const redirectURL = options.redirect_url;

        // Parse the URL to show domain prominently
        let urlDisplay;
        let urlHostname;
        try {
            const parsed = new URL(redirectURL);
            urlHostname = parsed.hostname;
            urlDisplay = parsed.origin + parsed.pathname;
            if ( urlDisplay.length > 60 ) {
                urlDisplay = `${urlDisplay.substring(0, 57) }...`;
            }
        } catch ( e ) {
            urlHostname = redirectURL;
            urlDisplay = redirectURL;
        }

        let h = '';

        // Header with icon
        h += `<div style="
            display: flex;
            flex-direction: column;
            align-items: center;
            padding: 30px 20px 20px;
            background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
            border-bottom: 1px solid #ced7e1;
        ">`;

        // Shield/Key icon for authorization
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
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            <path d="M9 12l2 2 4-4"/>
        </svg>`;
        h += '</div>';

        h += `<h2 style="margin: 0; font-size: 17px; font-weight: 600; color: white;">${i18n('authorization_required')}</h2>`;
        h += `<p style="margin: 6px 0 0; font-size: 13px; color: rgba(255,255,255,0.85); text-align: center; line-height: 1.4;">${i18n('external_site_auth_request')}</p>`;
        h += '</div>';

        // Content area
        h += '<div style="padding: 20px;">';

        // Info message
        h += `<div style="
            background: #f0f9ff;
            border: 1px solid #bae6fd;
            border-radius: 8px;
            padding: 12px 14px;
            margin-bottom: 16px;
        ">`;
        h += '<div style="display: flex; align-items: flex-start; gap: 10px;">';
        h += `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0284c7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0; margin-top: 1px;">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="16" x2="12" y2="12"/>
            <line x1="12" y1="8" x2="12.01" y2="8"/>
        </svg>`;
        h += `<p style="margin: 0; font-size: 13px; color: #0369a1; line-height: 1.5;">${i18n('authme_security_warning')}</p>`;
        h += '</div>';
        h += '</div>';

        // Destination URL display
        h += '<div style="margin-bottom: 16px;">';
        h += `<label style="display: block; font-size: 12px; font-weight: 500; color: #6b7280; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px;">${i18n('redirect_destination')}</label>`;
        h += `<div style="
            background: #f3f4f6;
            border: 1px solid #e5e7eb;
            border-radius: 8px;
            padding: 12px 14px;
            font-family: monospace;
            font-size: 13px;
            color: #374151;
            word-break: break-all;
            line-height: 1.4;
        ">`;
        h += `<strong style="color: #1f2937;">${html_encode(urlHostname)}</strong>`;
        h += `<div style="font-size: 12px; color: #6b7280; margin-top: 4px;">${html_encode(urlDisplay)}</div>`;
        h += '</div>';
        h += '</div>';

        // What will be shared
        h += `<div style="
            background: #f9fafb;
            border: 1px solid #e5e7eb;
            border-radius: 8px;
            padding: 12px 14px;
            margin-bottom: 20px;
        ">`;
        h += `<p style="margin: 0 0 8px; font-size: 12px; font-weight: 500; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">${i18n('will_be_shared')}</p>`;
        h += '<div style="display: flex; align-items: center; gap: 8px;">';
        h += `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6b7280" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>
        </svg>`;
        h += `<span style="font-size: 13px; color: #374151;">${i18n('your_auth_token')}</span>`;
        h += '</div>';
        h += '</div>';

        // Buttons
        h += '<div style="display: flex; gap: 10px;">';
        h += `<button type="button" class="authme-cancel button button-default" style="flex: 1;">${i18n('cancel')}</button>`;
        h += `<button type="button" class="authme-approve button button-primary" style="flex: 1;">${i18n('approve')}</button>`;
        h += '</div>';

        h += '</div>';

        const el_window = await UIWindow({
            title: i18n('authorization_required'),
            app: 'authme-dialog',
            single_instance: true,
            icon: null,
            uid: null,
            is_dir: false,
            body_content: h,
            has_head: false,
            selectable_body: false,
            draggable_body: false,
            allow_context_menu: false,
            is_resizable: false,
            is_droppable: false,
            init_center: true,
            allow_native_ctxmenu: false,
            allow_user_select: false,
            width: 400,
            height: 'auto',
            dominant: true,
            show_in_taskbar: false,
            window_class: 'window-authme',
            body_css: {
                width: 'initial',
                height: '100%',
                padding: '0',
                'background-color': 'rgb(255 255 255)',
                'backdrop-filter': 'blur(3px)',
            },
            ...options.window_options,
        });

        $(el_window).find('.authme-approve').on('click', function () {
            $(this).addClass('disabled');
            $(el_window).close();
            resolve(true);
        });

        $(el_window).find('.authme-cancel').on('click', function () {
            $(this).addClass('disabled');
            $(el_window).close();
            resolve(false);
        });

        $(el_window).on('close', () => {
            resolve(false);
        });
    });
}

def(UIWindowAuthMe, 'ui.window.UIWindowAuthMe');

export default UIWindowAuthMe;
