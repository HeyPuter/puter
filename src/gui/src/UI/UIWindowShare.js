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
import path from '../lib/path.js';

const MODES = ['read', 'write', 'manage'];

const mode_label = (mode) => {
    if ( mode === 'write' ) return i18n('share_access_write');
    if ( mode === 'manage' ) return i18n('share_access_manage');
    return i18n('share_access_read');
};

/**
 * Sharing dialog for one file or directory.
 *
 * @param {object} options
 * @param {string} options.path Item to share.
 * @param {string} [options.name] Display name; defaults to the path's basename.
 */
async function UIWindowShare (options) {
    options = options ?? {};
    const item_path = options.path;
    const item_name = options.name ?? path.basename(item_path);

    let h = '';
    h += '<div class="share-dialog" style="padding: 20px;">';
    h += '<div class="form-error-msg" style="display:none;"></div>';
    h += '<div class="form-success-msg" style="display:none;"></div>';

    h += `<label for="share-recipient">${i18n('share_with')}</label>`;
    h += '<div style="display:flex; gap:8px; margin-bottom:20px;">';
    h += `<input class="share-recipient" id="share-recipient" type="text" autocomplete="off" spellcheck="false"
                 placeholder="${html_encode(i18n('share_add_people'))}" style="flex:1;" />`;
    h += '<select class="share-mode" style="width:120px;">';
    for ( const mode of MODES ) {
        h += `<option value="${mode}">${html_encode(mode_label(mode))}</option>`;
    }
    h += '</select>';
    h += '</div>';
    h += `<button class="share-btn button button-primary button-block button-normal">${i18n('share')}</button>`;

    h += `<h2 style="font-size:14px; margin:24px 0 8px;">${i18n('share_who_has_access')}</h2>`;
    h += '<div class="share-list"></div>';
    h += '</div>';

    const el_window = await UIWindow({
        title: `${i18n('share')} — ${html_encode(item_name)}`,
        app: 'share',
        single_instance: true,
        icon: window.icons['share-outline.svg'],
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
        width: 420,
        height: 'auto',
        dominant: true,
        show_in_taskbar: false,
        onAppend: function (this_window) {
            $(this_window).find('.share-recipient').get(0)?.focus({ preventScroll: true });
        },
        window_class: 'window-share',
        window_css: { height: 'initial' },
        body_css: { width: 'initial', padding: '0', 'background-color': 'rgb(245 247 249)' },
    });

    const $error = $(el_window).find('.form-error-msg');
    const $success = $(el_window).find('.form-success-msg');
    const $list = $(el_window).find('.share-list');

    const show_error = (message) => {
        $success.hide();
        $error.html(html_encode(message)).show();
    };

    const render = (shares) => {
        if ( !shares.length ) {
            $list.html(`<p style="color:#5f6b7a; font-size:13px;">${i18n('share_no_one')}</p>`);
            return;
        }
        let rows = '';
        for ( const share of shares ) {
            rows += '<div class="share-row" style="display:flex; align-items:center; justify-content:space-between; padding:6px 0;">';
            rows += `<span>${html_encode(share.holder ?? '')}</span>`;
            rows += '<span style="display:flex; align-items:center; gap:10px;">';
            rows += `<span style="color:#5f6b7a; font-size:12px;">${html_encode(mode_label(share.mode))}</span>`;
            rows += `<button class="share-revoke button button-small" data-holder="${html_encode(share.holder ?? '')}">${i18n('share_remove_access')}</button>`;
            rows += '</span></div>';
        }
        $list.html(rows);
    };

    const refresh = async () => {
        try {
            render(await puter.fs.getShares(item_path));
        } catch (e) {
            show_error(e?.message ?? i18n('share_failed'));
        }
    };

    $(el_window).on('click', '.share-btn', async function () {
        const recipient = $(el_window).find('.share-recipient').val().trim();
        if ( !recipient ) return;

        $(this).prop('disabled', true);
        try {
            await puter.fs.share({
                path: item_path,
                recipient,
                mode: $(el_window).find('.share-mode').val(),
            });
            $(el_window).find('.share-recipient').val('');
            $error.hide();
            $success.html(html_encode(i18n('share_to'))).show();
            await refresh();
        } catch (e) {
            show_error(e?.message ?? i18n('share_failed'));
        } finally {
            $(this).prop('disabled', false);
        }
    });

    $(el_window).on('click', '.share-revoke', async function () {
        const holder = $(this).attr('data-holder');
        $(this).prop('disabled', true);
        try {
            await puter.fs.unshare(item_path, holder);
            await refresh();
        } catch (e) {
            show_error(e?.message ?? i18n('share_failed'));
            $(this).prop('disabled', false);
        }
    });

    await refresh();
    return el_window;
}

export default UIWindowShare;
