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
 * Items other people share with you arrive as `/{owner}/{uid}/{name}[/…]`.
 * The `{uid}` segment stands in for wherever the owner keeps the item, so the
 * path is addressable without saying anything about their folders.
 *
 * Everything here reads that shape directly. Nothing needs the share listing,
 * so it all works on a deep link or a restored window.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * @typedef {{owner: string, uid: string, segments: string[]}} SharedPathParts
 */

/**
 * @param {string} abs_path
 * @returns {SharedPathParts|null} null when the path is not a shared one
 */
export const parse_shared_path = (abs_path) => {
    if ( typeof abs_path !== 'string' || ! abs_path.startsWith('/') ) return null;
    const [owner, uid, ...segments] = abs_path.slice(1).split('/');
    if ( ! owner || ! uid || ! UUID.test(uid) ) return null;
    if ( segments.length === 0 ) return null;
    return { owner, uid, segments };
};

/**
 * The uids a list of shared paths names, in order and without repeats. Anything
 * that isn't a shared path falls away: a link's values are user-visible text, so
 * a hand-edited one must be ignored rather than become a lookup.
 *
 * @param {string[]} paths
 * @returns {string[]}
 */
export const shared_uids_from_paths = (paths) => {
    const uids = [];
    for ( const path of Array.isArray(paths) ? paths : [] ) {
        const uid = parse_shared_path(path)?.uid.toLowerCase();
        if ( uid && ! uids.includes(uid) ) uids.push(uid);
    }
    return uids;
};

/** The shared item itself, as opposed to something inside it. */
export const is_share_root = (abs_path) =>
    parse_shared_path(abs_path)?.segments.length === 1;

/**
 * Where the Up button goes. Above a shared item there is only the owner's own
 * folder, which is not yours to open — so the Shared view stands in for it.
 *
 * @param {string} abs_path
 * @returns {string}
 */
export const parent_path_for = (abs_path) => {
    if ( abs_path === window.shared_path ) return abs_path;
    if ( is_share_root(abs_path) ) return window.shared_path;
    const parent = abs_path.slice(0, abs_path.lastIndexOf('/'));
    return parent === '' ? '/' : parent;
};

/**
 * @typedef {{label: string, path: string}} PathCrumb
 */

/**
 * What the directory bar shows for a path. Only the label changes — every
 * segment keeps the real path it navigates to.
 *
 * @param {string} abs_path
 * @returns {PathCrumb[]|null} null when the path is the viewer's own
 */
export const shared_crumbs_for = (abs_path) => {
    const parts = parse_shared_path(abs_path);
    if ( ! parts || parts.owner === window.user?.username ) return null;

    let cursor = `/${parts.owner}/${parts.uid}`;
    return parts.segments.map((segment) => {
        cursor += `/${segment}`;
        return { label: segment, path: cursor };
    });
};
