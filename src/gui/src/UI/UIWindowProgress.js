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
import Placeholder from '../util/Placeholder.js';
import Button from './Components/Button.js';

/**
 * General purpose progress dialog.
 * @param operation_id If provided, is saved in the data-operation-id attribute, for later lookup.
 * @param show_progress Enable a progress bar, and display `(foo%)` after the status message
 * @param on_cancel A callback run when the Cancel button is clicked. Without it, no Cancel button will appear.
 * @returns {Promise<{set_progress: *, set_status: *, close: *, show_error: *, element: Element}>} Object for managing the progress dialog
 * @constructor
 * TODO: Debouncing logic (show only after a delay, then hide only after a delay)
 */
async function UIWindowProgress({
    operation_id = null,
    show_progress = false,
    on_cancel = null,
} = {}){
    const placeholder_cancel_btn = Placeholder();
    const placeholder_ok_btn = Placeholder();

    let h = '';
    h += `<div ${operation_id ? `data-operation-id="${operation_id}"` : ''}>`;
        h += `<div class="progress-running">`;
            h += `<div style="display: flex; align-items: center; gap: 7px;">`;
                // spinner
                h += `<svg style="overflow: visible;" xmlns="http://www.w3.org/2000/svg" height="24" width="24" viewBox="0 0 24 24"><title>circle anim</title><g fill="#212121" class="nc-icon-wrapper"><g class="nc-loop-circle-24-icon-f"><path d="M12 24a12 12 0 1 1 12-12 12.013 12.013 0 0 1-12 12zm0-22a10 10 0 1 0 10 10A10.011 10.011 0 0 0 12 2z" fill="#212121" opacity=".4"></path><path d="M24 12h-2A10.011 10.011 0 0 0 12 2V0a12.013 12.013 0 0 1 12 12z" data-color="color-2"></path></g><style>.nc-loop-circle-24-icon-f{--animation-duration:0.5s;transform-origin:12px 12px;animation:nc-loop-circle-anim var(--animation-duration) infinite linear}@keyframes nc-loop-circle-anim{0%{transform:rotate(0)}100%{transform:rotate(360deg)}}</style></g></svg>`;
                // Progress report
                h += `<div style="font-size:15px; overflow: hidden; flex-grow: 1; text-overflow: ellipsis; white-space: nowrap;">
                    <span class="progress-msg">${i18n('preparing')}</span>`;
                if (show_progress) {
                    h += ` (<span class="progress-percent">0%</span>)`;
                }
                h += `</div>`;
            h +=`</div>`;
            if (show_progress) {
                h += `<div class="progress-bar-container" style="margin-top:20px;">`;
                    h += `<div class="progress-bar"></div>`;
                h += `</div>`;
            }
            if (on_cancel) {
                h += `<div style="display: flex; justify-content: flex-end;">`;
                    h += placeholder_cancel_btn.html;
                h += `</div>`;
            }
        h += `</div>`;
        h += `<div class="progress-error" style="display: none">`;
            h += `<div style="display: flex; align-items: center; gap: 7px;">`;
                // Alert icon
                h += `<img style="width:24px; height:24px;" src="${html_encode(window.icons['warning-sign.svg'])}" />`;
                // Progress report
                h += `<div style="font-size:15px; overflow: hidden; flex-grow: 1; text-overflow: ellipsis; white-space: nowrap;">
                    <span class="progress-error-title"></span>`;
                h += `</div>`;
            h += `</div>`;
            h += `<p class="progress-error-message"></p>`;
            h += `<div style="display: flex; justify-content: flex-end;">`;
                h += placeholder_ok_btn.html;
            h += `</div>`;
        h += `</div>`;
    h += `</div>`;

    const el_window = await UIWindow({
        uid: null,
        is_dir: false,
        body_content: h,
        has_head: false,
        selectable_body: false,
        draggable_body: true,
        allow_context_menu: false,
        is_resizable: false,
        is_droppable: false,
        init_center: true,
        allow_native_ctxmenu: false,
        allow_user_select: false,
        window_class: 'window-progress',
        width: 450,
        dominant: true,
        window_css:{
            height: 'initial',
        },
        body_css: {
            padding: '22px',
            width: 'initial',
            'background-color': `hsla(
                var(--primary-hue),
                var(--primary-saturation),
                var(--primary-lightness),
                var(--primary-alpha))`,
            'backdrop-filter': 'blur(3px)',
        }    
    });

    if (on_cancel) {
        const cancel_btn = new Button({
            label: i18n('cancel'),
            style: 'small',
            on_click: () => {
                $(el_window).close();
                on_cancel();
            },
        });
        cancel_btn.attach(placeholder_cancel_btn);
    }

    const ok_btn = new Button({
        label: i18n('ok'),
        style: 'small',
        on_click: () => {
            $(el_window).close();
        },
    });
    ok_btn.attach(placeholder_ok_btn);

    return {
        element: el_window,
        set_status: (text) => {
            el_window.querySelector('.progress-msg').innerHTML = text;
        },
        set_progress: (percent) => {
            el_window.querySelector('.progress-bar').style.width = `${percent}%`;
            el_window.querySelector('.progress-percent').innerText = `${percent}%`;
        },
        close: () => {
            $(el_window).close();
        },
        show_error: (title, message) => {
            el_window.querySelector('.progress-running').style.display = 'none';
            el_window.querySelector('.progress-error').style.display = 'block';
            el_window.querySelector('.progress-error-title').innerText = title;
            el_window.querySelector('.progress-error-message').innerText = message;
        },
    };
}

export default UIWindowProgress;