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
 * This file contains functions that are used by Puter's desktop GUI.
 * Functions moved here are not bound to the `window` object, making it
 * easier to write unit tests for them.
 *
 * Functions here may be bound to `window` at any of the following locations:
 * - src/gui/src/initgui.js
 *
 * ^ Please add to the above list as necessary when moving functions here.
 */

/**
 * Converts a file system path to a privacy-aware path.
 * - Paths starting with `~/` are returned unchanged.
 * - Paths starting with the user's home path are replaced with `~`.
 * - Absolute paths not starting with the user's home path are returned unchanged.
 * - Relative paths are prefixed with `~/`.
 * - Other paths are returned unchanged.
 *
 * @param {string} fspath - The file system path to be converted.
 * @returns {string} The privacy-aware path.
 */
export const privacy_aware_path = world => function privacy_aware_path (fspath) {
    // e.g. /my_username/test.txt -> ~/test.txt
    if ( fspath.startsWith('~/') )
    {
        return fspath;
    }
    // e.g. /my_username/test.txt -> ~/test.txt
    else if ( fspath.startsWith(world.window.home_path.endsWith('/')
        ? world.window.home_path
        : `${world.window.home_path }/`) )
    {
        return fspath.replace(world.window.home_path, '~');
    }
    // e.g. /other_username/test.txt -> /other_username/test.txt
    else if ( fspath.startsWith('/') && !fspath.startsWith(world.window.home_path) )
    {
        return fspath;
    }
    // e.g. test.txt -> ~/test.txt
    else if ( ! fspath.startsWith('/') )
    {
        return `~/${ fspath}`;
    }
    // e.g. /username/path/to/item -> /username/path/to/item
    else
    {
        return fspath;
    }
};
