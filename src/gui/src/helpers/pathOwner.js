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
 * Owner of an item, read off its path — Puter paths are `/{username}/…`.
 *
 * @param {string} path
 * @returns {string|null} null when the path names no owner (relative, or `/`).
 */
export const owner_of_path = (path) =>
    typeof path === 'string' ? path.split('/').filter(Boolean)[0] ?? null : null;

/**
 * Whether the signed-in user owns the item at `path`.
 *
 * Works however the item was reached, which the `data-shared_with_me` marker
 * does not: that is only set on rows the Shared view itself listed, so an item
 * opened *inside* a shared folder arrives looking like one of your own.
 * Unknown ownership counts as yours, leaving ordinary paths untouched.
 *
 * @param {string} path
 * @returns {boolean}
 */
export const is_owned_by_me = (path) => {
    const owner = owner_of_path(path);
    return owner === null || owner === window.user?.username;
};

/**
 * Trash an item belongs in — its owner's, not yours.
 *
 * @param {string} path
 * @param {string} [owner] username from the entry, when known
 * @returns {string}
 */
export const trash_path_for = (path, owner) => {
    const from_path = path?.startsWith('~') ? null : owner_of_path(path);
    return `/${owner || from_path || window.user?.username}/Trash`;
};
