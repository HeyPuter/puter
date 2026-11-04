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

/**
 * Where a path typed into the Files tab's path bar leads: `~` is the home
 * folder, and a relative path starts from the folder on screen.
 *
 * @param {string} typed
 * @param {{ currentPath: string, homePath: string, sharedPath: string }} places
 * @returns {string | undefined} An absolute path, the Shared view's path, or
 *   undefined when nothing was typed
 */
export function resolveTypedPath (typed, { currentPath, homePath, sharedPath }) {
    const text = typed.trim();
    if ( text === '' ) return undefined;
    if ( text.replace(/\/+$/, '') === sharedPath ) return sharedPath;
    if ( text === '~' || text.startsWith('~/') ) return path.resolve(homePath, `.${text.slice(1)}`);
    // The Shared view is a query, not a folder a relative path can start from.
    const base = currentPath?.startsWith('/') ? currentPath : homePath;
    return path.resolve(base, text);
}
