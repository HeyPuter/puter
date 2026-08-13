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

/** Matches the backend's cap in FSService#findDedupedName. */
const MAX_SUFFIX = 100_000;

/**
 * Predict the name the backend will settle on when it dedupes `name` against
 * the entries already in a directory: the name itself if free, otherwise
 * `base (1)`, `base (2)`, ... with any extension kept at the end. Mirrors the
 * ` (N)` convention of FSService#findDedupedName.
 *
 * This is only a prediction from what the client can see — the server remains
 * the authority, and a caller that renders the predicted name optimistically
 * has to correct itself if the two disagree.
 *
 * @param {string} name - the desired name, e.g. 'New Folder'
 * @param {Iterable<string>} takenNames - names already in the directory
 * @returns {string}
 */
export function dedupedName (name, takenNames) {
    const taken = new Set();
    for ( const taken_name of takenNames ) {
        if ( typeof taken_name === 'string' ) taken.add(taken_name.toLowerCase());
    }

    if ( ! taken.has(name.toLowerCase()) ) return name;

    const extension = path.extname(name);
    const base = path.basename(name, extension);
    for ( let suffix = 1; suffix < MAX_SUFFIX; suffix++ ) {
        const candidate = `${base} (${suffix})${extension}`;
        if ( ! taken.has(candidate.toLowerCase()) ) return candidate;
    }
    return name;
}
