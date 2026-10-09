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
 * Turns an archive entry name into a path relative to the extract folder.
 * Leading slashes and `.` segments are dropped; a trailing slash (directory
 * entry) is kept.
 *
 * @param {string} name - the entry name as stored in the archive
 * @returns {string|null} the relative path, or null for an entry with a `..`
 *   segment or one that names the extract folder itself
 */
export const archiveEntryPath = (name) => {
    if ( typeof name !== 'string' ) return null;

    const segments = name.split('/').filter(segment => segment !== '' && segment !== '.');
    if ( segments.length === 0 || segments.includes('..') ) return null;

    return segments.join('/') + (name.endsWith('/') ? '/' : '');
};
