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
import UIWindowManageSessions from '../UIWindowManageSessions.js';
import UIWindow from '../UIWindow.js';

// About
export default {
    id: 'account',
    title_i18n_key: 'account',
    icon: 'user.svg',
    html: () => {
        let h = '';
        // h += `<h1>${i18n('account')}</h1>`;

        // profile picture
        h += `<div style="overflow: hidden; display: flex; flex-direction: column; align-items: center; margin-bottom: 10px;">`;

        // Profile Picture at the top
        // Check if the user has uploaded a valid profile picture
        const profilePicture = window.user?.profile?.picture && window.user.profile.picture !== '' 
            ? window.user.profile.picture 
            : window.icons['profile.svg'];  // Fallback to default profile.svg

        h += `<div class="profile-picture" style="background-image: url('${html_encode(profilePicture)}'); width: 150px; height: 150px; border-radius: 50%; background-size: cover; background-position: center; margin-bottom: 10px; cursor: default; display: inline-block;">`;
        h += `</div>`;
        h += `</div>`;
        

        h += `<div style="width: 100%; margin-bottom: 50px; display: flex; justify-content: center; align-items: center; gap: 10px;">`; 
            // Change Profile Picture Button
            h += `<button class="button change-profile-picture" style="font-size: 14px; padding: 8px 15px; 
            display: flex; align-items: center; justify-content: center;">${i18n('Change Profile Picture')}</button>`;
            // Delete Profile Picture Button
            h += `<button class="button button-danger delete_Profile_Picture" style="font-size: 14px; padding: 8px 15px; 
            display: flex; align-items: center; justify-content: center; background-color: #e74c3c;">${i18n('Remove Profile Picture')}</button>`; 
        h += `</div>`;
        // change password button
        if(!window.user.is_temp){
            h += `<div class="settings-card">`;
                h += `<strong>${i18n('password')}</strong>`;
                h += `<div style="flex-grow:1;">`;
                    h += `<button class="button change-password" style="float:right;">${i18n('change_password')}</button>`;
                h += `</div>`;
            h += `</div>`;
        }

        // change username button
        h += `<div class="settings-card">`;
            h += `<div>`;
                h += `<strong style="display:block;">${i18n('username')}</strong>`;
                h += `<span class="username" style="display:block; margin-top:5px;">${html_encode(window.user.username)}</span>`;
            h += `</div>`;
            h += `<div style="flex-grow:1;">`;
                h += `<button class="button change-username" style="float:right;">${i18n('change_username')}</button>`;
            h += `</div>`
        h += `</div>`;

        // change email button
        if(window.user.email){
            h += `<div class="settings-card">`;
                h += `<div>`;
                    h += `<strong style="display:block;">${i18n('email')}</strong>`;
                    h += `<span class="user-email" style="display:block; margin-top:5px;">${html_encode(window.user.email)}</span>`;
                h += `</div>`;
                h += `<div style="flex-grow:1;">`;
                    h += `<button class="button change-email" style="float:right;">${i18n('change_email')}</button>`;
                h += `</div>`;
            h += `</div>`;
        }

        // 'Delete Account' button
        h += `<div class="settings-card settings-card-danger">`;
            h += `<strong style="display: inline-block;">${i18n("delete_account")}</strong>`;
            h += `<div style="flex-grow:1;">`;
                h += `<button class="button button-danger delete-account" style="float:right;">${i18n("delete_account")}</button>`;
            h += `</div>`;
        h += `</div>`;

        return h;
    },
    init: ($el_window) => {
        $el_window.find('.change-password').on('click', function (e) {
            UIWindowChangePassword({
                window_options:{
                    parent_uuid: $el_window.attr('data-element_uuid'),
                    disable_parent_window: true,
                    parent_center: true,
                }
            });
        });

        $el_window.find('.change-username').on('click', function (e) {
            UIWindowChangeUsername({
                window_options:{
                    parent_uuid: $el_window.attr('data-element_uuid'),
                    disable_parent_window: true,
                    parent_center: true,
                }
            });
        });

        $el_window.find('.change-email').on('click', function (e) {
            UIWindowChangeEmail({
                window_options:{
                    parent_uuid: $el_window.attr('data-element_uuid'),
                    disable_parent_window: true,
                    parent_center: true,
                }
            });
        });

        $el_window.find('.manage-sessions').on('click', function (e) {
            UIWindowManageSessions({
                window_options:{
                    parent_uuid: $el_window.attr('data-element_uuid'),
                    disable_parent_window: true,
                    parent_center: true,
                }
            });
        });

        $el_window.find('.delete-account').on('click', function (e) {
            UIWindowConfirmUserDeletion({
                window_options:{
                    parent_uuid: $el_window.attr('data-element_uuid'),
                    disable_parent_window: true,
                    parent_center: true,
                }
            });
        });

        $el_window.find('.change-profile-picture').on('click', async function (e) {
            // open dialog
            UIWindow({
                path: '/' + window.user.username + '/Desktop',
                // this is the uuid of the window to which this dialog will return
                parent_uuid: $el_window.attr('data-element_uuid'),
                allowed_file_types: ['.png', '.jpg', '.jpeg'],
                show_maximize_button: false,
                show_minimize_button: false,
                title: 'Open',
                is_dir: true,
                is_openFileDialog: true,
                selectable_body: false,
            });    
        })

        $el_window.find('.delete_Profile_Picture').on('click', async function (e) {
            // Update the profile picture in the UI (set to a default image or placeholder)
            window.user.profile.picture = window.icons['profile.svg'];
            const defaultPicture = window.icons['profile.svg']; 
            $el_window.find('.profile-picture').css('background-image', `url('${html_encode(defaultPicture)}')`);

            // Update the profile picture displayed on the page
            $('.profile-picture').css('background-image', `url('${html_encode(defaultPicture)}')`);
            $('.profile-image').addClass('profile-image-has-picture'); 

            // update the global profile image display
            $('.profile-image').css('background-image', `url('${html_encode(defaultPicture)}')`);
            $('.profile-image').addClass('profile-image-has-picture');
            
        });
        
        $el_window.on('file_opened', async function(e){
            let selected_file = Array.isArray(e.detail) ? e.detail[0] : e.detail;
            // set profile picture
            const profile_pic = await puter.fs.read(selected_file.path)
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
                    $el_window.find('.profile-picture').css('background-image', 'url(' + html_encode(base64data) + ')');
                    $('.profile-image').css('background-image', 'url(' + html_encode(base64data) + ')');
                    $('.profile-image').addClass('profile-image-has-picture');
                    // update profile picture
                    update_profile(window.user.username, {picture: base64data})
                }
            }
        })
    },
};
