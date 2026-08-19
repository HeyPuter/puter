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
import UIAlert from './UIAlert.js';
import path from '../lib/path.js';
import { owner_of_path } from '../helpers/path_owner.js';
import { invalidate_shared_roots } from '../helpers/shared_access.js';
import { icons } from '../helpers/actionIcons.js';
import { mode_label, options_for } from '../helpers/share_modes.js';

/**
 * Sharing dialog for one file or directory.
 *
 * @param {object} options
 * @param {string} options.path Item to share.
 * @param {string} [options.name] Display name; defaults to the path's basename.
 * @param {string} [options.owner] Owner's username; defaults to the first path
 *   segment, which is not the current user when a `manage` recipient opens this.
 */
async function UIWindowShare (options) {
    options = options ?? {};
    const item_path = options.path;
    const item_name = options.name ?? path.basename(item_path);
    const item_owner =
        options.owner ?? owner_of_path(item_path) ?? window.user.username;

    let h = '';
    h += '<div class="share-dialog">';
    h += '<div class="form-error-msg"></div>';
    h += '<div class="form-success-msg"></div>';

    h += `<label for="share-recipient">${i18n('share_with')}</label>`;
    h += '<div class="share-dialog-row">';
    h += `<input class="share-recipient" id="share-recipient" type="text" autocomplete="off" spellcheck="false"
                 placeholder="${html_encode(i18n('share_add_people'))}" />`;
    h += `<select class="share-mode">${options_for('read')}</select>`;
    h += '</div>';
    h += `<button class="share-btn button button-primary button-block button-normal">${i18n('share')}</button>`;

    h += `<div class="share-dialog-heading">${i18n('share_who_has_access')}</div>`;
    h += '<div class="share-list"></div>';
    h += '</div>';

    // One dialog per item — window-level single_instance would refocus a
    // dialog still bound to a different file.
    const $existing = $('.window[data-app="share"]').filter(
        (_, el) => $(el).attr('data-share-path') === item_path,
    );
    if ( $existing.length ) {
        $existing.focusWindow();
        return;
    }

    const el_window = await UIWindow({
        title: `${i18n('share')} — ${item_name}`,
        app: 'share',
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
    $(el_window).attr('data-share-path', item_path);

    const $error = $(el_window).find('.form-error-msg');
    const $success = $(el_window).find('.form-success-msg');
    const $list = $(el_window).find('.share-list');

    const show_error = (message) => {
        $success.hide();
        $error.html(html_encode(message)).show();
    };

    const show_success = (message) => {
        $error.hide();
        $success.html(message).show();
    };

    const render = (shares) => {
        let rows = '';
        // The owner's access comes from owning the item, so it can't be revoked
        rows += '<div class="share-row">';
        rows += `<span class="share-row-who">${html_encode(item_owner)}${item_owner === window.user.username ? ` (${i18n('share_you')})` : ''}</span>`;
        rows += `<span class="share-row-owner">${i18n('share_owner')}</span>`;
        rows += '</div>';

        for ( const share of shares ) {
            const holder = html_encode(share.holder ?? '');
            if ( share.inheritedFrom ) {
                // Granted on an ancestor, so it can only be changed there
                rows += '<div class="share-row share-row-inherited">';
                rows += `<span class="share-row-who">${holder}</span>`;
                rows += `<span class="share-row-via">${i18n('share_inherited_via', { folder: path.basename(share.inheritedFrom) })}</span>`;
                rows += `<span class="share-row-mode">${mode_label(share.mode)}</span>`;
                rows += '</div>';
                continue;
            }
            if ( share.pending ) {
                const invited = html_encode(share.recipientEmail ?? '');
                rows += '<div class="share-row share-row-pending">';
                rows += `<span class="share-row-who">${invited}</span>`;
                rows += `<span class="share-row-via">${i18n('share_awaiting_signup')}</span>`;
                rows += `<span class="share-row-mode">${mode_label(share.mode)}</span>`;
                rows += `<button class="share-revoke" data-holder="${invited}" title="${html_encode(i18n('share_cancel_invite'))}" aria-label="${html_encode(i18n('share_cancel_invite'))}">${icons.trash}</button>`;
                rows += '</div>';
                continue;
            }
            rows += '<div class="share-row">';
            rows += `<span class="share-row-who">${holder}</span>`;
            rows += `<select class="share-row-mode-select" data-holder="${holder}">${options_for(share.mode)}</select>`;
            rows += `<button class="share-revoke" data-holder="${holder}" title="${html_encode(i18n('share_remove_access'))}" aria-label="${html_encode(i18n('share_remove_access'))}">${icons.trash}</button>`;
            rows += '</div>';
        }
        if ( !shares.length ) {
            rows += `<p class="share-dialog-empty">${i18n('share_no_one')}</p>`;
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
            const created = await puter.fs.share({
                path: item_path,
                recipient,
                mode: $(el_window).find('.share-mode').val(),
            });
            $(el_window).find('.share-recipient').val('');
            $error.hide();
            // "Shared with" would claim access an invite does not grant.
            // `i18n()` encodes its replacements; encoding first would show the
            // entities to anyone whose address or username contains one.
            show_success(
                created.some((share) => share.pending)
                    ? i18n('share_invited', { recipient })
                    : i18n('share_shared_with', { recipient }),
            );
            invalidate_shared_roots();
            await refresh();
        } catch (e) {
            show_error(e?.message ?? i18n('share_failed'));
        } finally {
            $(this).prop('disabled', false);
        }
    });

    $(el_window).on('change', '.share-row-mode-select', async function () {
        const holder = $(this).attr('data-holder');
        const mode = $(this).val();
        $(this).prop('disabled', true);
        try {
            await puter.fs.share({ path: item_path, recipient: holder, mode });
            show_success(i18n('share_access_updated', { recipient: holder }));
            invalidate_shared_roots();
            await refresh();
        } catch (e) {
            show_error(e?.message ?? i18n('share_failed'));
            invalidate_shared_roots();
            await refresh();
        }
    });

    $(el_window).on('click', '.share-revoke', async function () {
        const holder = $(this).attr('data-holder');
        const is_pending = $(this).closest('.share-row').hasClass('share-row-pending');
        const confirmed = await UIAlert({
            message: is_pending
                ? i18n('share_confirm_cancel_invite', { recipient: holder })
                : i18n('share_confirm_remove', { recipient: holder }),
            buttons: [
                { label: i18n('share_remove'), value: true, type: 'primary' },
                { label: i18n('cancel'), value: false },
            ],
            // Stack the confirmation with the dialog that opened it. In
            // fullpage/dashboard mode this window is promoted to the
            // stay-on-top band, where an alert defaulting to `stay_on_top:
            // false` renders underneath it — leaving a confirmation the user
            // can't reach without closing the dialog behind it.
            parent_uuid: $(el_window).attr('data-element_uuid'),
            stay_on_top: $(el_window).attr('data-stay_on_top') === 'true',
        });
        if ( ! confirmed ) return;
        $(this).prop('disabled', true);
        try {
            await puter.fs.unshare(item_path, holder);
            // `i18n()` encodes what it returns, replacements included, so the
            // raw value goes in — encoding first would show the entities to
            // anyone whose address or username contains one.
            show_success(
                is_pending
                    ? i18n('share_invite_cancelled', { recipient: holder })
                    : i18n('share_access_removed', { recipient: holder }),
            );
            invalidate_shared_roots();
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
