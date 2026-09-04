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
import { is_owned_by_me, owner_of_path } from '../helpers/pathOwner.js';
import { invalidate_shared_roots } from '../helpers/sharedAccess.js';
import { icons } from '../helpers/actionIcons.js';
import { mode_label, options_for } from '../helpers/shareModes.js';
import { has_direct_share, mark_item_shared } from '../helpers/sharedBadge.js';
import { share_outcome } from '../helpers/shareOutcome.js';
import {
    team_for_share, team_label, teams_for_sharing,
} from '../helpers/shareTeams.js';

/** What each outcome of a share call is called on screen. */
const SHARE_MESSAGE = {
    invited: 'share_invited',
    shared: 'share_shared_with',
    updated: 'share_access_updated',
    unchanged: 'share_already_shared_with',
};

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
    // A delegate passes on access, never the authority to pass it on.
    const allow_manage = is_owned_by_me(item_path);

    let h = '';
    h += '<div class="share-dialog">';
    h += '<div class="form-error-msg"></div>';
    h += '<div class="form-success-msg"></div>';

    h += `<label for="share-recipient">${i18n('share_with')}</label>`;
    h += '<div class="share-dialog-row">';
    h += `<input class="share-recipient" id="share-recipient" type="text" autocomplete="off" spellcheck="false"
                 placeholder="${html_encode(i18n('share_add_people'))}" />`;
    h += `<select class="share-mode">${options_for('read', { allow_manage })}</select>`;
    h += '</div>';
    h += `<button class="share-btn button button-primary button-block button-normal">${i18n('share')}</button>`;

    // A team can't be typed into the field above: a bare string there is
    // already read as an email or a username, so it needs its own control.
    h += '<div class="share-team" style="display:none;">';
    h += `<label for="share-team-select">${i18n('share_with_team')}</label>`;
    h += '<div class="share-dialog-row">';
    h += '<select class="share-team-select" id="share-team-select"></select>';
    h += `<select class="share-team-mode">${options_for('read', { allow_manage })}</select>`;
    h += '</div>';
    h += `<p class="share-team-note">${i18n('share_team_note')}</p>`;
    h += `<button class="share-team-btn button button-block button-normal">${i18n('share')}</button>`;
    h += '</div>';

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

    /** The access list as last drawn, which is what a share call changes. */
    let shown_shares = [];

    /** The caller's teams, offered as recipients. */
    let teams = [];

    /** The team behind each `data-team` row as last drawn. */
    const row_teams = new Map();

    const render_team_picker = () => {
        if ( ! teams.length ) return;
        const options = teams
            .map(team => `<option value="${html_encode(team.uid)}">${html_encode(team_label(team))}</option>`)
            .join('');
        $(el_window).find('.share-team-select').html(options);
        $(el_window).find('.share-team').show();
    };

    const render = (shares) => {
        shown_shares = Array.isArray(shares) ? shares : [];
        row_teams.clear();
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
            // A team holds the share itself, so the row has no username to
            // key on; `data-team` carries the uid the handlers address it by.
            const team = team_for_share(teams, share);
            if ( team ) row_teams.set(team.uid, team);
            const key = team
                ? `data-team="${html_encode(team.uid)}"`
                : `data-holder="${holder}"`;
            rows += `<div class="share-row${team ? ' share-row-team' : ''}">`;
            rows += `<span class="share-row-who">${team ? html_encode(team_label(team)) : holder}</span>`;
            if ( team ) rows += `<span class="share-row-via">${i18n('share_row_team')}</span>`;
            rows += `<select class="share-row-mode-select" ${key}>${options_for(share.mode, { allow_manage })}</select>`;
            rows += `<button class="share-revoke" ${key} title="${html_encode(i18n('share_remove_access'))}" aria-label="${html_encode(i18n('share_remove_access'))}">${icons.trash}</button>`;
            rows += '</div>';
        }
        if ( !shares.length ) {
            rows += `<p class="share-dialog-empty">${i18n('share_no_one')}</p>`;
        }
        $list.html(rows);
        // Every share, mode change and revoke lands here.
        mark_item_shared(item_path, has_direct_share(shares));
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
            // `i18n()` encodes its replacements; encoding first would show the
            // entities to anyone whose address or username contains one.
            show_success(
                i18n(SHARE_MESSAGE[share_outcome(created, shown_shares)], {
                    recipient,
                }),
            );
            invalidate_shared_roots();
            await refresh();
        } catch (e) {
            show_error(e?.message ?? i18n('share_failed'));
        } finally {
            $(this).prop('disabled', false);
        }
    });

    $(el_window).on('click', '.share-team-btn', async function () {
        const uid = $(el_window).find('.share-team-select').val();
        const team = teams.find(t => t.uid === uid);
        if ( ! team ) return;

        $(this).prop('disabled', true);
        try {
            // The object form, not a string: a `team:`-style prefix would
            // change how an already-released spelling is read.
            const created = await puter.fs.share({
                path: item_path,
                recipient: { team: team.uid },
                mode: $(el_window).find('.share-team-mode').val(),
            });
            $error.hide();
            show_success(
                i18n(SHARE_MESSAGE[share_outcome(created, shown_shares)], {
                    recipient: team_label(team),
                }),
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
        const team = row_teams.get($(this).attr('data-team'));
        const holder = $(this).attr('data-holder');
        const recipient = team ? { team: team.uid } : holder;
        const name = team ? team_label(team) : holder;
        const mode = $(this).val();
        $(this).prop('disabled', true);
        try {
            await puter.fs.share({ path: item_path, recipient, mode });
            show_success(i18n('share_access_updated', { recipient: name }));
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
        const team = row_teams.get($(this).attr('data-team'));
        // Losing a team's access is losing everyone in it at once, which
        // the ordinary "remove {recipient}" wording would understate.
        const removed_name = team ? team_label(team) : holder;
        const confirmed = await UIAlert({
            message: is_pending
                ? i18n('share_confirm_cancel_invite', { recipient: holder })
                : i18n(team ? 'share_confirm_remove_team' : 'share_confirm_remove', { recipient: removed_name }),
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
            await puter.fs.unshare(item_path, team ? { team: team.uid } : holder);
            // `i18n()` encodes what it returns, replacements included, so the
            // raw value goes in — encoding first would show the entities to
            // anyone whose address or username contains one.
            show_success(
                is_pending
                    ? i18n('share_invite_cancelled', { recipient: holder })
                    : i18n('share_access_removed', { recipient: removed_name }),
            );
            invalidate_shared_roots();
            await refresh();
        } catch (e) {
            show_error(e?.message ?? i18n('share_failed'));
            $(this).prop('disabled', false);
        }
    });

    // Teams first: the access list names its rows from them.
    teams = await teams_for_sharing();
    render_team_picker();
    await refresh();
    return el_window;
}

export default UIWindowShare;
