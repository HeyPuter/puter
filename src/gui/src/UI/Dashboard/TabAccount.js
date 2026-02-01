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
import UIWindowChangeEmail from '../Settings/UIWindowChangeEmail.js';
import UIWindowChangeUsername from '../UIWindowChangeUsername.js';
import UIWindowConfirmUserDeletion from '../Settings/UIWindowConfirmUserDeletion.js';
import UIWindowCopyToken from '../UIWindowCopyToken.js';
import UIWindow from '../UIWindow.js';

const TabAccount = {
    id: 'account',
    label: i18n('account'),
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',

    html () {
        let h = '';
        h += '<div class="dashboard-tab-content">';

        // Profile section header
        h += '<div class="dashboard-section-header">';
        h += `<h2>${ i18n('account') }</h2>`;
        h += '<p>Manage your account settings and profile</p>';
        h += '</div>';

        // Profile picture card
        h += '<div class="dashboard-card dashboard-profile-card">';
        h += '<div class="dashboard-profile-picture-section">';
        h += `<div class="profile-picture change-profile-picture dashboard-profile-avatar profile-pic" style="background-image: url('${html_encode(window.user?.profile?.picture ?? window.icons['profile.svg'])}');">`;
        h += '</div>';
        h += '<div class="dashboard-profile-info">';
        h += `<h3>${html_encode(window.user?.username || 'User')}</h3>`;
        h += `<p>${html_encode(window.user?.email || '')}</p>`;
        h += '<span class="dashboard-profile-hint">Click the avatar to change your profile picture</span>';
        h += '</div>';
        h += '</div>';
        h += '</div>';

        // Account settings cards
        h += '<div class="dashboard-settings-grid">';

        // Username card
        h += '<div class="dashboard-card dashboard-settings-card">';
        h += '<div class="dashboard-settings-card-content">';
        h += '<div class="dashboard-settings-card-icon">';
        h += '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
        h += '</div>';
        h += '<div class="dashboard-settings-card-info">';
        h += `<strong>${i18n('username')}</strong>`;
        h += `<span class="username">${html_encode(window.user.username)}</span>`;
        h += '</div>';
        h += '</div>';
        h += `<button class="button change-username">${i18n('change_username')}</button>`;
        h += '</div>';

        // Password card (only for non-temp users)
        if ( ! window.user.is_temp ) {
            h += '<div class="dashboard-card dashboard-settings-card">';
            h += '<div class="dashboard-settings-card-content">';
            h += '<div class="dashboard-settings-card-icon">';
            h += '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';
            h += '</div>';
            h += '<div class="dashboard-settings-card-info">';
            h += `<strong>${i18n('password')}</strong>`;
            h += '<span>••••••••</span>';
            h += '</div>';
            h += '</div>';
            h += `<button class="button change-password">${i18n('change_password')}</button>`;
            h += '</div>';
        }

        // Email card (only if email exists)
        if ( window.user.email ) {
            h += '<div class="dashboard-card dashboard-settings-card">';
            h += '<div class="dashboard-settings-card-content">';
            h += '<div class="dashboard-settings-card-icon">';
            h += '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>';
            h += '</div>';
            h += '<div class="dashboard-settings-card-info">';
            h += `<strong>${i18n('email')}</strong>`;
            h += `<span class="user-email">${html_encode(window.user.email)}</span>`;
            h += '</div>';
            h += '</div>';
            h += `<button class="button change-email">${i18n('change_email')}</button>`;
            h += '</div>';
        }

        // Auth token card
        h += '<div class="dashboard-card dashboard-settings-card">';
        h += '<div class="dashboard-settings-card-content">';
        h += '<div class="dashboard-settings-card-icon">';
        h += '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>';
        h += '</div>';
        h += '<div class="dashboard-settings-card-info">';
        h += `<strong>${i18n('auth_token')}</strong>`;
        h += `<span>${i18n('copy_token_description')}</span>`;
        h += '</div>';
        h += '</div>';
        h += `<button class="button copy-auth-token">${i18n('copy') || 'Copy'}</button>`;
        h += '</div>';

        // Danger zone
        h += '<div class="dashboard-danger-zone">';
        h += '<div class="dashboard-card dashboard-danger-card">';
        h += '<div class="dashboard-danger-card-content">';
        h += '<div class="dashboard-danger-card-info">';
        h += `<strong>${i18n('delete_account')}</strong>`;
        h += '<span>Permanently delete your account and all associated data. This action cannot be undone.</span>';
        h += '</div>';
        h += '</div>';
        h += `<button class="button button-danger delete-account">${i18n('delete_account')}</button>`;
        h += '</div>';
        h += '</div>';

        h += '</div>'; // end settings-grid

        h += '</div>'; // end dashboard-tab-content
        return h;
    },

    init ($el_window) {
        $el_window.find('.dashboard-section-account .change-password').on('click', function (e) {
            UIWindowChangePassword({
                window_options: {
                    parent_uuid: $el_window.attr('data-element_uuid'),
                    backdrop: true,
                    close_on_backdrop_click: true,
                    parent_center: true,
                    stay_on_top: true,
                    has_head: false,
                },
            });
        });
        $el_window.find('.dashboard-section-account .change-username').on('click', function (e) {
            UIWindowChangeUsername({
                window_options: {
                    parent_uuid: $el_window.attr('data-element_uuid'),
                    backdrop: true,
                    close_on_backdrop_click: true,
                    parent_center: true,
                    stay_on_top: true,
                    has_head: false,
                },
            });
        });
        $el_window.find('.dashboard-section-account .change-email').on('click', function (e) {
            UIWindowChangeEmail({
                window_options: {
                    parent_uuid: $el_window.attr('data-element_uuid'),
                    backdrop: true,
                    close_on_backdrop_click: true,
                    parent_center: true,
                    stay_on_top: true,
                    has_head: false,
                },
            });
        });
        $el_window.find('.dashboard-section-account .copy-auth-token').on('click', function (e) {
            UIWindowCopyToken({
                show_header: true,
                window_options: {
                    parent_uuid: $el_window.attr('data-element_uuid'),
                    backdrop: true,
                    close_on_backdrop_click: false,
                    parent_center: true,
                    stay_on_top: true,
                },
            });
        });
        $el_window.find('.dashboard-section-account .delete-account').on('click', function (e) {
            UIWindowConfirmUserDeletion({
                window_options: {
                    parent_uuid: $el_window.attr('data-element_uuid'),
                    backdrop: true,
                    close_on_backdrop_click: true,
                    parent_center: true,
                    stay_on_top: true,
                    has_head: false,
                },
            });
        });
        $el_window.find('.dashboard-section-account .change-profile-picture').on('click', async function (e) {
            // open dialog
            UIWindow({
                path: `/${ window.user.username }/Desktop`,
                // this is the uuid of the window to which this dialog will return
                parent_uuid: $el_window.attr('data-element_uuid'),
                allowed_file_types: ['.png', '.jpg', '.jpeg'],
                show_maximize_button: false,
                show_minimize_button: false,
                title: 'Open',
                is_dir: true,
                is_openFileDialog: true,
                selectable_body: false,
                backdrop: true,
                close_on_backdrop_click: true,
                parent_center: true,
                stay_on_top: true,
            });
        });
        $el_window.on('file_opened', async function (e) {
            let selected_file = Array.isArray(e.detail) ? e.detail[0] : e.detail;
            // set profile picture
            const profile_pic = await puter.fs.read(selected_file.path);
            // blob to base64
            const reader = new FileReader();
            reader.readAsDataURL(profile_pic);
            reader.onloadend = function () {
                // resizes the image to 150x150
                const img = new Image();
                img.src = reader.result;
                img.onload = function () {
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    canvas.width = 150;
                    canvas.height = 150;
                    ctx.drawImage(img, 0, 0, 150, 150);
                    const base64data = canvas.toDataURL('image/png');
                    // update profile picture
                    $el_window.find('.dashboard-profile-avatar').css('background-image', `url(${ html_encode(base64data) })`);
                    $('.profile-image').css('background-image', `url(${ html_encode(base64data) })`);
                    $('.profile-image').addClass('profile-image-has-picture');
                    // update profile picture
                    update_profile(window.user.username, { picture: base64data });
                };
            };
        });
    },
};

export default TabAccount;
