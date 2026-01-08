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

async function UIWindowDesktopBGSettings (options) {
    options = options ?? {};

    return new Promise(async (resolve) => {
        let h = '';
        const original_background_css = $('body').attr('style');
        let bg_url = window.desktop_bg_url,
            bg_color = window.desktop_bg_color,
            bg_fit = window.desktop_bg_fit;

        h += '<div style="padding: 10px; border-bottom: 1px solid #ced7e1;">';

        // type
        h += `<label>${i18n('background')}:</label>`;
        h += '<select class="desktop-bg-type" style="width: 150px; margin-bottom: 20px;">';
        h += `<option value="default">${i18n('default')}</option>`;
        h += `<option value="picture">${i18n('picture')}</option>`;
        h += `<option value="color">${i18n('color')}</option>`;
        h += '</select>';

        // Picture
        h += '<div class="desktop-bg-settings-wrapper desktop-bg-settings-picture">';
        h += `<label>${i18n('image')}:</label>`;
        h += `<button class="button button-default button-small browse">${i18n('browse')}</button>`;
        h += `<label style="margin-top: 20px;">${i18n('fit')}:</label>`;
        h += '<select class="desktop-bg-fit" style="width: 150px;">';
        h += `<option value="cover">${i18n('cover')}</option>`;
        h += `<option value="center">${i18n('center')}</option>`;
        h += `<option value="contain">${i18n('contain')}</option>`;
        h += `<option value="repeat">${i18n('repeat')}</option>`;
        h += '</select>';
        h += '</div>';

        // Color
        h += '<div class="desktop-bg-settings-wrapper desktop-bg-settings-color">';
        h += `<label>${i18n('color')}:</label>`;
        h += '<div class="desktop-bg-color-blocks">';
        h += '<div class="desktop-bg-color-block" data-color="#4F7BB5" style="background-color: #4F7BB5"></div>';
        h += '<div class="desktop-bg-color-block" data-color="#545554" style="background-color: #545554"></div>';
        h += '<div class="desktop-bg-color-block" data-color="#F5D3CE" style="background-color: #F5D3CE"></div>';
        h += '<div class="desktop-bg-color-block" data-color="#52A758" style="background-color: #52A758"></div>';
        h += '<div class="desktop-bg-color-block" data-color="#ad3983" style="background-color: #ad3983"></div>';
        h += '<div class="desktop-bg-color-block" data-color="#ffffff" style="background-color: #ffffff"></div>';
        h += '<div class="desktop-bg-color-block" data-color="#000000" style="background-color: #000000"></div>';
        h += '<div class="desktop-bg-color-block" data-color="#454545" style="background-color: #454545"></div>';
        h += `<div class="desktop-bg-color-block desktop-bg-color-block-palette" data-color="" style="background-image: url(${window.icons['palette.svg']});
                    background-repeat: no-repeat;
                    background-size: contain;
                    background-position: center;"><input type="color" style="width:25px; height: 25px; opacity:0;"></div>`;
        h += '</div>';
        h += '</div>';

        h += '<div style="padding-top: 5px; overflow:hidden; margin-top: 25px; border-top: 1px solid #CCC;">';
        h += `<button class="button button-primary apply" style="float:right;">${i18n('apply')}</button>`;
        h += `<button class="button button-default cancel" style="float:right; margin-right: 10px;">${i18n('cancel')}</button>`;
        h += '</div>';

        h += '</div>';

        const el_window = await UIWindow({
            title: i18n('change_desktop_background'),
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
            allow_native_ctxmenu: true,
            allow_user_select: true,
            onAppend: function (this_window) {
                $(this_window).find('.access-recipient').focus();
            },
            window_class: 'window-give-access',
            width: 350,
            window_css: {
                height: 'initial',
            },
            body_css: {
                width: 'initial',
                height: '100%',
                'background-color': 'rgb(245 247 249)',
                'backdrop-filter': 'blur(3px)',
            },
            ...options.window_options,
        });

        const default_wallpaper = (window.gui_env === 'prod') ? 'https://puter-assets.b-cdn.net/wallpaper.webp' : '/images/wallpaper.webp';
        $(el_window).find('.desktop-bg-settings-wrapper').hide();

        if ( window.desktop_bg_url === default_wallpaper ) {
            $(el_window).find('.desktop-bg-type').val('default');
        } else if ( window.desktop_bg_url !== undefined && window.desktop_bg_url !== null ) {
            $(el_window).find('.desktop-bg-settings-picture').show();
            $(el_window).find('.desktop-bg-type').val('picture');
        } else if ( window.desktop_bg_color !== undefined && window.desktop_bg_color !== null ) {
            $(el_window).find('.desktop-bg-settings-color').show();
            $(el_window).find('.desktop-bg-type').val('color');
        } else {
            // Default fallback if no specific wallpaper settings are detected
            $(el_window).find('.desktop-bg-type').val('default');
        }

        $(el_window).find('.desktop-bg-color-block:not(.desktop-bg-color-block-palette').on('click', async function (e) {
            window.set_desktop_background({ color: $(this).attr('data-color') });
        });
        $(el_window).find('.desktop-bg-color-block-palette input').on('change', async function (e) {
            window.set_desktop_background({ color: $(this).val() });
        });
        $(el_window).on('file_opened', function (e) {
            let selected_file = Array.isArray(e.detail) ? e.detail[0] : e.detail;
            const fit = $(el_window).find('.desktop-bg-fit').val();
            bg_url = selected_file.read_url;
            bg_fit = fit;
            bg_color = undefined;
            window.set_desktop_background({ url: bg_url, fit: bg_fit });
        });

        $(el_window).find('.desktop-bg-fit').on('change', function (e) {
            const fit = $(this).val();
            bg_fit = fit;
            window.set_desktop_background({ fit: fit });
        });

        $(el_window).find('.desktop-bg-type').on('change', function (e) {
            const type = $(this).val();
            $(el_window).find('.desktop-bg-settings-wrapper').hide();
            if ( type === 'picture' ) {
                $(el_window).find('.desktop-bg-settings-picture').show();
            } else if ( type === 'color' ) {
                $(el_window).find('.desktop-bg-settings-color').show();
            } else if ( type === 'default' ) {
                bg_color = undefined;
                bg_fit = 'cover';
                window.set_desktop_background({ url: default_wallpaper, fit: bg_fit });
            }
        });

        $(el_window).find('.apply').on('click', async function (e) {
            // /set-desktop-bg
            try {
                $.ajax({
                    url: `${window.api_origin }/set-desktop-bg`,
                    type: 'POST',
                    data: JSON.stringify({
                        url: window.desktop_bg_url,
                        color: window.desktop_bg_color,
                        fit: window.desktop_bg_fit,
                    }),
                    async: true,
                    contentType: 'application/json',
                    headers: {
                        'Authorization': `Bearer ${window.auth_token}`,
                    },
                    statusCode: {
                        401: function () {
                            window.logout();
                        },
                    },
                });
                $(el_window).close();
                resolve(true);
            } catch ( err ) {
                // Ignore
            }
        });

        $(el_window).find('.browse').on('click', function () {
            // open dialog
            UIWindow({
                path: `/${ window.user.username }/Desktop`,
                // this is the uuid of the window to which this dialog will return
                parent_uuid: $(el_window).attr('data-element_uuid'),
                allowed_file_types: ['image/*'],
                show_maximize_button: false,
                show_minimize_button: false,
                title: i18n('window_title_open'),
                is_dir: true,
                is_openFileDialog: true,
                selectable_body: false,
            });
        });

        $(el_window).find('.cancel').on('click', function () {
            $('body').attr('style', original_background_css);
            $(el_window).close();
            resolve(true);
        });
    });
}

export default UIWindowDesktopBGSettings;