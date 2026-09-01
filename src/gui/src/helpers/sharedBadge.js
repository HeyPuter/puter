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
 * Whether a `getShares()` list means this item is shared.
 *
 * Inherited rows are access granted on a folder above, which is a state of that
 * folder — badging every file inside one would say the same thing on hundreds
 * of items. Matches `is_shared` from the backend, which is also direct-only.
 */
export const has_direct_share = (shares) =>
    Array.isArray(shares) &&
    shares.some((share) => share && ! share.inheritedFrom);

/**
 * Turn the badge on or off for every rendered copy of `path` — the same item
 * can be on the desktop and in any number of open windows.
 */
export const mark_item_shared = (path, is_shared) => {
    if ( ! path ) return;
    const $items = $('.item').filter(function() {
        return ($(this).attr('data-path') || '').toLowerCase() === path.toLowerCase();
    });
    $items.attr('data-is_shared', is_shared ? 1 : 0);
    $items
        .find('.item-shared-marker')
        .css('display', is_shared ? '' : 'none');
};
