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

import UIWindowChangePassword from '../UIWindowChangePassword.js';
import UIWindowChangeEmail from './UIWindowChangeEmail.js';
import UIWindowChangeUsername from '../UIWindowChangeUsername.js';
import UIWindowConfirmUserDeletion from './UIWindowConfirmUserDeletion.js';
import UIWindowManageSessions from './UIWindowManageSessions.js';
import UIWindow from '../UIWindow.js';
import build_settings_card from './helpers/build_settings_card.js';
import TeePromise from '../../util/TeePromise.js';
import UIComponentWindow from '../UIComponentWindow.js';
import UIWindow2FASetup from '../UIWindow2FASetup.js';

export default {
    id: 'account',
    title_i18n_key: 'account',
    icon: 'user.svg',
    html: () => {
        const passwordCard = !window.user.is_temp ? build_settings_card({
            label: i18n('password'),
            control: `<button class="button change-password" aria-label="${i18n('change_password')}">${i18n('change_password')}</button>`,
        }) : '';

        const emailCard = window.user.email ? build_settings_card({
            label: i18n('email'),
            description: `<span class="user-email">${html_encode(window.user.email)}</span>`,
            control: `<button class="button change-email" aria-label="${i18n('change_email')}">${i18n('change_email')}</button>`,
        }) : '';

        const twoFactorEnabled = window.user.otp;
        const twoFactorCard = !window.user.is_temp && window.user.email_confirmed ? build_settings_card({
            label: i18n('two_factor'),
            description: `<span class="user-otp-state">${i18n(twoFactorEnabled ? 'two_factor_enabled' : 'two_factor_disabled')}</span>`,
            variant: twoFactorEnabled ? 'success' : 'warning',
            className: 'settings-card-security',
            control: `
                <button class="button enable-2fa ${twoFactorEnabled ? 'hidden' : ''}" aria-label="${i18n('enable_2fa')}">${i18n('enable_2fa')}</button>
                <button class="button disable-2fa ${twoFactorEnabled ? '' : 'hidden'}" aria-label="${i18n('disable_2fa')}">${i18n('disable_2fa')}</button>
            `,
        }) : '';

        return `
            <h1 class="settings-section-header">${i18n('account')}</h1>
            <div class="settings-profile-picture-container">
                <div class="profile-picture change-profile-picture" role="button" tabindex="0" aria-label="${i18n('change')} ${i18n('picture')}" style="background-image: url('${html_encode(window.user?.profile?.picture ?? window.icons['profile.svg'])}');"></div>
            </div>
            ${passwordCard}
            ${build_settings_card({
                label: i18n('username'),
                description: html_encode(window.user.username),
                control: `<button class="button change-username" aria-label="${i18n('change_username')}">${i18n('change_username')}</button>`,
            })}
            ${emailCard}
            ${build_settings_card({
                label: i18n('sessions'),
                control: `<button class="button manage-sessions" aria-label="${i18n('manage_sessions')}">${i18n('manage_sessions')}</button>`,
            })}
            ${twoFactorCard}
            ${build_settings_card({
                label: i18n('delete_account'),
                variant: 'danger',
                control: `<button class="button button-danger delete-account" aria-label="${i18n('delete_account')}">${i18n('delete_account')}</button>`,
            })}
        `;
    },
    init: ($el_window) => {
        $el_window.find('.change-password').on('click', function(e) {
            UIWindowChangePassword({
                window_options: {
                    parent_uuid: $el_window.attr('data-element_uuid'),
                    disable_parent_window: true,
                    parent_center: true,
                },
            });
        });
        $el_window.find('.change-username').on('click', function(e) {
            UIWindowChangeUsername({
                window_options: {
                    parent_uuid: $el_window.attr('data-element_uuid'),
                    disable_parent_window: true,
                    parent_center: true,
                },
            });
        });
        $el_window.find('.change-email').on('click', function(e) {
            UIWindowChangeEmail({
                window_options: {
                    parent_uuid: $el_window.attr('data-element_uuid'),
                    disable_parent_window: true,
                    parent_center: true,
                },
            });
        });
        $el_window.find('.manage-sessions').on('click', function(e) {
            UIWindowManageSessions({
                window_options: {
                    parent_uuid: $el_window.attr('data-element_uuid'),
                    disable_parent_window: true,
                    parent_center: true,
                },
            });
        });
        $el_window.find('.enable-2fa').on('click', async function(e) {
            const { promise } = await UIWindow2FASetup();
            const tfa_was_enabled = await promise;

            if ( tfa_was_enabled ) {
                $el_window.find('.enable-2fa').addClass('hidden');
                $el_window.find('.disable-2fa').removeClass('hidden');
                $el_window.find('.user-otp-state').text(i18n('two_factor_enabled'));
                $el_window.find('.settings-card-security').removeClass('settings-card-warning');
                $el_window.find('.settings-card-security').addClass('settings-card-success');
            }

            return;
        });

        $el_window.find('.disable-2fa').on('click', async function(e) {
            let win, password_entry;
            const password_confirm_promise = new TeePromise();
            const try_password = async () => {
                const value = password_entry.get('value');
                const resp = await fetch(`${window.api_origin}/user-protected/disable-2fa`, {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${puter.authToken}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        password: value,
                    }),
                });
                if ( resp.status !== 200 ) {
                    /* eslint no-empty: ["error", { "allowEmptyCatch": true }] */
                    let message; try {
                        message = (await resp.json()).message;
                    } catch(e) {
                    }
                    message = message || i18n('error_unknown_cause');
                    password_entry.set('error', message);
                    return;
                }
                password_confirm_promise.resolve(true);
                $(win).close();
            };

            const h = `
                <div class="security-modal-content">
                    <div>
                        <h3 class="security-modal-header">${i18n('disable_2fa_confirm')}</h3>
                        <p class="security-modal-description">${i18n('disable_2fa_instructions')}</p>
                    </div>
                    <div class="security-modal-inputs">
                        <div class="password-input-wrapper">
                            <input type="password" class="password-entry form-input" />
                            <button type="button" class="password-toggle-btn" aria-label="${i18n('toggle_password_visibility')}">
                                <svg class="eye-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                                    <circle cx="12" cy="12" r="3"></circle>
                                </svg>
                            </button>
                        </div>
                        <button class="button confirm-disable-2fa">${i18n('disable_2fa')}</button>
                        <button class="button secondary cancel-disable-2fa">${i18n('cancel')}</button>
                    </div>
                </div>
            `;

            win = await UIComponentWindow({
                html: h,
                width: 500,
                backdrop: true,
                is_resizable: false,
                body_css: {
                    width: 'initial',
                    'background-color': 'rgb(245 247 249)',
                    'backdrop-filter': 'blur(3px)',
                    padding: '20px',
                },
            });

            // Set up event listeners
            const $win = $(win);
            const $password_entry = $win.find('.password-entry');

            // Password toggle button
            $win.on('click', '.password-toggle-btn', function(e){
                e.preventDefault();
                const $input = $(this).siblings('input');
                const type = $input.attr('type');
                $input.attr('type', type === 'password' ? 'text' : 'password');

                const $svg = $(this).find('svg');
                if (type === 'password') {
                    // Show eye-off icon
                    $svg.html(`
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                        <line x1="1" y1="1" x2="23" y2="23"></line>
                    `);
                } else {
                    // Show eye icon
                    $svg.html(`
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                        <circle cx="12" cy="12" r="3"></circle>
                    `);
                }
            });

            $password_entry.on('keypress', (e) => {
                if ( e.which === 13 ) { // Enter key
                    try_password();
                }
            });

            $win.find('.confirm-disable-2fa').on('click', () => {
                try_password();
            });

            $win.find('.cancel-disable-2fa').on('click', () => {
                password_confirm_promise.resolve(false);
                $win.close();
            });

            $password_entry.focus();

            const ok = await password_confirm_promise;
            if ( ! ok ) return;

            $el_window.find('.enable-2fa').removeClass('hidden');
            $el_window.find('.disable-2fa').addClass('hidden');
            $el_window.find('.user-otp-state').text(i18n('two_factor_disabled'));
            $el_window.find('.settings-card-security').removeClass('settings-card-success');
            $el_window.find('.settings-card-security').addClass('settings-card-warning');
        });
        $el_window.find('.delete-account').on('click', function(e) {
            UIWindowConfirmUserDeletion({
                window_options: {
                    parent_uuid: $el_window.attr('data-element_uuid'),
                    disable_parent_window: true,
                    parent_center: true,
                },
            });
        });
        $el_window.find('.change-profile-picture').on('click', async function(e) {
            UIWindow({
                path: `/${window.user.username}/Desktop`,
                parent_uuid: $el_window.attr('data-element_uuid'),
                allowed_file_types: ['.png', '.jpg', '.jpeg'],
                show_maximize_button: false,
                show_minimize_button: false,
                title: 'Open',
                is_dir: true,
                is_openFileDialog: true,
                selectable_body: false,
            });
        });
        $el_window.find('.change-profile-picture').on('keydown', function(e) {
            if(e.key === 'Enter' || e.key === ' '){
                e.preventDefault();
                $(this).trigger('click');
            }
        });
        $el_window.on('file_opened', async function(e){
            let selected_file = Array.isArray(e.detail) ? e.detail[0] : e.detail;
            // set profile picture
            const profile_pic = await puter.fs.read(selected_file.path);
            // blob to base64
            const reader = new FileReader();
            reader.readAsDataURL(profile_pic);
            reader.onloadend = function() {
                // resizes the image to 150x150
                const img = new Image();
                img.src = reader.result;
                img.onload = function() {
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    canvas.width = 150;
                    canvas.height = 150;
                    ctx.drawImage(img, 0, 0, 150, 150);
                    const base64data = canvas.toDataURL('image/png');
                    // update profile picture
                    $el_window.find('.profile-picture').css('background-image', `url(${html_encode(base64data)})`);
                    $('.profile-image').css('background-image', `url(${html_encode(base64data)})`);
                    $('.profile-image').addClass('profile-image-has-picture');
                    // update profile picture
                    update_profile(window.user.username, { picture: base64data });
                };
            };
        });
    },
};
