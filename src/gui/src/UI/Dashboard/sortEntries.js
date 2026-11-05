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
 * @typedef {Object} SortKey
 * @property {string} name - The name the row shows
 * @property {number} [size]
 * @property {number} [modified]
 */

// One collator for every comparison: localeCompare builds one per call.
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/**
 * Orders names as a file manager does: case-insensitively, with runs of
 * digits compared by value ("file2" before "file10"). Names equal but for
 * case or accents still get a fixed order.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function compareNames (a, b) {
    return collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
}

/**
 * Orders two listing entries by `column`, ascending. Equal sizes or dates
 * fall back to the name, so their order is the same on every listing.
 *
 * @param {SortKey} a
 * @param {SortKey} b
 * @param {'name'|'size'|'modified'} column
 * @returns {number}
 */
export function compareEntries (a, b, column) {
    let comparison = 0;
    if ( column === 'size' ) comparison = (a.size || 0) - (b.size || 0);
    else if ( column === 'modified' ) comparison = (a.modified || 0) - (b.modified || 0);
    return comparison || compareNames(a.name, b.name);
}
