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
import shareRecipientPicker from '../helpers/shareRecipientPicker.js';
import { share_key } from '../helpers/shareSuggest.js';
import {
    team_for_share, team_label, teams_for_sharing,
} from '../helpers/shareTeams.js';
import { share_link_for } from '../helpers/sharePaths.js';
import { is_plan_gate_error, open_upgrade_flow } from '../helpers/planGate.js';
import { with_verification_gate } from '../helpers/verification_gates.js';

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
 * @param {string} [options.uid] The item's uid, when the caller has it; saves
 *   the lookup the "copy link" button otherwise makes.
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
                 placeholder="${i18n('share_add_people')}" />`;
    h += `<select class="share-mode">${options_for('read', { allow_manage })}</select>`;
    h += '</div>';
    h += `<button class="share-btn button button-primary button-block button-normal">${i18n('share')}</button>`;

    // The owner's switch between people-only and anyone with the link. A
    // delegate passes access on to people; opening the item to everyone is
    // the owner's call, so nobody else gets the control.
    if ( allow_manage ) {
        h += '<div class="share-general-access">';
        h += `<div class="share-dialog-heading">${i18n('share_general_access')}</div>`;
        h += '<div class="share-dialog-row share-link-row">';
        h += `<select class="share-link-access" aria-label="${html_encode(i18n('share_general_access'))}">`;
        h += `<option value="restricted">${i18n('share_link_restricted')}</option>`;
        h += `<option value="anyone">${i18n('share_link_anyone')}</option>`;
        h += '</select>';
        h += `<select class="share-link-mode" aria-label="${html_encode(i18n('share_access_level'))}" hidden>${options_for('read', { allow_manage: false })}</select>`;
        h += '</div>';
        h += `<p class="share-link-note">${i18n('share_link_restricted_note')}</p>`;
        h += `<button class="share-copy-link button button-block button-normal" hidden>${i18n('share_copy_link')}</button>`;
        h += '</div>';
    }

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
        // The recipient field listens on the document to know when a click
        // landed outside its suggestions; that has to come off with the window.
        on_close: () => picker.destroy(),
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

    /** The item's own "anyone with the link" share as last listed, or null. */
    let link_share = null;
    /** The item's uid, which its link is built on; looked up once. */
    let item_uid = options.uid ?? null;

    const $recipient = $(el_window).find('.share-recipient');
    const $share_btn = $(el_window).find('.share-btn');

    // One field for every kind of recipient: a colleague, a whole team, someone
    // shared with before, or an address typed from scratch.
    const picker = shareRecipientPicker({
        $input: $recipient,
        $row: $recipient.closest('.share-dialog-row'),
        // Nobody already on the list below: offering them again would only
        // re-grant what the row next to it already shows.
        excluded: () => shown_shares.map(share_key).filter(Boolean),
        onChange: () => { $share_btn.prop('disabled', ! picker.recipient()); },
    });
    $share_btn.prop('disabled', true);

    const render = (shares) => {
        shown_shares = Array.isArray(shares) ? shares : [];
        row_teams.clear();
        // The item's own link share drives the general-access control rather
        // than a row; a delegate, who has no control, sees it as a row.
        link_share = shown_shares.find((share) => share.anyone && ! share.inheritedFrom) ?? null;
        const listed = shown_shares.filter((share) => ! (allow_manage && share.anyone && ! share.inheritedFrom));
        let rows = '';
        // The owner's access comes from owning the item, so it can't be revoked
        rows += '<div class="share-row">';
        rows += `<span class="share-row-who">${html_encode(item_owner)}${item_owner === window.user.username ? ` (${i18n('share_you')})` : ''}</span>`;
        rows += `<span class="share-row-owner">${i18n('share_owner')}</span>`;
        rows += '</div>';

        for ( const share of listed ) {
            const holder = share.anyone ? i18n('share_row_anyone') : html_encode(share.holder ?? '');
            if ( share.anyone && ! share.inheritedFrom ) {
                rows += '<div class="share-row share-row-inherited">';
                rows += `<span class="share-row-who">${holder}</span>`;
                rows += `<span class="share-row-mode">${mode_label(share.mode)}</span>`;
                rows += '</div>';
                continue;
            }
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
        if ( !listed.length ) {
            rows += `<p class="share-dialog-empty">${i18n('share_no_one')}</p>`;
        }
        $list.html(rows);
        render_link_access();
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

    // -- General access --

    const $link_access = $(el_window).find('.share-link-access');
    const $link_mode = $(el_window).find('.share-link-mode');
    const $link_note = $(el_window).find('.share-link-note');
    const $copy_link = $(el_window).find('.share-copy-link');

    /** Put the control where the listing says the item stands. */
    const render_link_access = () => {
        if ( ! allow_manage ) return;
        const on = link_share !== null;
        $link_access.val(on ? 'anyone' : 'restricted');
        $link_mode.prop('hidden', ! on);
        if ( on ) $link_mode.val(link_share.mode);
        $link_note.html(on
            ? i18n(link_share.mode === 'write' ? 'share_link_anyone_note_write' : 'share_link_anyone_note_read')
            : i18n('share_link_restricted_note'));
        $copy_link.prop('hidden', ! (on && item_uid));
    };

    /** Open the item to anyone with the link at `mode`, or close it with null. */
    const set_link_access = async (mode) => {
        $link_access.prop('disabled', true);
        $link_mode.prop('disabled', true);
        try {
            if ( mode ) {
                const created = await with_verification_gate(() => puter.fs.share({
                    path: item_path,
                    recipient: { anyone: true },
                    mode,
                }));
                item_uid ??= created?.[0]?.entryUid ?? null;
                show_success(i18n(mode === 'write' ? 'share_link_on_write' : 'share_link_on_read'));
            } else {
                await puter.fs.unshare(item_path, { anyone: true });
                show_success(i18n('share_link_off'));
            }
        } catch (e) {
            // A plan gate gets the flow that clears it, where the deployment
            // has one; a refusal is otherwise reported like any other.
            if ( is_plan_gate_error(e) ) {
                if ( ! open_upgrade_flow() ) show_error(i18n('share_link_requires_plan'));
            } else {
                show_error(e?.message ?? i18n('share_failed'));
            }
        } finally {
            $link_access.prop('disabled', false);
            $link_mode.prop('disabled', false);
        }
        // The listing is the truth either way, and it puts the control back.
        await refresh();
    };

    $link_access.on('change', function () {
        set_link_access($(this).val() === 'anyone' ? ($link_mode.val() || 'read') : null);
    });
    $link_mode.on('change', function () {
        set_link_access($(this).val());
    });
    $copy_link.on('click', async function () {
        if ( ! item_uid ) return;
        try {
            await window.copy_to_clipboard(share_link_for(
                { owner: item_owner, uid: item_uid, name: item_name },
                window.gui_origin,
            ));
            show_success(i18n('share_link_copied'));
        } catch (e) {
            show_error(e?.message ?? i18n('share_failed'));
        }
    });

    $(el_window).on('click', '.share-btn', async function () {
        // A team is named by uid; anything typed goes as-is, since a bare
        // string is what the backend reads as an email or a username.
        const chosen = picker.recipient();
        if ( ! chosen ) return;

        $(this).prop('disabled', true);
        try {
            const created = await with_verification_gate(() => puter.fs.share({
                path: item_path,
                recipient: chosen.value,
                mode: $(el_window).find('.share-mode').val(),
            }));
            picker.clear();
            $error.hide();
            // `i18n()` encodes its replacements; encoding first would show the
            // entities to anyone whose address or username contains one.
            show_success(
                i18n(SHARE_MESSAGE[share_outcome(created, shown_shares)], {
                    recipient: chosen.label,
                }),
            );
            picker.remember(chosen, created);
            invalidate_shared_roots();
            await refresh();
        } catch (e) {
            show_error(e?.message ?? i18n('share_failed'));
        } finally {
            $(this).prop('disabled', ! picker.recipient());
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
            await with_verification_gate(() => puter.fs.share({ path: item_path, recipient, mode }));
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

    // The uid the link is built on; the copy button waits for it.
    if ( allow_manage && ! item_uid ) {
        puter.fs.stat(item_path).then((stat) => {
            item_uid = stat?.uid ?? null;
            render_link_access();
        }).catch(() => { /* the button just stays hidden */ });
    }

    // Teams first: the access list names its rows from them, and the recipient
    // field suggests both them and the people in them.
    teams = await teams_for_sharing();
    picker.setTeams(teams);
    // Not the encoded form: an attribute set from JS shows entities literally.
    if ( teams.length ) $recipient.attr('placeholder', i18n('share_add_people_teams', [], false));
    await refresh();
    return el_window;
}

export default UIWindowShare;
