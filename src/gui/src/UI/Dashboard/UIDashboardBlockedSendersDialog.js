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

// Who the current user refuses shares from: a dashboard dialog card with a
// switch that refuses everyone, a field to block one person, and the list of
// people already blocked.

import { isTouchPrimaryDevice } from './ContextMenu/ContextMenu.js';
import mountDashboardOverlay from './dashboardOverlay.js';
import { ICONS } from './UIDashboardDialog.js';
import { formFieldHtml } from './UIDashboardFormDialog.js';

const t = (key, values = []) => i18n(key, values, false);

/**
 * @param {'GET'|'POST'|'DELETE'} method
 * @param {{ username?: string, all?: boolean }} [body]
 * @returns {Promise<{ all?: boolean, items?: Array<{ username: string }> }>}
 */
const blocksApi = async (method, body) => {
    const resp = await fetch(`${window.api_origin}/share/blocks`, {
        method,
        headers: {
            Authorization: `Bearer ${puter.authToken}`,
            'Content-Type': 'application/json',
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const parsed = await resp.json().catch(() => ({}));
    if ( ! resp.ok ) throw new Error(parsed?.message ?? t('blocked_failed'));
    return parsed;
};

/**
 * @param {object} [opts]
 * @param {jQuery} [opts.$container] Where the overlay mounts; defaults to body.
 * @param {HTMLElement} [opts.returnFocusTo] Where focus goes on close.
 * @returns {{ $dialog: jQuery, close: () => void }}
 */
export default function UIDashboardBlockedSendersDialog ({ $container, returnFocusTo } = {}) {
    const id = `dashboard-blocked-${window.uuidv4?.() ?? Date.now()}`;

    let h = `<div class="dashboard-dialog dashboard-blocked-dialog" role="dialog" aria-modal="true" tabindex="-1" aria-labelledby="${id}-title">`;
    h += '<div class="dashboard-dialog-header">';
    h += `<span class="dashboard-dialog-title" id="${id}-title">${i18n('blocked_senders')}</span>`;
    h += `<button type="button" class="dashboard-dialog-close" aria-label="${i18n('close')}" title="${i18n('close')}">${ICONS.close}</button>`;
    h += '</div>';
    h += '<div class="dashboard-dialog-body">';
    h += '<div class="dashboard-dialog-content">';
    h += formFieldHtml({ name: 'all', type: 'switch', label: i18n('blocked_all'), hint: i18n('blocked_all_note') }, id);
    h += '<form class="dashboard-form-field dashboard-blocked-add" novalidate>';
    h += `<label class="dashboard-form-label" for="${id}-username">${i18n('blocked_add')}</label>`;
    h += '<div class="dashboard-blocked-add-row">';
    h += `<input type="text" class="dashboard-dialog-input dashboard-blocked-username" id="${id}-username"`;
    h += ` autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${i18n('blocked_add_placeholder')}" aria-describedby="${id}-note">`;
    h += `<button type="submit" class="dashboard-dialog-btn dashboard-dialog-btn-primary dashboard-blocked-add-btn">${i18n('block')}</button>`;
    h += '</div>';
    h += `<p class="dashboard-form-hint" id="${id}-note">${i18n('blocked_senders_note')}</p>`;
    h += '</form>';
    h += '<div class="dashboard-form-status" role="status" aria-live="polite"></div>';
    h += `<div class="dashboard-blocked-list" role="group" aria-label="${i18n('blocked_senders')}" aria-busy="true"></div>`;
    h += '</div></div>';
    h += '<div class="dashboard-dialog-footer">';
    h += `<button type="button" class="dashboard-dialog-btn dashboard-dialog-btn-primary dashboard-blocked-done">${i18n('done')}</button>`;
    h += '</div></div>';

    const { $dialog, close, isClosed } = mountDashboardOverlay({ html: h, $container, returnFocusTo });
    const $status = $dialog.find('.dashboard-form-status');
    const $list = $dialog.find('.dashboard-blocked-list');
    const $all = $dialog.find('.dashboard-form-input[name="all"]');
    const $username = $dialog.find('.dashboard-blocked-username');
    const el_dialog = $dialog.get(0);

    // A keyboard popping up mid-animation on a phone hides half the sheet.
    (isTouchPrimaryDevice() ? $dialog : $username).get(0)?.focus({ preventScroll: true });

    const setStatus = (text, kind = 'error') => {
        $status.text(text ?? '')
            .toggleClass('dashboard-form-status-error', !! text && kind === 'error')
            .toggleClass('dashboard-form-status-info', !! text && kind === 'info');
    };
    const fail = (err) => setStatus(err?.message || t('blocked_failed'));

    // A focused button that is disabled or redrawn drops focus to the page.
    const holdFocus = () => {
        const el_active = document.activeElement;
        if ( ! isClosed() && (! el_active || el_active === document.body) ) el_dialog.focus({ preventScroll: true });
    };

    const render = (items) => {
        if ( ! items.length ) {
            $list.html(`<p class="dashboard-blocked-empty">${i18n('blocked_none')}</p>`);
        } else {
            $list.html(items.map((item) => {
                const username = html_encode(item.username ?? '');
                return '<div class="dashboard-blocked-row">'
                    + `<span class="dashboard-blocked-who enable-user-select">${username}</span>`
                    + `<button type="button" class="dashboard-dialog-btn dashboard-dialog-btn-quiet dashboard-blocked-unblock" data-username="${username}"`
                    + ` aria-label="${html_encode(`${t('unblock')} ${item.username ?? ''}`)}">${i18n('unblock')}</button>`
                    + '</div>';
            }).join(''));
        }
        $list.attr('aria-busy', 'false');
        holdFocus();
    };

    // Answers can arrive out of order: an older list must not replace a newer
    // one, nor the switch's state a change made since it was requested.
    let list_seq = 0;
    let all_seq = 0;

    const refresh = async () => {
        const seq = ++list_seq;
        const all_at_request = all_seq;
        try {
            const { all, items } = await blocksApi('GET');
            if ( isClosed() || seq !== list_seq ) return;
            if ( all_at_request === all_seq ) $all.prop('checked', Boolean(all));
            render(items ?? []);
        } catch ( err ) {
            if ( isClosed() ) return;
            fail(err);
            if ( seq === list_seq ) $list.attr('aria-busy', 'false');
        }
    };

    // The list stays editable while everyone is refused: switching this back
    // off restores exactly what it hid.
    $all.on('change', async function () {
        const on = this.checked;
        all_seq++;
        this.disabled = true;
        try {
            await blocksApi(on ? 'POST' : 'DELETE', { all: true });
            setStatus(t(on ? 'blocked_all_on' : 'blocked_all_off'), 'info');
        } catch ( err ) {
            this.checked = ! on;
            fail(err);
        } finally {
            this.disabled = false;
            holdFocus();
        }
    });

    $dialog.on('submit', '.dashboard-blocked-add', async function (e) {
        e.preventDefault();
        const username = String($username.val() ?? '').trim();
        const $btn = $dialog.find('.dashboard-blocked-add-btn');
        if ( ! username || $btn.prop('disabled') ) return;
        $btn.prop('disabled', true);
        try {
            await blocksApi('POST', { username });
            $username.val('');
            setStatus(t('blocked_added', { username }), 'info');
            await refresh();
        } catch ( err ) {
            fail(err);
        } finally {
            $btn.prop('disabled', false);
            holdFocus();
        }
    });

    $dialog.on('click', '.dashboard-blocked-unblock', async function () {
        const username = $(this).attr('data-username');
        $(this).prop('disabled', true);
        try {
            await blocksApi('DELETE', { username });
        } catch ( err ) {
            fail(err);
            $(this).prop('disabled', false);
            holdFocus();
            return;
        }
        // They are unblocked now, whether or not the list reloads.
        $list.find('.dashboard-blocked-unblock').filter((_, el) => el.dataset.username === username)
            .closest('.dashboard-blocked-row').remove();
        if ( ! $list.children().length ) render([]);
        holdFocus();
        setStatus(t('blocked_removed', { username }), 'info');
        await refresh();
    });

    $dialog.on('click', '.dashboard-blocked-done', () => close());

    refresh();
    return { $dialog, close };
}
