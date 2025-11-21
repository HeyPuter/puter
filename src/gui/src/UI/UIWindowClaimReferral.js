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
import UIWindowSaveAccount from './UIWindowSaveAccount.js';

async function UIWindowClaimReferral (options) {
    let h = '';

    h += '<div>';
    h += '<div class="qr-code-window-close-btn generic-close-window-button disable-user-select"> &times; </div>';
    h += `<img src="${window.icons['present.svg']}" style="width: 70px; margin: 20px auto 20px; display: block; margin-bottom: 20px;">`;
    h += `<h1 style="font-weight: 400; padding: 0 10px; font-size: 21px; text-align: center; margin-bottom: 0; color: #60626d; -webkit-font-smoothing: antialiased;">${i18n('you_have_been_referred_to_puter_by_a_friend')}</h1>`;
    h += `<p style="text-align: center; font-size: 16px; padding: 20px; font-weight: 400; margin: -10px 10px 0px 10px; -webkit-font-smoothing: antialiased; color: #5f626d;">${i18n('confirm_account_for_free_referral_storage_c2a')}</p>`;
    h += `<button class="button button-primary button-block create-account-ref-btn" style="display: block;">${i18n('create_account')}</button>`;
    h += '</div>';

    const el_window = await UIWindow({
        title: 'Refer a friend!',
        icon: null,
        uid: null,
        is_dir: false,
        body_content: h,
        has_head: false,
        selectable_body: false,
        draggable_body: true,
        allow_context_menu: false,
        is_draggable: true,
        is_resizable: false,
        is_droppable: false,
        init_center: true,
        allow_native_ctxmenu: true,
        allow_user_select: true,
        width: 400,
        dominant: true,
        window_css: {
            height: 'initial',
        },
        body_css: {
            width: 'initial',
            'max-height': 'calc(100vh - 200px)',
            'background-color': 'rgb(241 246 251)',
            'backdrop-filter': 'blur(3px)',
            'padding': '10px 20px 20px 20px',
            'height': 'initial',
        },
    });

    $(el_window).find('.create-account-ref-btn').on('click', function (e) {
        UIWindowSaveAccount();
        $(el_window).close();
    });
}

export default UIWindowClaimReferral;