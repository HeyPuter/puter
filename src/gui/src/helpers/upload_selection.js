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

/**
 * Selection of freshly-uploaded items in UIItem containers — the desktop,
 * explorer windows, and file dialogs.
 *
 * An upload finishes through two independent channels: the batch HTTP
 * response (the upload's `success` callback) and per-item `item.added`
 * socket events, which are what actually create the item elements. Either
 * can arrive first, so selection is applied from both sides:
 * `select_uploaded_items` selects the elements that already exist and
 * remembers the rest; `select_added_item_if_pending` picks those up when
 * the socket event creates their element.
 */

// Uploaded paths (lowercased — path matching is case-insensitive throughout
// the GUI) still waiting for their `item.added` element. Entries expire so
// an event that never arrives can't select an unrelated item created at the
// same path much later.
const pending_selection_paths = new Map();
const PENDING_SELECTION_TTL = 10_000;

const prune_pending = () => {
    const now = Date.now();
    for ( const [item_path, expiry] of pending_selection_paths ) {
        if ( expiry <= now ) {
            pending_selection_paths.delete(item_path);
        }
    }
};

// Selection side effects that normally happen in UIItem's click handlers:
// the explorer footer's "N items selected" line and, in open-file dialogs,
// the Open button (enabled only when a file — not a directory — is selected).
const apply_selection_side_effects = (el_container) => {
    const $el_window = $(el_container).closest('.window');
    if ( $el_window.length === 0 ) {
        return;
    }
    window.update_explorer_footer_selected_items_count($el_window);
    if ( $el_window.attr('data-is_openFileDialog') === 'true' ) {
        const file_is_selected = $el_window.find('.item-selected[data-is_dir="0"]').length > 0;
        $el_window.find('.openfiledialog-open-btn').toggleClass('disabled', !file_is_selected);
    }
};

/**
 * Replace the selection in every item container showing `dest_path` with
 * the just-uploaded items. Items whose `item.added` event hasn't landed yet
 * are remembered and selected on arrival.
 *
 * Paths are compared (not queried by selector) so names containing selector
 * metacharacters or HTML-encodable characters still match.
 *
 * @param {string} dest_path directory the items were uploaded to
 * @param {string[]} uploaded_paths full paths of the uploaded items
 */
export const select_uploaded_items = (dest_path, uploaded_paths) => {
    const wanted = new Set(uploaded_paths.map(p => String(p).toLowerCase()));
    if ( wanted.size === 0 ) {
        return;
    }

    const dest = String(dest_path).toLowerCase();
    const found = new Set();
    $('.item-container').filter(function () {
        return String($(this).attr('data-path') ?? '').toLowerCase() === dest;
    }).each(function () {
        const el_container = this;
        let el_first_selected = null;
        $(el_container).children('.item-selected').removeClass('item-selected');
        $(el_container).children('.item').each(function () {
            const item_path = String($(this).attr('data-path') ?? '').toLowerCase();
            if ( ! wanted.has(item_path) ) {
                return;
            }
            found.add(item_path);
            if ( ! $(this).hasClass('item-disabled') ) {
                $(this).addClass('item-selected');
                el_first_selected ??= this;
            }
        });
        apply_selection_side_effects(el_container);
        el_first_selected?.scrollIntoView({ block: 'nearest' });
    });

    prune_pending();
    const expiry = Date.now() + PENDING_SELECTION_TTL;
    for ( const item_path of wanted ) {
        if ( ! found.has(item_path) ) {
            pending_selection_paths.set(item_path, expiry);
        }
    }
};

/**
 * Select a just-created item element if its path was registered by
 * `select_uploaded_items` before the element existed. Adds to the current
 * selection rather than replacing it — the replacement already happened
 * when the upload finished.
 *
 * @param {object} item fsentry from the `item.added` event
 * @param {JQuery} $containers item containers the element was just added to
 */
export const select_added_item_if_pending = (item, $containers) => {
    prune_pending();
    if ( ! pending_selection_paths.delete(String(item.path).toLowerCase()) ) {
        return;
    }
    const uid = item.overwritten_uid || item.uid;
    $containers.each(function () {
        const $el_item = $(this).children(`.item[data-uid='${uid}']`).not('.item-disabled');
        if ( $el_item.length === 0 ) {
            return;
        }
        $el_item.addClass('item-selected');
        apply_selection_side_effects(this);
    });
};
