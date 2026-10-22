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

// Keep in sync with ProfileService on the backend.
const DISPLAY_NAME_MAX_LENGTH = 64;
const BIO_MAX_LENGTH = 280;

/**
 * Edits the signed-in user's display name and bio. `options.onSave` receives
 * the saved profile.
 */
async function UIWindowEditProfile (options) {
    options = options ?? {};

    const internal_id = window.uuidv4();
    let h = '';
    h += '<div class="edit-profile" style="padding: 20px; border-bottom: 1px solid #ced7e1;">';
    h += '<div class="form-error-msg"></div>';
    h += '<div class="form-success-msg"></div>';
    h += '<div style="overflow: hidden; margin-bottom: 20px;">';
    h += `<label for="edit-profile-display-name-${internal_id}">${i18n('display_name')}</label>`;
    h += `<input id="edit-profile-display-name-${internal_id}" type="text" class="edit-profile-display-name" maxlength="${DISPLAY_NAME_MAX_LENGTH}" autocomplete="off" />`;
    h += '</div>';
    h += '<div style="overflow: hidden; margin-bottom: 20px;">';
    h += `<label for="edit-profile-bio-${internal_id}">${i18n('bio')}</label>`;
    h += `<textarea id="edit-profile-bio-${internal_id}" class="edit-profile-bio" maxlength="${BIO_MAX_LENGTH}" rows="4" style="display: block; width: 100%; padding: 8px; box-sizing: border-box; resize: vertical; border: 1px solid #ccc; border-radius: 4px; font: inherit; font-size: 14px; color: #393f46;"></textarea>`;
    h += '</div>';
    h += `<button class="edit-profile-btn button button-primary button-block button-normal">${i18n('save')}</button>`;
    h += '</div>';

    const el_window = await UIWindow({
        title: i18n('edit_profile'),
        app: 'edit-profile',
        single_instance: true,
        icon: null,
        uid: null,
        is_dir: false,
        body_content: h,
        has_head: true,
        selectable_body: false,
        draggable_body: false,
        allow_context_menu: false,
        is_resizable: false,
        is_droppable: false,
        init_center: true,
        allow_native_ctxmenu: false,
        allow_user_select: false,
        width: 350,
        height: 'auto',
        dominant: true,
        show_in_taskbar: false,
        onAppend: function (this_window) {
            $(this_window).find('.edit-profile-display-name').get(0)?.focus({ preventScroll: true });
        },
        window_class: 'window-publishWebsite',
        body_css: {
            width: 'initial',
            height: '100%',
            'background-color': 'rgb(245 247 249)',
            'backdrop-filter': 'blur(3px)',
        },
        ...options.window_options,
    });

    const $fields = $(el_window).find('.edit-profile-display-name, .edit-profile-bio');
    $(el_window).find('.edit-profile-display-name').val(window.user?.profile?.displayName ?? '');
    $(el_window).find('.edit-profile-bio').val(window.user?.profile?.bio ?? '');

    $(el_window).find('.edit-profile-btn').on('click', async function () {
        const $btn = $(el_window).find('.edit-profile-btn');
        $(el_window).find('.form-success-msg, .form-error-msg').hide();
        $btn.addClass('disabled');
        $fields.attr('disabled', true);

        // An empty field clears it.
        const patch = {
            displayName: String($(el_window).find('.edit-profile-display-name').val() ?? '').trim() || null,
            bio: String($(el_window).find('.edit-profile-bio').val() ?? '').trim() || null,
        };
        // update_profile resolves with no profile when the request failed.
        const profile = await window.update_profile(window.user.username, patch);

        $btn.removeClass('disabled');
        $fields.attr('disabled', false);
        if ( ! profile ) {
            $(el_window).find('.form-error-msg').html(i18n('profile_save_failed'));
            $(el_window).find('.form-error-msg').fadeIn();
            return;
        }
        $(el_window).find('.edit-profile-display-name').val(profile.displayName ?? '');
        $(el_window).find('.edit-profile-bio').val(profile.bio ?? '');
        $(el_window).find('.form-success-msg').html(i18n('profile_saved'));
        $(el_window).find('.form-success-msg').fadeIn();
        options.onSave?.(profile);
    });
}

export default UIWindowEditProfile;
