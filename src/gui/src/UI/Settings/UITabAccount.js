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

        return `
            <h1 class="settings-section-header">${i18n('account')}</h1>
            <div class="settings-profile-picture-container">
                <div class="profile-picture change-profile-picture" role="button" tabindex="0" aria-label="${i18n('change')} ${i18n('profile_picture')}" style="background-image: url('${html_encode(window.user?.profile?.picture ?? window.icons['profile.svg'])}');"></div>
            </div>
            ${build_settings_card({
                label: i18n('username'),
                description: html_encode(window.user.username),
                control: `<button class="button change-username" aria-label="${i18n('change_username')}">${i18n('change_username')}</button>`,
            })}
            ${emailCard}
            ${passwordCard}
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
