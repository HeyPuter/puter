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
import UIWindowChangePassword from '../UIWindowChangePassword.js';
import UIWindowChangeEmail from './UIWindowChangeEmail.js';
import UIWindowChangeUsername from '../UIWindowChangeUsername.js';
import UIWindowConfirmUserDeletion from './UIWindowConfirmUserDeletion.js';
import UIWindowManageSessions from '../UIWindowManageSessions.js';

// About
export default {
    id: 'account',
    title_i18n_key: 'account',
    icon: 'user.svg',
    html: () => {
        let h = `<h1>${i18n('account')}</h1>`;

        // change password button
        if(!window.user.is_temp){
            h += H`<div class="settings-card">`;
                h += H`<strong>${i18n('password')}</strong>`;
                h += H`<div style="flex-grow:1;">`;
                    h += H`<button class="button change-password" style="float:right;">${i18n('change_password')}</button>`;
                h += H`</div>`;
            h += H`</div>`;
        }

        // change username button
        h += H`<div class="settings-card">`;
            h += H`<div>`;
                h += H`<strong style="display:block;">${i18n('username')}</strong>`;
                h += H`<span class="username" style="display:block; margin-top:5px;">${html_encode(window.user.username)}</span>`;
            h += H`</div>`;
            h += H`<div style="flex-grow:1;">`;
                h += H`<button class="button change-username" style="float:right;">${i18n('change_username')}</button>`;
            h += H`</div>`
        h += H`</div>`;

        // change email button
        if(window.user.email){
            h += H`<div class="settings-card">`;
                h += H`<div>`;
                    h += H`<strong style="display:block;">${i18n('email')}</strong>`;
                    h += H`<span class="user-email" style="display:block; margin-top:5px;">${html_encode(window.user.email)}</span>`;
                h += H`</div>`;
                h += H`<div style="flex-grow:1;">`;
                    h += H`<button class="button change-email" style="float:right;">${i18n('change_email')}</button>`;
                h += H`</div>`;
            h += H`</div>`;
        }

        // 'Delete Account' button
        h += H`<div class="settings-card settings-card-danger">`;
            h += H`<strong style="display: inline-block;">${i18n("delete_account")}</strong>`;
            h += H`<div style="flex-grow:1;">`;
                h += H`<button class="button button-danger delete-account" style="float:right;">${i18n("delete_account")}</button>`;
            h += H`</div>`;
        h += H`</div>`;

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
    },
};
