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

import UIWindow from './UIWindow.js'

async function UIWindowQR(options){
    return new Promise(async (resolve) => {
        options = options ?? {};

        let h = '';
        // close button containing the multiplication sign
        h += `<div class="qr-code-window-close-btn generic-close-window-button"> &times; </div>`;
        h += `<div class="otp-qr-code">`;
            h += `<h1 style="text-align: center; font-size: 16px; padding: 10px; font-weight: 400; margin: -10px 10px 20px 10px; -webkit-font-smoothing: antialiased; color: #5f626d;">${i18n('scan_qr_c2a')}</h1>`;
        h += `</div>`;

        const el_window = await UIWindow({
            title: 'Instant Login!',
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
            width: 350,
            height: 'auto',
            dominant: true,
            show_in_taskbar: false,
            draggable_body: true,
            onAppend: function(this_window){
            },
            window_class: 'window-qr',
            body_css: {
                width: 'initial',
                height: '100%',
                'background-color': 'rgb(245 247 249)',
                'backdrop-filter': 'blur(3px)',
            }    
        })

        // generate auth token QR code
        new QRCode($(el_window).find('.otp-qr-code').get(0), {
            text: window.gui_origin + '?auth_token=' + window.auth_token,
            width: 155,
            height: 155,
            colorDark : "#000000",
            colorLight : "#ffffff",
            correctLevel : QRCode.CorrectLevel.H
        });        
    })
}

export default UIWindowQR