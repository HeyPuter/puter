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

import path from '../lib/path.js';

/**
 * Expands a user-facing path into the absolute path the filesystem API takes:
 * `~` and `~/x` resolve under the user's home, a bare relative path is read as
 * home-relative, and an absolute path is left alone. The inverse of
 * `privacy_aware_path` in util/desktop.js.
 *
 * @param {string} fspath - the path to expand, e.g. `~/Documents/report.docx`
 * @param {string} home_path - the user's home path, e.g. `/alice`
 * @returns {string} the absolute path, or `fspath` unchanged if either
 *   argument isn't a usable string
 */
export const expand_home_path = (fspath, home_path) => {
    if ( typeof fspath !== 'string' || fspath === '' ) return fspath;
    if ( typeof home_path !== 'string' || home_path === '' ) return fspath;

    const home = home_path.endsWith('/') ? home_path.slice(0, -1) : home_path;

    if ( fspath === '~' ) return home;
    if ( fspath.startsWith('~/') ) return home + fspath.slice(1);
    if ( fspath.startsWith('/') ) return fspath;
    return `${home}/${fspath}`;
};

/**
 * Turns what a user typed into an address bar into the canonical absolute
 * path: trimmed, home-expanded, with `.`/`..`, doubled and trailing slashes
 * resolved. An empty entry keeps the current path.
 *
 * @param {string} typed_path - the raw text the user entered
 * @param {{ current_path: string, home_path: string, shared_path: string }} context
 * @returns {string} the path to navigate to
 */
export const resolve_typed_path = (typed_path, { current_path, home_path, shared_path }) => {
    const trimmed = typeof typed_path === 'string' ? typed_path.trim() : '';
    if ( trimmed === '' ) return current_path;
    // The Shared view is a pseudo-path, not a filesystem one.
    if ( trimmed === shared_path ) return shared_path;
    return path.resolve('/', expand_home_path(trimmed, home_path));
};
