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

import { owner_of_path } from './path_owner.js';
import { prime_shared_roots, shared_root_for } from './shared_access.js';

/**
 * What the directory bar shows for a path. Only the label changes — every
 * segment keeps the real path it navigates to.
 *
 * Someone else's tree is shown from the share down, so a recipient sees
 * `Shared › Contents › sub` rather than the owner's `jfcastro › Documents ›
 * Contents › sub`, which says where they keep it and what sits beside it.
 */

/**
 * @typedef {{label: string, path: string}} PathCrumb
 */

/**
 * @param {string} abs_path
 * @returns {PathCrumb[]|null} null when the path is the viewer's own
 */
export const shared_crumbs_for = (abs_path) => {
    if ( typeof abs_path !== 'string' || ! abs_path.startsWith('/') ) return null;

    const owner = owner_of_path(abs_path);
    if ( owner === null || owner === window.user?.username ) return null;

    // The exact cut needs the share listing; without it, fall back to showing
    // only the leaf so nothing above it leaks, and prime for the next render.
    const root = shared_root_for(abs_path);
    if ( ! root ) {
        prime_shared_roots();
        const leaf = abs_path.slice(abs_path.lastIndexOf('/') + 1);
        return [{ label: leaf, path: abs_path }];
    }

    const crumbs = [{ label: root.name ?? root.path.split('/').pop(), path: root.path }];
    if ( abs_path !== root.path ) {
        let cursor = root.path;
        for ( const segment of abs_path.slice(root.path.length + 1).split('/') ) {
            cursor += `/${segment}`;
            crumbs.push({ label: segment, path: cursor });
        }
    }
    return crumbs;
};
