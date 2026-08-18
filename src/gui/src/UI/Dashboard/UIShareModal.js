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
import item_icon from '../../helpers/item_icon.js';
import { owner_of_path } from '../../helpers/path_owner.js';
import { invalidate_shared_roots } from '../../helpers/shared_access.js';
import { icons } from '../../helpers/actionIcons.js';
import { mode_label, options_for } from '../../helpers/share_modes.js';
import { isTouchPrimaryDevice } from './ContextMenu/ContextMenu.js';
import { avatarHue, avatarInitial } from './shareAvatar.js';

const { html_encode } = window;

const closeIcon = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

const avatar_html = (name) => {
    return `<span class="share-modal-avatar" style="--share-avatar-hue: ${avatarHue(name)}" aria-hidden="true">${html_encode(avatarInitial(name))}</span>`;
};

/**
 * A responsive, from-scratch sharing modal for the Dashboard's Files tab.
 * Unlike UIWindowShare (which spawns a desktop UIWindow), this renders a
 * self-contained overlay that behaves as a centered card on desktop and a
 * bottom sheet on mobile, styled with the dashboard's design tokens.
 *
 * Feature-equivalent to UIWindowShare: grant access by email or username,
 * list who has access (owner, direct grants, grants inherited from an
 * ancestor folder), change a grant's mode, and revoke — with the revoke
 * confirmation inlined into the row instead of a stacked alert window.
 *
 * @param {Object} opts
 * @param {string} opts.path - Full path of the item to share
 * @param {string} [opts.name] - Display name; defaults to the path's basename
 * @param {string} [opts.owner] - Owner's username; defaults to the first path
 *   segment, which is not the current user when a `manage` recipient opens this
 * @param {Object} [opts.fsentry] - The item's fs entry, used to render its icon
 * @param {jQuery} [opts.$container] - Element to append the overlay to (defaults to <body>)
 * @returns {{ close: () => void }}
 */
export default function UIShareModal ({ path: item_path, name, owner, fsentry, $container }) {
    const $root = $container && $container.length ? $container : $('body');
    const item_name = name ?? path.basename(item_path);
    const item_owner = owner ?? owner_of_path(item_path) ?? window.user.username;

    const $overlay = $(`
        <div class="share-modal-overlay">
            <div class="share-modal" role="dialog" aria-modal="true" tabindex="-1" aria-label="${html_encode(item_name)} ${i18n('share')}">
                <div class="share-modal-header">
                    <div class="share-modal-title">
                        <span class="share-modal-title-icon"></span>
                        <div class="share-modal-title-text">
                            <span class="share-modal-title-name enable-user-select">${html_encode(item_name)}</span>
                            <span class="share-modal-title-sub">${i18n('share')}</span>
                        </div>
                    </div>
                    <button type="button" class="share-modal-close" aria-label="${i18n('close')}" title="${i18n('close')}">${closeIcon}</button>
                </div>
                <div class="share-modal-body">
                    <form class="share-modal-add" novalidate>
                        <div class="share-modal-add-row">
                            <input type="text" class="share-modal-recipient" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="send"
                                placeholder="${i18n('share_add_people')}" aria-label="${i18n('share_add_people')}" />
                            <select class="share-modal-mode" aria-label="${i18n('share_access_level')}">${options_for('read')}</select>
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

    // The last successfully fetched share list, so canceling an inline revoke
    // confirmation can restore the row without another network round-trip.
    let last_shares = [];

    // Re-rendering the list replaces its nodes wholesale, and disabling a
    // focused control drops focus onto <body> — either would strand a
    // keyboard user outside the dialog, past the reach of the Tab trap.
    // Every action that does one of those puts focus back explicitly:
    // on the same holder's control when it survives, else on the dialog.
    const focus_list_control = (selector, holder) => {
        const $el = $list.find(selector)
            .filter((_, el) => $(el).attr('data-holder') === holder);
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

    const error_html = (err) => (err?.message ? html_encode(err.message) : i18n('share_failed'));

    const clear_status = () => {
        $status.removeClass('share-modal-status-error share-modal-status-success').empty();
    };

    const render = (shares) => {
        last_shares = shares;
        let rows = '';

        // The owner's access comes from owning the item, so it can't be revoked
        rows += '<div class="share-modal-row">';
        rows += avatar_html(item_owner);
        rows += `<span class="share-modal-row-who"><span class="share-modal-row-name enable-user-select">${html_encode(item_owner)}${item_owner === window.user.username ? ` (${i18n('share_you')})` : ''}</span></span>`;
        rows += `<span class="share-modal-row-tag">${i18n('share_owner')}</span>`;
        rows += '</div>';

        for ( const share of shares ) {
            const holder = html_encode(share.holder ?? '');
            const you_suffix = share.holder === window.user.username ? ` (${i18n('share_you')})` : '';
            if ( share.inheritedFrom ) {
                // Granted on an ancestor, so it can only be changed there
                rows += '<div class="share-modal-row share-modal-row-inherited">';
                rows += avatar_html(share.holder ?? '');
                rows += `<span class="share-modal-row-who"><span class="share-modal-row-name enable-user-select">${holder}${you_suffix}</span><span class="share-modal-row-via">${i18n('share_inherited_via', { folder: path.basename(share.inheritedFrom) })}</span></span>`;
                rows += `<span class="share-modal-row-tag">${mode_label(share.mode)}</span>`;
                rows += '</div>';
                continue;
            }
            if ( share.pending ) {
                // Invited by email with no account yet: nothing to change until they join.
                const invited = share.recipientEmail ?? '';
                rows += '<div class="share-modal-row share-modal-row-pending">';
                rows += avatar_html(invited);
                rows += `<span class="share-modal-row-who"><span class="share-modal-row-name enable-user-select">${html_encode(invited)}</span><span class="share-modal-row-via">${i18n('share_awaiting_signup')}</span></span>`;
                rows += `<span class="share-modal-row-tag">${mode_label(share.mode)}</span>`;
                rows += `<button type="button" class="share-modal-revoke" data-holder="${html_encode(invited)}" title="${i18n('share_cancel_invite')}" aria-label="${i18n('share_cancel_invite_for', { recipient: invited })}">${icons.trash}</button>`;
                rows += '</div>';
                continue;
            }
            rows += '<div class="share-modal-row">';
            rows += avatar_html(share.holder ?? '');
            rows += `<span class="share-modal-row-who"><span class="share-modal-row-name enable-user-select">${holder}${you_suffix}</span></span>`;
            // The accessible names carry the holder: a list where every row
            // reads as bare "Access level" / "Remove access" leaves a screen
            // reader user unable to tell whose grant a control changes.
            rows += `<select class="share-modal-row-mode" data-holder="${holder}" aria-label="${i18n('share_access_level_for', { recipient: share.holder ?? '' })}">${options_for(share.mode)}</select>`;
            rows += `<button type="button" class="share-modal-revoke" data-holder="${holder}" title="${i18n('share_remove_access')}" aria-label="${i18n('share_remove_access_for', { recipient: share.holder ?? '' })}">${icons.trash}</button>`;
            rows += '</div>';
        }
        if ( !shares.length ) {
            rows += `<p class="share-modal-empty">${i18n('share_no_one')}</p>`;
        }
        $list.attr('aria-busy', 'false').html(rows);
    };

    const refresh = async () => {
        try {
            render(await puter.fs.getShares(item_path));
        } catch (e) {
            $list.attr('aria-busy', 'false').empty();
            show_error(error_html(e));
        }
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
            const holder = $confirm.attr('data-holder');
            render(last_shares);
            focus_list_control('.share-modal-revoke', holder) || focus_dialog();
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

    // -- Item icon (best-effort) --
    if ( fsentry ) {
        (async () => {
            try {
                const icon = await item_icon(fsentry);
                if ( !closed && icon?.image ) {
                    $overlay.find('.share-modal-title-icon')
                        .html(`<img src="${html_encode(icon.image)}" alt="">`);
                }
            } catch { /* icon is best-effort */ }
        })();
    }

    // -- Grant access --
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
            const created = await puter.fs.share({
                path: item_path,
                recipient,
                mode: $overlay.find('.share-modal-mode').val(),
            });
            // Clear only what we sent; a name typed mid-flight shouldn't vanish.
            if ( $recipient.val().trim() === recipient ) $recipient.val('');
            $submit.prop('disabled', $recipient.val().trim() === '');
            // "Shared with" would claim access an invite does not grant.
            show_success(
                created?.some((share) => share.pending)
                    ? i18n('share_invited', { recipient })
                    : i18n('share_shared_with', { recipient }),
            );
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

    // -- Change a grant's mode --
    $overlay.on('change', '.share-modal-row-mode', async function () {
        const holder = $(this).attr('data-holder');
        const mode = $(this).val();
        $(this).prop('disabled', true);
        try {
            await puter.fs.share({ path: item_path, recipient: holder, mode });
            show_success(i18n('share_access_updated', { recipient: holder }));
            invalidate_shared_roots();
            await refresh();
        } catch (err) {
            show_error(error_html(err));
            invalidate_shared_roots();
            await refresh();
        }
        focus_list_control('.share-modal-row-mode', holder) || focus_dialog();
    });

    // -- Revoke, confirmed inline in the row --
    $overlay.on('click', '.share-modal-revoke', function () {
        const holder = $(this).attr('data-holder');
        const enc = html_encode(holder);
        // Withdrawing an invitation isn't taking access away; the prompt must say which.
        const is_pending = $(this).closest('.share-modal-row').hasClass('share-modal-row-pending');
        // One confirmation at a time: opening a second one restores the first
        // row. The re-render replaces every row, so re-find this holder's
        // instead of using the (now detached) clicked button.
        if ( $list.find('.share-modal-row-confirm').length ) {
            render(last_shares);
        }
        $list.find('.share-modal-revoke')
            .filter((_, el) => $(el).attr('data-holder') === holder)
            .closest('.share-modal-row')
            .replaceWith(`
            <div class="share-modal-row share-modal-row-confirm" data-holder="${enc}">
                <span class="share-modal-confirm-text">${is_pending ? i18n('share_confirm_cancel_invite', { recipient: holder }) : i18n('share_confirm_remove', { recipient: holder })}</span>
                <span class="share-modal-confirm-actions">
                    <button type="button" class="share-modal-btn-quiet share-modal-confirm-cancel">${i18n('cancel')}</button>
                    <button type="button" class="share-modal-btn-danger share-modal-confirm-remove" data-holder="${enc}" data-pending="${is_pending}">${i18n('share_remove')}</button>
                </span>
            </div>
        `);
        $list.find('.share-modal-confirm-cancel').trigger('focus');
    });

    $overlay.on('click', '.share-modal-confirm-cancel', function () {
        const holder = $(this).closest('.share-modal-row-confirm').attr('data-holder');
        render(last_shares);
        focus_list_control('.share-modal-revoke', holder) || focus_dialog();
    });

    $overlay.on('click', '.share-modal-confirm-remove', async function () {
        const holder = $(this).attr('data-holder');
        const is_pending = $(this).attr('data-pending') === 'true';
        $(this).closest('.share-modal-row-confirm').find('button').prop('disabled', true);
        try {
            await puter.fs.unshare(item_path, holder);
            show_success(is_pending
                ? i18n('share_invite_cancelled', { recipient: holder })
                : i18n('share_access_removed', { recipient: holder }));
            invalidate_shared_roots();
            await refresh();
            // The focused row is gone; the dialog itself takes focus (the
            // input would pop the on-screen keyboard on touch devices).
            focus_dialog();
        } catch (err) {
            show_error(error_html(err));
            render(last_shares);
            focus_list_control('.share-modal-revoke', holder) || focus_dialog();
        }
    });

    refresh();

    return { close };
}
