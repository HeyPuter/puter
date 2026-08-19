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

/**
 * Who the current user refuses shares from.
 *
 * Reuses the share dialog's markup and styles — the two are the same kind of
 * thing (a short list of people, one action each), and a second visual language
 * for it would be a defect even if it worked.
 *
 * Unblocking asks for no confirmation: nothing is lost by it, and blocking
 * again is one click away.
 *
 * @param {object} [options]
 * @param {object} [options.window_options] Merged into the `UIWindow` call, for
 *   a caller that owns where this appears (the dashboard passes its own uuid so
 *   the dialog stacks with it).
 */
async function UIWindowBlockedSenders (options) {
    options = options ?? {};

    let h = '';
    h += '<div class="share-dialog blocked-dialog">';
    h += '<div class="form-error-msg"></div>';
    h += '<div class="form-success-msg"></div>';

    h += `<label class="blocked-all-row">
                <input class="blocked-all" type="checkbox" />
                <span>
                    <strong>${i18n('blocked_all')}</strong>
                    <span class="share-dialog-empty">${i18n('blocked_all_note')}</span>
                </span>
             </label>`;

    h += `<label for="blocked-username">${i18n('blocked_add')}</label>`;
    h += '<div class="share-dialog-row">';
    h += `<input class="blocked-username" id="blocked-username" type="text" autocomplete="off" spellcheck="false"
                 placeholder="${i18n('blocked_add_placeholder')}" />`;
    h += '</div>';
    h += `<button class="blocked-add-btn button button-primary button-block button-normal">${i18n('block')}</button>`;

    h += `<div class="share-dialog-heading">${i18n('blocked_senders')}</div>`;
    h += `<p class="share-dialog-empty">${i18n('blocked_senders_note')}</p>`;
    h += '<div class="blocked-list"></div>';
    h += '</div>';

    const $existing = $('.window[data-app="blocked-senders"]');
    if ( $existing.length ) {
        $existing.focusWindow();
        return;
    }

    const el_window = await UIWindow({
        title: i18n('blocked_senders'),
        app: 'blocked-senders',
        icon: window.icons['shield.svg'],
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
            $(this_window).find('.blocked-username').get(0)?.focus({ preventScroll: true });
        },
        window_class: 'window-blocked-senders',
        window_css: { height: 'initial' },
        body_css: { width: 'initial', padding: '0', 'background-color': 'rgb(245 247 249)' },
        ...options.window_options,
    });

    const $error = $(el_window).find('.form-error-msg');
    const $success = $(el_window).find('.form-success-msg');
    const $list = $(el_window).find('.blocked-list');

    const show_error = (message) => {
        $success.hide();
        $error.html(html_encode(message)).show();
    };

    const show_success = (message) => {
        $error.hide();
        $success.html(message).show();
    };

    const api = async (method, body) => {
        const resp = await fetch(`${window.api_origin}/share/blocks`, {
            method,
            headers: {
                Authorization: `Bearer ${puter.authToken}`,
                'Content-Type': 'application/json',
            },
            ...(body ? { body: JSON.stringify(body) } : {}),
        });
        const parsed = await resp.json().catch(() => ({}));
        if ( ! resp.ok ) {
            throw new Error(parsed?.message ?? i18n('blocked_failed'));
        }
        return parsed;
    };

    const render = (items) => {
        if ( items.length === 0 ) {
            $list.html(`<p class="share-dialog-empty">${i18n('blocked_none')}</p>`);
            return;
        }
        let rows = '';
        for ( const item of items ) {
            const username = html_encode(item.username ?? '');
            rows += '<div class="share-row">';
            rows += `<span class="share-row-who">${username}</span>`;
            rows += `<button class="blocked-unblock button button-normal" data-username="${username}">${i18n('unblock')}</button>`;
            rows += '</div>';
        }
        $list.html(rows);
    };

    const refresh = async () => {
        try {
            const { all, items } = await api('GET');
            $(el_window).find('.blocked-all').prop('checked', Boolean(all));
            render(items ?? []);
        } catch (e) {
            show_error(e?.message ?? i18n('blocked_failed'));
        }
    };

    // The per-sender list stays live and editable while everyone is refused:
    // turning the blanket switch back off restores exactly what it hid, rather
    // than asking the user to rebuild it.
    $(el_window).on('change', '.blocked-all', async function () {
        const on = $(this).is(':checked');
        $(this).prop('disabled', true);
        try {
            await api(on ? 'POST' : 'DELETE', { all: true });
            show_success(i18n(on ? 'blocked_all_on' : 'blocked_all_off'));
        } catch (e) {
            $(this).prop('checked', !on);
            show_error(e?.message ?? i18n('blocked_failed'));
        } finally {
            $(this).prop('disabled', false);
        }
    });

    $(el_window).on('click', '.blocked-add-btn', async function () {
        const username = $(el_window).find('.blocked-username').val()?.trim();
        if ( ! username ) return;
        $(this).prop('disabled', true);
        try {
            await api('POST', { username });
            $(el_window).find('.blocked-username').val('');
            show_success(i18n('blocked_added', { username }));
            await refresh();
        } catch (e) {
            show_error(e?.message ?? i18n('blocked_failed'));
        } finally {
            $(this).prop('disabled', false);
        }
    });

    $(el_window).on('keypress', '.blocked-username', function (e) {
        if ( e.which === 13 ) $(el_window).find('.blocked-add-btn').trigger('click');
    });

    $(el_window).on('click', '.blocked-unblock', async function () {
        const username = $(this).attr('data-username');
        $(this).prop('disabled', true);
        try {
            await api('DELETE', { username });
            show_success(i18n('blocked_removed', { username }));
            await refresh();
        } catch (e) {
            show_error(e?.message ?? i18n('blocked_failed'));
            $(this).prop('disabled', false);
        }
    });

    await refresh();
    return el_window;
}

export default UIWindowBlockedSenders;
