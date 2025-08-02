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

import UIWindow from './UIWindow.js'

async function UIWindowWelcome(options){

    options = options ?? {};

    let h = '';
    // close button containing the multiplication sign
    h += `<div class="generic-close-window-button welcome-window-close-button"> &times; </div>`;
    h += `<div style="display:flex; flex-direction: colum;">`;
        h += `<div style="overflow: hidden; width: 200px; max-width: 200px; min-width: 200px; background: linear-gradient(45deg, #3d476b, #838eb7); min-height: 400px; padding: 20px; box-sizing: border-box;">`;
            h += `<img style="display: block; margin: 45px auto 0; width: 270px; opacity: 0.5;" src="data:image/svg+xml,%3C%3Fxml%20version%3D%221.0%22%3F%3E%3Csvg%20width%3D%2248%22%20height%3D%2248%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20xmlns%3Asvg%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cg%20class%3D%22layer%22%3E%3Ctitle%3ELayer%201%3C%2Ftitle%3E%3Cg%20id%3D%22svg_1%22%20stroke-width%3D%221%22%20transform%3D%22rotate(90%2024%2023.9997)%22%3E%3Cpolyline%20fill%3D%22none%22%20id%3D%22svg_2%22%20points%3D%2239%2024%2025%2024%2025%2028%22%20stroke%3D%22%23ffffff%22%20stroke-linecap%3D%22square%22%20stroke-miterlimit%3D%2210%22%20stroke-width%3D%221%22%2F%3E%3Cpolyline%20fill%3D%22none%22%20id%3D%22svg_3%22%20points%3D%2235.879%2010.121%2032%2014%2025%2014%2025%2018%22%20stroke%3D%22%23ffffff%22%20stroke-linecap%3D%22square%22%20stroke-miterlimit%3D%2210%22%20stroke-width%3D%221%22%2F%3E%3Cpath%20d%3D%22m13%2C26a10.29%2C10.29%200%200%201%20-7.2%2C-3%22%20fill%3D%22none%22%20id%3D%22svg_4%22%20stroke%3D%22%23ffffff%22%20stroke-linecap%3D%22square%22%20stroke-miterlimit%3D%2210%22%20stroke-width%3D%221%22%2F%3E%3Cpath%20d%3D%22m17%2C31.6a5.83%2C5.83%200%200%201%20-4%2C-5.6a5.73%2C5.73%200%200%201%202%2C-4.4%22%20fill%3D%22none%22%20id%3D%22svg_5%22%20stroke%3D%22%23ffffff%22%20stroke-linecap%3D%22square%22%20stroke-miterlimit%3D%2210%22%20stroke-width%3D%221%22%2F%3E%3Cpath%20d%3D%22m35.88%2C37.88l-3.88%2C-3.88l-7%2C0l0%2C2a9.9%2C9.9%200%200%201%20-10%2C10a9.9%2C9.9%200%200%201%20-10%2C-10a9.06%2C9.06%200%200%201%200.6%2C-3.2a5.63%2C5.63%200%200%201%20-2.6%2C-4.8a5.89%2C5.89%200%200%201%202.8%2C-5a9.99%2C9.99%200%200%201%20-2.8%2C-7a9.9%2C9.9%200%200%201%2010%2C-10l0.4%2C0a5.83%2C5.83%200%200%201%205.6%2C-4a5.89%2C5.89%200%200%201%206%2C6%22%20fill%3D%22none%22%20id%3D%22svg_6%22%20stroke%3D%22%23ffffff%22%20stroke-linecap%3D%22square%22%20stroke-miterlimit%3D%2210%22%20stroke-width%3D%221%22%2F%3E%3Ccircle%20cx%3D%2238%22%20cy%3D%228%22%20data-color%3D%22color-2%22%20fill%3D%22none%22%20id%3D%22svg_7%22%20r%3D%223%22%20stroke%3D%22%23ffffff%22%20stroke-linecap%3D%22square%22%20stroke-miterlimit%3D%2210%22%20stroke-width%3D%221%22%2F%3E%3Ccircle%20cx%3D%2242%22%20cy%3D%2224%22%20data-color%3D%22color-2%22%20fill%3D%22none%22%20id%3D%22svg_8%22%20r%3D%223%22%20stroke%3D%22%23ffffff%22%20stroke-linecap%3D%22square%22%20stroke-miterlimit%3D%2210%22%20stroke-width%3D%221%22%2F%3E%3Ccircle%20cx%3D%2238%22%20cy%3D%2240%22%20data-color%3D%22color-2%22%20fill%3D%22none%22%20id%3D%22svg_9%22%20r%3D%223%22%20stroke%3D%22%23ffffff%22%20stroke-linecap%3D%22square%22%20stroke-miterlimit%3D%2210%22%20stroke-width%3D%221%22%2F%3E%3C%2Fg%3E%3C%2Fg%3E%3C%2Fsvg%3E">`;
        h += `</div>`;
        h += `<div style="flex-grow: 1; padding-left: 50px; padding-top: 70px; padding-right: 50px;">`;
            h += `<h1 style="font-size: 25px; font-weight: 300; -webkit-font-smoothing: antialiased; color: #545763;">${i18n('welcome_title')}</h1>`;
            h += `<p style="margin-top: 25px; font-size: 16px; font-weight: 300; -webkit-font-smoothing: antialiased; color: #3e4251;">${i18n('welcome_description')}</p>`;
            h += `<button class="welcome-window-get-started" style="font-size: 15px; font-weight: 300; -webkit-font-smoothing: antialiased; cursor: pointer; padding: 8px 20px; border-radius: 5px; text-decoration: none; margin-right: 20px; border: 1px solid #656565 !important; background: none; margin-top: 10px;">${i18n('welcome_get_started')}</button>`;
            h += `<div class="welcome-window-footer">`;
                h += `<a href="/terms" target="_blank">${i18n('welcome_terms')}</a>`;
                h += `<a href="/privacy" style="margin-left: 20px;" target="_blank">${i18n('welcome_privacy')}</a>`;
                h += `<a href="https://developer.puter.com" style="margin-left: 20px;" target="_blank">${i18n('welcome_developers')}</a>`;
                h += `<a href="https://github.com/heyputer/puter" style="margin-left: 20px;" target="_blank">${i18n('welcome_open_source')}</a>`;
            h += `</div>`;
        h += `</div>`;
    h += `</div>`;

    const el_window = await UIWindow({
        title: i18n('welcome_instant_login_title'),
        app: 'instant-login',
        single_instance: true,
        icon: null,
        uid: null,
        is_dir: false,
        body_content: h,
        has_head: false,
        selectable_body: false,
        allow_context_menu: false,
        is_resizable: false,
        is_droppable: false,
        init_center: true,
        allow_native_ctxmenu: false,
        allow_user_select: false,
        backdrop: true,
        close_on_backdrop_click: false,
        backdrop_covers_toolbar: true,
        width: 650,
        height: 'auto',
        dominant: true,
        show_in_taskbar: false,
        draggable_body: true,
        fadeIn: 1000,
        window_class: 'window-welcome',
        on_close: function(){
            // save the fact that the user has seen the welcome window
            puter.kv.set('has_seen_welcome_window', true);
        },
        body_css: {
            width: 'initial',
            height: '100%',
            'background-color': 'rgb(245 247 249)',
            'backdrop-filter': 'blur(3px)',
            padding: '0',
        },
    })

    $(document).on('click', '.welcome-window-get-started', function(){
        $(el_window).close();
    })
}

export default UIWindowWelcome