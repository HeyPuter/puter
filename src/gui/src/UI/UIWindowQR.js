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

import Placeholder from '../util/Placeholder.js';
import Flexer from './Components/Flexer.js';
import QRCodeView from './Components/QRCode.js';
import UIWindow from './UIWindow.js'

async function UIWindowQR(options){

    options = options ?? {};

    const placeholder_qr = Placeholder();

    const h = `
        <div class="qr-code-window-close-btn generic-close-window-button">&times;</div>
        <div class="qr-code-window-content">
            <h1 class="qr-window-title">${i18n(options.message_i18n_key || 'scan_qr_generic')}</h1>
        </div>
        ${placeholder_qr.html}
    `;

    const el_window = await UIWindow({
        title: i18n('window_title_instant_login'),
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
        width: 450,
        height: 'auto',
        dominant: true,
        show_in_taskbar: false,
        draggable_body: true,
        window_class: 'window-qr',
        body_css: {
            width: 'initial',
            height: '100%',
            'background-color': '#F5F5F7',
            'backdrop-filter': 'blur(3px)',
            padding: '40px 20px',
        },
    })

    const component_qr = new QRCodeView({
        value: options.text,
        size: 250,
    });

    const component_flexer = new Flexer({
        children: [
            component_qr,
        ]
    });

    component_flexer.attach(placeholder_qr);
}

export default UIWindowQR