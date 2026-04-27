/*
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
import * as SimpleWebAuthn from '@simplewebauthn/browser';

const UIWindowWebAuthnSetup = async function UIWindowWebAuthnSetup () {
    return new Promise(async (resolve) => {
        let is_resolved = false;
        const settle = (value) => {
            if ( is_resolved ) return;
            is_resolved = true;
            resolve(value);
        };
        const close_window = () => {
            const $window = $(el_window);
            if ( typeof $window.close === 'function' ) {
                $window.close();
                return;
            }
            // Fallback in case close animation/handler is interrupted.
            setTimeout(() => {
                if ( document.body.contains(el_window) ) {
                    $(el_window).closest('.window-backdrop').remove();
                    $(el_window).remove();
                }
            }, 500);
        };

        let h = '';
        h += '<div style="padding: 20px;">';

        // Step 1: name + register
        h += '<div class="webauthn-step-1">';
        h += `<h3 style="text-align:center; font-weight:500; font-size:20px; margin-bottom:8px;">${i18n('webauthn_register_title')}</h3>`;
        h += `<p style="text-align:center; color:#3b4863; margin-bottom:16px;">${i18n('webauthn_register_instructions')}</p>`;
        h += `<label style="display:block; margin-bottom:5px; font-weight:500;">${i18n('webauthn_key_name_label')}</label>`;
        h += `<input type="text" class="webauthn-key-name" placeholder="${i18n('webauthn_key_name_placeholder')}" maxlength="64" style="width:100%; box-sizing:border-box; padding:8px; border:1px solid #ccc; border-radius:4px; font-size:14px; margin-bottom:8px;" />`;
        h += '<div class="webauthn-error" style="color:#e74c3c; margin-bottom:8px; display:none;"></div>';
        h += `<button class="button button-primary button-block webauthn-register-btn" style="margin-top:4px;">${i18n('webauthn_register_button')}</button>`;
        h += '</div>';

        // Step 2: success
        h += '<div class="webauthn-step-2" style="display:none; text-align:center; padding:10px 0;">';
        h += '<div style="font-size:48px; color:#27ae60; margin-bottom:12px;">✓</div>';
        h += `<h3 style="font-weight:500; font-size:20px; margin-bottom:8px;">${i18n('webauthn_registered_success_title')}</h3>`;
        h += `<p style="color:#3b4863; margin-bottom:16px;">${i18n('webauthn_registered_success_body')}</p>`;
        h += '<button class="button button-primary button-block webauthn-done-btn">Done</button>';
        h += '</div>';

        h += '</div>';

        const el_window = await UIWindow({
            title: i18n('webauthn_register_title'),
            app: 'webauthn-setup',
            single_instance: true,
            icon: null,
            uid: null,
            is_dir: false,
            body_content: h,
            has_head: true,
            selectable_body: false,
            draggable_body: false,
            allow_context_menu: false,
            is_draggable: true,
            is_droppable: false,
            is_resizable: false,
            stay_on_top: true,
            allow_native_ctxmenu: false,
            allow_user_select: true,
            width: 480,
            dominant: false,
            on_close: () => {
                settle(false); return true;
            },
            window_css: { height: 'initial' },
            body_css: {
                width: 'initial',
                padding: '0',
                'background-color': 'rgb(245 247 249)',
            },
        });

        const $win   = $(el_window);
        const $step1 = $win.find('.webauthn-step-1');
        const $step2 = $win.find('.webauthn-step-2');
        const $error = $win.find('.webauthn-error');
        const $btn   = $win.find('.webauthn-register-btn');

        $win.find('.webauthn-done-btn').on('click', () => {
            settle(true);
            close_window();
        });

        $win.find('.window-close-btn').on('click', () => {
            settle(false);
            close_window();
        });

        $btn.on('click', async function () {
            const key_name = $win.find('.webauthn-key-name').val().trim();
            $error.hide();

            if ( ! key_name ) {
                $error.text(i18n('webauthn_key_name_required')).show();
                return;
            }

            $btn.prop('disabled', true).text('...');

            // 1. Get registration options from server
            let reg_options;
            try {
                const resp = await fetch(`${window.api_origin}/auth/webauthn/register/begin`, {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${puter.authToken}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ page_origin: window.location.origin }),
                });
                reg_options = await resp.json();
                if ( reg_options.error ) throw new Error(reg_options.error);
            } catch (e) {
                console.error('[webauthn] register/begin failed:', e);
                $error.text(e.message || i18n('something_went_wrong')).show();
                $btn.prop('disabled', false).text(i18n('webauthn_register_button'));
                return;
            }

            // 2. Trigger browser passkey/security key dialog
            let credential;
            try {
                const { startRegistration } = SimpleWebAuthn;
                credential = await startRegistration({ optionsJSON: reg_options });
            } catch (e) {
                console.error('[webauthn] startRegistration failed:', e);
                const msg = e.name === 'NotAllowedError'
                    ? i18n('webauthn_cancelled')
                    : (e.message || i18n('something_went_wrong'));
                $error.text(msg).show();
                $btn.prop('disabled', false).text(i18n('webauthn_register_button'));
                return;
            }

            // 3. Send credential to server for verification and storage
            try {
                const resp = await fetch(`${window.api_origin}/auth/webauthn/register/complete`, {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${puter.authToken}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ response: credential, name: key_name, page_origin: window.location.origin }),
                });
                const data = await resp.json();
                if ( ! data.ok ) throw new Error(data.error || 'Verification failed');
            } catch (e) {
                console.error('[webauthn] register/complete failed:', e);
                $error.text(e.message || i18n('something_went_wrong')).show();
                $btn.prop('disabled', false).text(i18n('webauthn_register_button'));
                return;
            }

            // Success
            $step1.hide();
            $step2.show();
        });
    });
};

export default UIWindowWebAuthnSetup;
