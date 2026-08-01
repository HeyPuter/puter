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
import { loginProgressBody } from './loginProgressBody.js';

async function UIWindowLoginInProgress (options) {
    return new Promise(async (resolve) => {
        options = options ?? {};

        // get the profile picture of the user
        let profile_pic;

        if ( options.user_info?.username ) {
            profile_pic = await get_profile_picture(options.user_info?.username);
        }

        if ( ! profile_pic ) {
            profile_pic = window.icons['profile.svg'];
        }

        const h = loginProgressBody(options.user_info, profile_pic);

        const el_window = await UIWindow({
            title: i18n('window_title_authenticating'),
            app: 'change-passowrd',
            single_instance: true,
            icon: null,
            uid: null,
            is_dir: false,
            body_content: h,
            has_head: false,
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
            backdrop: true,
            stay_on_top: true,
            window_class: 'window-login-progress',
            body_css: {
                width: 'initial',
                height: '100%',
                'background-color': 'rgb(245 247 249)',
                'backdrop-filter': 'blur(3px)',
            },
        });

        setTimeout(() => {
            $(el_window).close();
        }, 3000);
    });
}

export default UIWindowLoginInProgress;