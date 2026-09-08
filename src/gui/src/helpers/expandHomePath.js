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
