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

import path from '../../lib/path.js';
import item_icon from '../../helpers/itemIcon.js';
import { is_owned_by_me, owner_of_path } from '../../helpers/pathOwner.js';
import { invalidate_shared_roots } from '../../helpers/sharedAccess.js';
import { icons } from '../../helpers/actionIcons.js';
import { mode_label, options_for } from '../../helpers/shareModes.js';
import { isTouchPrimaryDevice } from './ContextMenu/ContextMenu.js';
import { avatarHue, avatarInitial } from './shareAvatar.js';
import {
    has_direct_share,
    mark_item_shared,
} from '../../helpers/sharedBadge.js';
import { share_outcome } from '../../helpers/shareOutcome.js';
import { aggregateOwners, aggregateShares, missingPathsFor } from './shareAggregate.js';

const { html_encode } = window;

const closeIcon = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
const chevronIcon = `<svg class="share-modal-chevron" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>`;

// How many item icons the header fans out before it stops adding to the pile.
const MAX_STACKED_ICONS = 3;

/** What each outcome of a share call is called on screen. */
const SHARE_MESSAGE = {
    invited: 'share_invited',
    shared: 'share_shared_with',
    updated: 'share_access_updated',
    unchanged: 'share_already_shared_with',
};

// What one /share, /share/revoke or listing pass may cover, matching the
// backend's documented cap (see doc: rate limits and quotas). Bigger
// selections are shared in several requests, and skip the access list rather
// than firing a listing per item.
const MAX_ITEMS_PER_REQUEST = 50;

/**
 * Splits `values` into runs of at most `size`.
 *
 * @template T
 * @param {T[]} values
 * @param {number} size
 * @returns {T[][]}
 */
const chunk = (values, size) => {
    const out = [];
    for ( let i = 0; i < values.length; i += size ) out.push(values.slice(i, i + size));
    return out;
};

const avatar_html = (name) => {
    return `<span class="share-modal-avatar" style="--share-avatar-hue: ${avatarHue(name)}" aria-hidden="true">${html_encode(avatarInitial(name))}</span>`;
};

// Distinguishes one open dialog's item list from another's, since the
// disclosure button points at it by id.
let modal_seq = 0;

/** "1 item" / "4 items", HTML-safe. */
const count_label = (count) => (count === 1
    ? i18n('items_count_one')
    : i18n('items_count_other', { count }));

/**
 * A responsive, from-scratch sharing modal for the Dashboard's Files tab.
 * Unlike UIWindowShare (which spawns a desktop UIWindow), this renders a
 * self-contained overlay that behaves as a centered card on desktop and a
 * bottom sheet on mobile, styled with the dashboard's design tokens.
 *
 * Shares one item or a whole selection. With several items the access list is
 * one row per person folded across them ({@link aggregateShares}), so every
 * action — grant, change, revoke — reads as a single decision about a person
 * rather than a chore repeated per file. A person who holds only some of the
 * selection says so, and can be extended to the rest in one click.
 *
 * Feature-equivalent to UIWindowShare: grant access by email or username,
 * list who has access (owner, direct grants, grants inherited from an
 * ancestor folder), change a grant's mode, and revoke — with the revoke
 * confirmation inlined into the row instead of a stacked alert window.
 *
 * @param {Object} opts
 * @param {Array<Object>} [opts.items] - The items to share, each
 *   `{ path, name?, owner?, fsentry?, icon? }`. Takes the place of the
 *   single-item fields below.
 * @param {string} [opts.path] - Full path of the one item to share
 * @param {string} [opts.name] - Display name; defaults to the path's basename
 * @param {string} [opts.owner] - Owner's username; defaults to the first path
 *   segment, which is not the current user when a `manage` recipient opens this
 * @param {Object} [opts.fsentry] - The item's fs entry, used to render its icon
 * @param {jQuery} [opts.$container] - Element to append the overlay to (defaults to <body>)
 * @returns {{ close: () => void }}
 */
export default function UIShareModal ({ items, path: item_path, name, owner, fsentry, $container }) {
    const $root = $container && $container.length ? $container : $('body');

    const targets = (items?.length ? items : [{ path: item_path, name, owner, fsentry }])
        .filter((item) => typeof item?.path === 'string' && item.path !== '')
        .map((item) => ({
            path: item.path,
            name: item.name ?? path.basename(item.path),
            owner: item.owner ?? owner_of_path(item.path) ?? window.user.username,
            fsentry: item.fsentry ?? null,
            icon: item.icon ?? null,
        }));
    const target_paths = targets.map((item) => item.path);
    const total = targets.length;
    // Strictest item decides: one borrowed item withholds it for the rest.
    const allow_manage = target_paths.every((p) => is_owned_by_me(p));
    const is_multi = total > 1;
    // Nothing to share: an empty selection is a caller's mistake, not a dialog.
    if ( total === 0 ) return { close: () => {} };
    const items_list_id = `share-modal-items-${++modal_seq}`;

    // The header names the one item, or the size of the pile with the names
    // folded into an expandable list below it.
    const title_name = is_multi ? count_label(total) : html_encode(targets[0].name);
    const names_summary = html_encode(targets.map((item) => item.name).join(', '));

    const header_sub = is_multi
        ? `<button type="button" class="share-modal-title-sub share-modal-items-toggle" aria-expanded="false"
                aria-controls="${items_list_id}" title="${names_summary}">
                <span class="share-modal-items-summary">${names_summary}</span>${chevronIcon}
            </button>`
        : `<span class="share-modal-title-sub">${i18n('share')}</span>`;

    const items_list = is_multi
        ? `<ul class="share-modal-items" id="${items_list_id}" hidden>${targets.map((item) => `
                <li class="share-modal-item">
                    <span class="share-modal-item-icon"></span>
                    <span class="share-modal-item-name enable-user-select">${html_encode(item.name)}</span>
                </li>`).join('')}</ul>`
        : '';

    const $overlay = $(`
        <div class="share-modal-overlay">
            <div class="share-modal" role="dialog" aria-modal="true" tabindex="-1" aria-label="${title_name} ${i18n('share')}">
                <div class="share-modal-header">
                    <div class="share-modal-title">
                        <span class="share-modal-title-icon${is_multi ? ' share-modal-title-stack' : ''}"></span>
                        <div class="share-modal-title-text">
                            <span class="share-modal-title-name enable-user-select">${title_name}</span>
                            ${header_sub}
                        </div>
                    </div>
                    <button type="button" class="share-modal-close" aria-label="${i18n('close')}" title="${i18n('close')}">${closeIcon}</button>
                </div>
                <div class="share-modal-body">
                    ${items_list}
                    <form class="share-modal-add" novalidate>
                        <div class="share-modal-add-row">
                            <input type="text" class="share-modal-recipient" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="send"
                                placeholder="${i18n('share_add_people')}" aria-label="${i18n('share_add_people')}" />
                            <select class="share-modal-mode" aria-label="${i18n('share_access_level')}">${options_for('read', { allow_manage })}</select>
                        </div>
                        <button type="submit" class="share-modal-submit" disabled>
                            <span class="share-modal-spinner" aria-hidden="true"></span>
                            <span class="share-modal-submit-label">${i18n('share')}</span>
                        </button>
                    </form>
                    <div class="share-modal-status" role="status" aria-live="polite"></div>
                    <h3 class="share-modal-heading">${i18n('share_who_has_access')}</h3>
                    <div class="share-modal-list" aria-busy="true">
                        <div class="share-modal-loading"><span class="share-modal-spinner" aria-hidden="true"></span></div>
                    </div>
                </div>
            </div>
        </div>
    `);

    $root.append($overlay);

    // Reveal after paint so the CSS transition (fade + scale/slide) runs.
    requestAnimationFrame(() => $overlay.addClass('share-modal-show'));

    const $status = $overlay.find('.share-modal-status');
    const $list = $overlay.find('.share-modal-list');
    const $recipient = $overlay.find('.share-modal-recipient');
    const $submit = $overlay.find('.share-modal-submit');

    // Focus returns to wherever the user was (usually the shared row) when
    // the modal closes. While it's up, the recipient input takes it on
    // desktop; on touch-primary devices the dialog itself does, because
    // focusing the input would pop the on-screen keyboard over the sheet
    // before the user has chosen what to do (add, change, or revoke).
    const el_previous_focus = document.activeElement;
    if ( isTouchPrimaryDevice() ) {
        $overlay.find('.share-modal').get(0)?.focus({ preventScroll: true });
    } else {
        $recipient.get(0)?.focus({ preventScroll: true });
    }

    let closed = false;
    const close = () => {
        if ( closed ) return;
        closed = true;
        $overlay.removeClass('share-modal-show');
        $(document).off('keydown.share-modal');
        setTimeout(() => $overlay.remove(), 200);
        if ( el_previous_focus && document.contains(el_previous_focus) ) {
            try {
                el_previous_focus.focus({ preventScroll: true });
            } catch { /* focus restoration is best-effort */ }
        }
    };

    // The last successfully aggregated access list, so canceling an inline
    // revoke confirmation can restore the row without another round-trip.
    let last_groups = [];
    const group_for = (key) => last_groups.find((group) => group.key === key);

    // Re-rendering the list replaces its nodes wholesale, and disabling a
    // focused control drops focus onto <body> — either would strand a
    // keyboard user outside the dialog, past the reach of the Tab trap.
    // Every action that does one of those puts focus back explicitly:
    // on the same person's control when it survives, else on the dialog.
    const focus_list_control = (selector, key) => {
        const $el = $list.find(selector).filter((_, el) => $(el).attr('data-key') === key);
        if ( !$el.length ) return false;
        $el.get(0).focus({ preventScroll: true });
        return true;
    };
    const focus_dialog = () => {
        $overlay.find('.share-modal').get(0)?.focus({ preventScroll: true });
    };

    // Both take HTML-safe text; `error_html` encodes the one raw source.
    const show_error = (html) => {
        $status
            .removeClass('share-modal-status-success')
            .addClass('share-modal-status-error')
            .html(html);
    };

    const show_success = (html) => {
        $status
            .removeClass('share-modal-status-error')
            .addClass('share-modal-status-success')
            .html(html);
    };

    const error_html = (err) => (err?.message
        ? html_encode(err.message)
        : (is_multi ? i18n('share_failed_items') : i18n('share_failed')));

    const clear_status = () => {
        $status.removeClass('share-modal-status-error share-modal-status-success').empty();
    };

    // -- Access list --

    /**
     * The muted second line under a person's name: how much of the selection
     * they reach, and anything about the grants the controls can't change.
     */
    const notes_for = (group) => {
        const notes = [];
        if ( group.accessCount < total ) {
            notes.push(i18n('share_coverage', { count: group.accessCount, total }));
        }
        if ( group.pendingPaths.length ) {
            notes.push(i18n('share_awaiting_signup'));
        }
        if ( group.inheritedFrom ) {
            notes.push(i18n('share_inherited_via', { folder: path.basename(group.inheritedFrom) }));
        } else if ( group.inheritedPaths.length ) {
            notes.push(i18n('share_inherited_via_count', { count: group.inheritedPaths.length }));
        }
        return notes;
    };

    const group_row_html = (group) => {
        const key = html_encode(group.key);
        const who = html_encode(group.name);
        const you = ! group.pending && group.name === window.user.username
            ? ` (${i18n('share_you')})`
            : '';
        // Only direct grants live on the items themselves; an inherited one
        // belongs to the ancestor folder and has to be changed there.
        const can_change = group.directPaths.length > 0;
        const can_revoke = can_change || group.pendingPaths.length > 0;
        // Extending someone needs a mode to extend; a person whose grants
        // disagree levels them with the select first.
        const missing = missingPathsFor(target_paths, group).length;
        const can_add_to_all = can_change && missing > 0 && group.mode !== null;

        // The clauses read as one muted line; the action keeps its own box on
        // it so a narrow sheet wraps it whole instead of orphaning a separator.
        const notes = notes_for(group);
        let via = '';
        if ( notes.length || can_add_to_all ) {
            via += `<span class="share-modal-row-via${can_add_to_all ? ' share-modal-row-via-wrap' : ''}">`;
            if ( notes.length ) via += `<span>${notes.join(' · ')}</span>`;
            if ( can_add_to_all ) {
                via += `<button type="button" class="share-modal-row-link" data-key="${key}"
                    aria-label="${i18n('share_add_to_all_for', { recipient: group.name, count: missing })}"
                    >${i18n('share_add_to_all')}</button>`;
            }
            via += '</span>';
        }

        let row = `<div class="share-modal-row${group.pending ? ' share-modal-row-pending' : ''}${can_change || group.pending ? '' : ' share-modal-row-inherited'}">`;
        row += avatar_html(group.name);
        row += '<span class="share-modal-row-who">';
        row += `<span class="share-modal-row-name enable-user-select">${who}${you}</span>`;
        row += via;
        row += '</span>';

        if ( can_change ) {
            // The accessible names carry the person: a list where every row
            // reads as bare "Access level" / "Remove access" leaves a screen
            // reader user unable to tell whose grant a control changes.
            row += `<select class="share-modal-row-mode" data-key="${key}" aria-label="${i18n('share_access_level_for', { recipient: group.name })}">${options_for(group.mode, { allow_manage })}</select>`;
        } else {
            const fixed_mode = group.pending ? group.pendingMode : group.inheritedMode;
            row += `<span class="share-modal-row-tag">${fixed_mode ? mode_label(fixed_mode) : i18n('share_access_mixed')}</span>`;
        }

        if ( can_revoke ) {
            const label = group.pending ? i18n('share_cancel_invite') : i18n('share_remove_access');
            const aria = group.pending
                ? i18n('share_cancel_invite_for', { recipient: group.name })
                : i18n('share_remove_access_for', { recipient: group.name });
            row += `<button type="button" class="share-modal-revoke" data-key="${key}" title="${label}" aria-label="${aria}">${icons.trash}</button>`;
        }
        row += '</div>';
        return row;
    };

    const render = (groups) => {
        last_groups = groups;
        let rows = '';

        // Ownership comes from owning the item, so it can't be revoked here.
        // A selection made in the Shared view can span owners.
        for ( const item_owner of aggregateOwners(targets.map((item) => item.owner)) ) {
            rows += '<div class="share-modal-row">';
            rows += avatar_html(item_owner.name);
            rows += '<span class="share-modal-row-who">';
            rows += `<span class="share-modal-row-name enable-user-select">${html_encode(item_owner.name)}${item_owner.name === window.user.username ? ` (${i18n('share_you')})` : ''}</span>`;
            if ( item_owner.count < total ) {
                rows += `<span class="share-modal-row-via">${i18n('share_coverage', { count: item_owner.count, total })}</span>`;
            }
            rows += '</span>';
            rows += `<span class="share-modal-row-tag">${i18n('share_owner')}</span>`;
            rows += '</div>';
        }

        for ( const group of groups ) {
            rows += group_row_html(group);
        }
        if ( !groups.length ) {
            rows += `<p class="share-modal-empty">${is_multi ? i18n('share_no_one_items') : i18n('share_no_one')}</p>`;
        }
        $list.attr('aria-busy', 'false').html(rows);
    };

    const refresh = async () => {
        // A listing per item stops being reasonable past the request cap, and
        // every action would re-run it. Say so instead of firing hundreds.
        if ( total > MAX_ITEMS_PER_REQUEST ) {
            last_groups = [];
            $list.attr('aria-busy', 'false')
                .html(`<p class="share-modal-empty">${i18n('share_access_list_too_many', { total })}</p>`);
            return;
        }

        // One listing per item: a slow or failed item must not hide the rest.
        const settled = await Promise.allSettled(
            target_paths.map((target) => puter.fs.getShares(target)),
        );
        if ( closed ) return;

        /** @type {Map<string, Object[]>} */
        const by_path = new Map();
        let failure = null;
        settled.forEach((result, index) => {
            if ( result.status === 'fulfilled' ) {
                by_path.set(target_paths[index], result.value);
            } else {
                failure ??= result.reason;
            }
        });

        if ( by_path.size === 0 ) {
            $list.attr('aria-busy', 'false').empty();
            show_error(error_html(failure));
            return;
        }
        // Each listing is authoritative for its own item.
        for ( const [target, shares] of by_path ) {
            mark_item_shared(target, has_direct_share(shares));
        }
        render(aggregateShares(target_paths, by_path));
        if ( failure ) show_error(i18n('share_load_partial_failed'));
    };

    // -- Dismissal wiring --
    $overlay.on('click', '.share-modal-close', close);
    // Backdrop close goes by where the press STARTED: a drag that begins in
    // the recipient input (text selection) and releases over the backdrop
    // registers its click on the overlay, and must not eat the typed name.
    let backdrop_pressed = false;
    $overlay.on('mousedown', function (e) {
        backdrop_pressed = e.target === $overlay[0];
    });
    $overlay.on('click', function (e) {
        if ( e.target === $overlay[0] && backdrop_pressed ) close();
    });
    $(document).on('keydown.share-modal', function (e) {
        if ( e.key !== 'Escape' ) return;
        // An open revoke confirmation swallows the first Escape.
        const $confirm = $list.find('.share-modal-row-confirm');
        if ( $confirm.length ) {
            const key = $confirm.attr('data-key');
            render(last_groups);
            focus_list_control('.share-modal-revoke', key) || focus_dialog();
            return;
        }
        close();
    });

    // Keep Tab cycling inside the dialog while it's up.
    $overlay.on('keydown', function (e) {
        if ( e.key !== 'Tab' ) return;
        const focusables = $overlay
            .find('button, input, select, [tabindex]:not([tabindex="-1"])')
            .filter(':visible:not(:disabled)');
        if ( !focusables.length ) return;
        const first = focusables.get(0);
        const last = focusables.get(focusables.length - 1);
        // Focus can legitimately sit on the dialog container (it takes focus
        // after a revoke removes the focused row); step into the cycle from
        // either end instead of letting Tab walk out of the dialog.
        if ( focusables.index(document.activeElement) === -1 ) {
            e.preventDefault();
            (e.shiftKey ? last : first).focus();
        } else if ( e.shiftKey && document.activeElement === first ) {
            e.preventDefault();
            last.focus();
        } else if ( !e.shiftKey && document.activeElement === last ) {
            e.preventDefault();
            first.focus();
        }
    });

    // -- Which items this is (best-effort icons, expandable list) --
    $overlay.on('click', '.share-modal-items-toggle', function () {
        const expanded = $(this).attr('aria-expanded') === 'true';
        $(this).attr('aria-expanded', expanded ? 'false' : 'true');
        $overlay.find('.share-modal-items').prop('hidden', expanded);
    });

    const paint_icons = () => {
        const stacked = targets.filter((item) => item.icon).slice(0, MAX_STACKED_ICONS);
        if ( stacked.length ) {
            $overlay.find('.share-modal-title-icon').html(
                stacked.map((item) => `<img src="${html_encode(item.icon)}" alt="">`).join(''),
            );
        }
        $overlay.find('.share-modal-item').each(function (index) {
            const icon = targets[index]?.icon;
            if ( icon ) $(this).find('.share-modal-item-icon').html(`<img src="${html_encode(icon)}" alt="">`);
        });
    };

    (async () => {
        await Promise.all(targets.map(async (item) => {
            if ( item.icon || ! item.fsentry ) return;
            try {
                item.icon = (await item_icon(item.fsentry))?.image ?? null;
            } catch { /* icon is best-effort */ }
        }));
        if ( ! closed ) paint_icons();
    })();

    // -- Grant access --

    // One request per run of MAX_ITEMS_PER_REQUEST, in series so a large
    // selection can't burst through the share rate limit. Resolves with every
    // grant that landed, the way a single call would.
    const grant_access = async (recipient, mode, paths) => {
        const created = [];
        for ( const run of chunk(paths, MAX_ITEMS_PER_REQUEST) ) {
            created.push(...(await puter.fs.share({ paths: run, recipient, mode }) ?? []));
        }
        return created;
    };

    const revoke_access = async (recipient, paths) => {
        for ( const run of chunk(paths, MAX_ITEMS_PER_REQUEST) ) {
            await puter.fs.unshare({ paths: run, recipient });
        }
    };

    /** "Shared with ann" / "Shared with ann on 4 items". */
    const shared_message = (recipient, count) => (count === 1
        ? i18n('share_shared_with', { recipient })
        : i18n('share_shared_with_items', { recipient, count }));

    $recipient.on('input', function () {
        $submit.prop('disabled', $(this).val().trim() === '');
        // Typing again retires a stale success/error message.
        clear_status();
    });

    $overlay.on('submit', '.share-modal-add', async function (e) {
        e.preventDefault();
        const recipient = $recipient.val().trim();
        if ( !recipient ) return;

        $submit.prop('disabled', true).addClass('share-modal-btn-busy');
        try {
            const created = await grant_access(
                recipient,
                $overlay.find('.share-modal-mode').val(),
                target_paths,
            );
            // Clear only what we sent; a name typed mid-flight shouldn't vanish.
            if ( $recipient.val().trim() === recipient ) $recipient.val('');
            $submit.prop('disabled', $recipient.val().trim() === '');
            // A pair the backend refused doesn't fail the others, so say how
            // many items actually landed rather than implying all of them did.
            const granted = created?.length ?? 0;
            // "Shared with" would claim access an invite does not grant.
            const invited = created?.some((share) => share.pending);
            if ( ! is_multi ) {
                // One item, so the list on screen settles what changed.
                const before = last_groups.map((group) => ({
                    holder: group.name,
                    mode: group.mode,
                }));
                show_success(
                    i18n(SHARE_MESSAGE[share_outcome(created, before)], {
                        recipient,
                    }),
                );
            } else if ( granted < total ) {
                show_success(i18n('share_shared_with_partial', { recipient, count: granted, total }));
            } else {
                show_success(invited
                    ? i18n('share_invited_items', { recipient, count: total })
                    : shared_message(recipient, total));
            }
            invalidate_shared_roots();
            await refresh();
            $recipient.get(0)?.focus({ preventScroll: true });
        } catch (err) {
            show_error(error_html(err));
            $submit.prop('disabled', false);
            // Disabling the clicked button dropped focus to <body>; put it
            // where the correction happens.
            $recipient.get(0)?.focus({ preventScroll: true });
        } finally {
            $submit.removeClass('share-modal-btn-busy');
        }
    });

    // -- Change a grant's mode, on every item the person already holds --
    $overlay.on('change', '.share-modal-row-mode', async function () {
        const key = $(this).attr('data-key');
        const group = group_for(key);
        const mode = $(this).val();
        if ( ! group || ! mode ) return;
        $(this).prop('disabled', true);
        try {
            await grant_access(group.name, mode, group.directPaths);
            show_success(group.directPaths.length > 1
                ? i18n('share_access_updated_items', { recipient: group.name, count: group.directPaths.length })
                : i18n('share_access_updated', { recipient: group.name }));
        } catch (err) {
            show_error(error_html(err));
        }
        invalidate_shared_roots();
        await refresh();
        focus_list_control('.share-modal-row-mode', key) || focus_dialog();
    });

    // -- Extend a partial grant to the rest of the selection --
    $overlay.on('click', '.share-modal-row-link', async function () {
        const key = $(this).attr('data-key');
        const group = group_for(key);
        if ( ! group || group.mode === null ) return;
        const missing = missingPathsFor(target_paths, group);
        if ( ! missing.length ) return;
        $(this).prop('disabled', true);
        try {
            const created = await grant_access(group.name, group.mode, missing);
            const granted = created?.length ?? 0;
            show_success(granted < missing.length
                ? i18n('share_shared_with_partial', { recipient: group.name, count: granted, total: missing.length })
                : shared_message(group.name, missing.length));
        } catch (err) {
            show_error(error_html(err));
        }
        invalidate_shared_roots();
        await refresh();
        // The link is gone once they hold everything; the mode select is the
        // nearest surviving control for the same person.
        focus_list_control('.share-modal-row-mode', key) || focus_dialog();
    });

    // -- Revoke, confirmed inline in the row --
    $overlay.on('click', '.share-modal-revoke', function () {
        const key = $(this).attr('data-key');
        const group = group_for(key);
        if ( ! group ) return;
        // An invitation is withdrawn, access is taken away; the prompt must
        // say which, and over how many items.
        const affected = group.pending ? group.pendingPaths.length : group.directPaths.length;
        let confirm_text;
        if ( group.pending ) {
            confirm_text = affected > 1
                ? i18n('share_confirm_cancel_invite_items', { recipient: group.name, count: affected })
                : i18n('share_confirm_cancel_invite', { recipient: group.name });
        } else if ( affected > 1 ) {
            confirm_text = i18n('share_confirm_remove_items', { recipient: group.name, count: affected });
        } else {
            // "this item" only reads right when the dialog is about one item.
            confirm_text = is_multi
                ? i18n('share_confirm_remove_plain', { recipient: group.name })
                : i18n('share_confirm_remove', { recipient: group.name });
        }

        // One confirmation at a time: opening a second one restores the first
        // row. The re-render replaces every row, so re-find this person's
        // instead of using the (now detached) clicked button.
        if ( $list.find('.share-modal-row-confirm').length ) {
            render(last_groups);
        }
        $list.find('.share-modal-revoke')
            .filter((_, el) => $(el).attr('data-key') === key)
            .closest('.share-modal-row')
            .replaceWith(`
            <div class="share-modal-row share-modal-row-confirm" data-key="${html_encode(key)}">
                <span class="share-modal-confirm-text">${confirm_text}</span>
                <span class="share-modal-confirm-actions">
                    <button type="button" class="share-modal-btn-quiet share-modal-confirm-cancel">${i18n('cancel')}</button>
                    <button type="button" class="share-modal-btn-danger share-modal-confirm-remove" data-key="${html_encode(key)}">${i18n('share_remove')}</button>
                </span>
            </div>
        `);
        $list.find('.share-modal-confirm-cancel').trigger('focus');
    });

    $overlay.on('click', '.share-modal-confirm-cancel', function () {
        const key = $(this).closest('.share-modal-row-confirm').attr('data-key');
        render(last_groups);
        focus_list_control('.share-modal-revoke', key) || focus_dialog();
    });

    $overlay.on('click', '.share-modal-confirm-remove', async function () {
        const key = $(this).attr('data-key');
        const group = group_for(key);
        if ( ! group ) return;
        // Only where they actually hold something: an inherited grant belongs
        // to the ancestor folder and isn't this dialog's to withdraw.
        const revoke_paths = group.pending ? group.pendingPaths : group.directPaths;
        $(this).closest('.share-modal-row-confirm').find('button').prop('disabled', true);
        try {
            await revoke_access(group.name, revoke_paths);
            if ( group.pending ) {
                show_success(i18n('share_invite_cancelled', { recipient: group.name }));
            } else {
                show_success(revoke_paths.length > 1
                    ? i18n('share_access_removed_items', { recipient: group.name, count: revoke_paths.length })
                    : i18n('share_access_removed', { recipient: group.name }));
            }
            invalidate_shared_roots();
            await refresh();
            // The focused row is gone; the dialog itself takes focus (the
            // input would pop the on-screen keyboard on touch devices).
            focus_dialog();
        } catch (err) {
            show_error(error_html(err));
            render(last_groups);
            focus_list_control('.share-modal-revoke', key) || focus_dialog();
        }
    });

    refresh();

    return { close };
}
