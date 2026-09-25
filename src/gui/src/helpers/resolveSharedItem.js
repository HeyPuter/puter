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

import parse_shared_path from './parseSharedPath.js';

/**
 * Find the item a share link addresses. The path only resolves while the name
 * segment still matches, so a rename falls back to the uuid — which is what the
 * item actually is. `fs` is a parameter so this needs no server to test.
 *
 * @param {{ stat: (opts: object) => Promise<object> }} fs
 * @param {string} shared_path
 * @returns {Promise<object | null>} The stat, or `null` if it can't be found.
 */
export default async function resolve_shared_item (fs, shared_path) {
    const target = parse_shared_path(shared_path);
    if ( ! target ) return null;

    try {
        return await fs.stat({ path: shared_path, consistency: 'eventual' });
    } catch ( e ) {
        // Fall through to the uuid.
    }

    try {
        return await fs.stat({ uid: target.uid, consistency: 'eventual' });
    } catch ( e ) {
        return null;
    }
}
