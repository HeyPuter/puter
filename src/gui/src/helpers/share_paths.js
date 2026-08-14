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
 * The client half of the `~/share/<uid>/…` addresses the backend hands out for
 * anything reached through a share. Mirrors `services/fs/sharePaths.ts`.
 */

const SHARE_ROOT = '~/share';
const UID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * @param {string} p
 * @returns {boolean}
 */
export const is_share_path = (p) => {
    if ( typeof p !== 'string' || ! p.startsWith(`${SHARE_ROOT}/`) ) return false;
    return UID.test(p.slice(SHARE_ROOT.length + 1).split('/')[0] ?? '');
};

/**
 * Where "up" leads from `p`. A shared root's parent is the Shared view rather
 * than `~/share`, which is an address the backend does not serve.
 *
 * @param {string} p
 * @param {(p: string) => string} resolve fallback for ordinary paths
 * @returns {string}
 */
export const parent_path_for = (p, resolve) => {
    if ( ! is_share_path(p) ) return resolve(p);
    const rest = p.slice(SHARE_ROOT.length + 1);
    return rest.includes('/') ? resolve(p) : window.shared_path;
};
