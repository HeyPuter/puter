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

import TeePromise from '../util/TeePromise.js';
import UIWindow from './UIWindow.js'

let checkbox_id_ = 0;

async function UIWindowQR(options){
    const confirmations = options.confirmations || [];

    const promise = new TeePromise();

    options = options ?? {};

    let h = '';
    // close button containing the multiplication sign
    // h += `<div class="qr-code-window-close-btn generic-close-window-button"> &times; </div>`;
    h += `<div class="otp-qr-code">`;
        h += `<h1 style="text-align: center; font-size: 16px; padding: 10px; font-weight: 400; margin: -10px 10px 20px 10px; -webkit-font-smoothing: antialiased; color: #5f626d;">${
            i18n(options.message_i18n_key || 'scan_qr_generic')
        }</h1>`;
    h += `</div>`;

    if ( options.recovery_codes ) {
        h += `<div class="recovery-codes">`;
            h += `<h2 style="text-align: center; font-size: 16px; padding: 10px; font-weight: 400; margin: -10px 10px 20px 10px; -webkit-font-smoothing: antialiased; color: #5f626d;">${
                i18n('recovery_codes')
            }</h2>`;
            h += `<div class="recovery-codes-list">`;
                for ( let i=0 ; i < options.recovery_codes.length ; i++ ) {
                    h += `<div class="recovery-code">${
                        html_encode(options.recovery_codes[i])
                    }</div>`;
                }
            h += `</div>`;
        h += `</div>`;
    }

    for ( let i=0 ; i < confirmations.length ; i++ ) {
        const confirmation = confirmations[i];
        // checkbox
        h += `<div class="qr-code-checkbox">`;
            h += `<input type="checkbox" id="checkbox_${++checkbox_id_}" name="confirmation_${i}">`;
            h += `<label for="checkbox_${checkbox_id_}">${confirmation}</label>`;
        h += `</div>`;
    }

    // h += `<button class="code-confirm-btn" style="margin: 20px auto; display: block; width: 100%; padding: 10px; font-size: 16px; font-weight: 400; background-color: #007bff; color: #fff; border: none; border-radius: 5px; cursor: pointer;">${
    //     i18n('confirm')
    // }</button>`;
    if ( options.has_confirm_and_cancel ) {
        h += `<button type="submit" class="button button-block button-primary code-confirm-btn" style="margin-top:10px;" disabled>${
            i18n('confirm')
        }</button>`;
        h += `<button type="submit" class="button button-block button-secondary code-cancel-btn" style="margin-top:10px;">${
            i18n('cancel')
        }</button>`;
    } else {
        h += `<button type="submit" class="button button-block button-primary code-confirm-btn" style="margin-top:10px;">${
            i18n('done')
        }</button>`;
    }

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
        width: 550,
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
            padding: '20px',
        },
    })

    // generate auth token QR code
    new QRCode($(el_window).find('.otp-qr-code').get(0), {
        text: options.text,
        width: 455,
        height: 455,
        colorDark : "#000000",
        colorLight : "#ffffff",
        correctLevel : QRCode.CorrectLevel.H
    });

    if ( confirmations.length > 0 ) {
        $(el_window).find('.code-confirm-btn').prop('disabled', true);
    }

    $(el_window).find('.qr-code-checkbox input').on('change', () => {
        const all_checked = $(el_window).find('.qr-code-checkbox input').toArray().every(el => el.checked);
        $(el_window).find('.code-confirm-btn').prop('disabled', !all_checked);
    });

    $(el_window).find('.code-confirm-btn').on('click', () => {
        $(el_window).close();
        promise.resolve(true);
    });

    $(el_window).find('.code-cancel-btn').on('click', () => {
        $(el_window).close();
        promise.resolve(false);
    });

    return await promise;
}

export default UIWindowQR