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
import UIWindowManageSessions from './UIWindowManageSessions.js';
import create_access_token from '../helpers/create_access_token.js';

// Creates a named, revocable full-API-access token and shows it once.
// Replaces the old "copy your raw GUI/session token" behaviour: the copied
// token used to be a session-equivalent credential that could escalate to
// full account control; the minted access token can use the whole API but is
// locked out of account management (see create_access_token.js).
function UIWindowCopyToken (options = {}) {
    return new Promise(async (resolve) => {
        let h = '';

        if ( options.show_header ) {
            h += `<div style="
                display: flex;
                flex-direction: column;
                align-items: center;
                padding: 30px 20px 20px;
                background: #1854b6;
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
            h += `<h2 style="margin: 0; font-size: 17px; font-weight: 600; color: white;">${i18n('create_api_token')}</h2>`;
            h += `<p style="margin: 6px 0 0; font-size: 13px; color: rgba(255,255,255,0.8); text-align: center; line-height: 1.4;">${i18n('create_token_message')}</p>`;
            h += '</div>';
        }

        h += '<div class="copy-token" style="padding: 20px; border-bottom: 1px solid #ced7e1;">';
        if ( options.show_close_button ) {
            h += '<div class="qr-code-window-close-btn generic-close-window-button"> &times; </div>';
        }

        // -- Phase A: create form --
        h += '<div class="create-token-form">';
        if ( ! options.show_header ) {
            h += `<div class="form-label" style="margin-bottom: 12px; font-size: 13px; color: #666;">${i18n('create_token_message')}</div>`;
        }
        h += '<div class="form-error-msg" style="display:none; margin-bottom: 12px;"></div>';
        h += `<label class="form-label" style="font-size: 13px;" for="token-label-input">${i18n('token_label')}</label>`;
        h += `<input id="token-label-input" type="text" class="token-label-input" maxlength="64" autocomplete="off" placeholder="${i18n('token_label_placeholder')}" style="width: 100%; box-sizing: border-box; margin: 5px 0 15px;" />`;
        h += `<label class="form-label" style="font-size: 13px;" for="token-expiry-select">${i18n('token_expiry')}</label>`;
        h += `<select id="token-expiry-select" class="token-expiry-select" style="width: 100%; box-sizing: border-box; margin: 5px 0 15px;">`;
        h += `<option value="">${i18n('token_expiry_never')}</option>`;
        h += `<option value="7d">${i18n('token_expiry_7d')}</option>`;
        h += `<option value="30d">${i18n('token_expiry_30d')}</option>`;
        h += `<option value="90d">${i18n('token_expiry_90d')}</option>`;
        h += '</select>';
        h += `<button class="button button-primary button-block create-token-btn">${i18n('create_token')}</button>`;
        h += '</div>';

        // -- Phase B: result (shown once, after mint) --
        h += '<div class="token-result" style="display:none;">';
        h += `<div class="token-result-warning" style="margin-bottom: 12px; font-size: 13px; color: #b54708; background: #fffaeb; border: 1px solid #fedf89; border-radius: 6px; padding: 10px;">${i18n('token_shown_once_warning')}</div>`;
        h += '<div style="display: flex; gap: 8px; margin-bottom: 12px;">';
        h += '<input type="text" class="token-input" readonly value="" style="flex: 1; font-family: monospace; font-size: 13px;" />';
        h += `<button class="button button-primary copy-token-btn">${i18n('copy')}</button>`;
        h += '</div>';
        h += `<div class="token-copied-msg form-success-msg" style="display: none; text-align: center; margin-bottom: 8px;">${i18n('token_copied')}</div>`;
        h += `<div style="font-size: 12px; color: #666;">${i18n('token_manage_hint')} <a href="#" class="token-manage-sessions-link">${i18n('ui_manage_sessions')}</a>.</div>`;
        h += '</div>';

        h += '</div>';

        const el_window = await UIWindow({
            title: i18n('create_api_token'),
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
            window_class: 'window-copy-auth-token',
            body_css: {
                width: 'initial',
                height: '100%',
                padding: '0',
                'background-color': 'rgb(245 247 249)',
                'backdrop-filter': 'blur(3px)',
            },
            ...options.window_options,
        });

        const $win = $(el_window);

        const showError = (msg) => {
            $win.find('.form-error-msg').text(msg).show();
        };

        const doCreate = async (label) => {
            const $btn = $win.find('.create-token-btn');
            const expiresIn = $win.find('.token-expiry-select').val() || null;
            $win.find('.form-error-msg').hide();
            $btn.addClass('disabled').prop('disabled', true);
            try {
                const token = await create_access_token({ label, expiresIn });
                $win.find('.create-token-form').hide();
                $win.find('.token-input').val(token);
                $win.find('.token-result').show();
            } catch ( e ) {
                showError(e?.message ?? String(e));
                $btn.removeClass('disabled').prop('disabled', false);
            }
        };

        $win.find('.create-token-btn').on('click', function () {
            const label = ($win.find('.token-label-input').val() || '').trim();
            if ( ! label ) {
                showError(i18n('token_label_required'));
                $win.find('.token-label-input').focus();
                return;
            }
            doCreate(label);
        });

        // Enter in the label field submits.
        $win.find('.token-label-input').on('keydown', function (e) {
            if ( e.key === 'Enter' ) {
                e.preventDefault();
                $win.find('.create-token-btn').trigger('click');
            }
        });

        $win.find('.copy-token-btn').on('click', function () {
            const $btn = $(this);
            navigator.clipboard.writeText($win.find('.token-input').val()).then(() => {
                $win.find('.token-copied-msg').fadeIn();
                $btn.text(i18n('token_copied'));
                setTimeout(() => {
                    $win.find('.token-copied-msg').fadeOut();
                    $btn.text(i18n('copy'));
                }, 2000);
            });
        });

        $win.find('.token-manage-sessions-link').on('click', function (e) {
            e.preventDefault();
            UIWindowManageSessions({
                window_options: {
                    parent_uuid: $win.attr('data-element_uuid'),
                    backdrop: true,
                    close_on_backdrop_click: true,
                    stay_on_top: true,
                },
            });
        });

        $win.on('close', () => {
            resolve();
        });
    });
}

def(UIWindowCopyToken, 'ui.window.UIWindowCopyToken');

export default UIWindowCopyToken;
