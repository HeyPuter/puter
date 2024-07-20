/**
 * Copyright (C) 2024 Puter Technologies Inc.
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

import UIWindow from '../UIWindow.js';

// About
export default {
    id: 'profile',
    title_i18n_key: 'profile',
    icon: 'user.svg',
    html: () => {
        let h = ``;

        h += `<div style="overflow:hidden;">`;
            // profile picture
            h += `<div class="profile-picture change-profile-picture" style="background-image:url(${window.user.profile.picture ? window.user.profile.picture : window.icons['profile-black.svg']}); width:100px; height:100px; margin: 20px auto 0 auto;"></div>`;

            // name
            h += `<label for="name" style="display:block;">${i18n('name')}</label>`;
            h += `<input type="text" id="name" value="${window.user.profile.name ?? ''}" style="width:100%; margin-bottom:10px;"/>`;

            // bio
            h += `<label for="bio" style="display:block;">${i18n('bio')}</label>`;
            h += `<textarea id="bio" class="form-input" style="width:100%; height:200px; box-sizing: border-box; margin-bottom:10px; resize: none;">${window.user.profile.bio ?? ''}</textarea>`;

            // save button
            h += `<button class="button button-primary save-profile" style="margin: 0 auto; display:block;">${i18n('save')}</button>`;

        h += `</div>`;

        return h;
    },
    init: ($el_window) => {

        $el_window.find('.change-profile-picture').on('click', async function (e) {
            // open dialog
            UIWindow({
                path: '/' + window.user.username + '/Desktop',
                // this is the uuid of the window to which this dialog will return
                parent_uuid: $el_window.attr('data-element_uuid'),
                allowed_file_types: ['image/*'],
                show_maximize_button: false,
                show_minimize_button: false,
                title: 'Open',
                is_dir: true,
                is_openFileDialog: true,
                selectable_body: false,
            });    
        })

        $el_window.on('file_opened', async function(e){
            let selected_file = Array.isArray(e.detail) ? e.detail[0] : e.detail;
            // set profile picture
            const profile_pic = await puter.fs.read(selected_file.path)
            // blob to base64
            const reader = new FileReader();
            reader.readAsDataURL(profile_pic);
            reader.onloadend = function() {
                const base64data = reader.result;
                console.log(base64data)
                // update profile picture
                $el_window.find('.profile-picture').css('background-image', 'url(' + html_encode(base64data) + ')');
                // update profile picture
                update_profile(window.user.username, {picture: base64data})
            }
        })

        $el_window.find('.save-profile').on('click', async function (e) {
            const name = $el_window.find('#name').val();
            const bio = $el_window.find('#bio').val();
            update_profile(window.user.username, {name, bio})
        });
    },
};
