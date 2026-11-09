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

import { strongerMode } from './shareModes.js';

// Largest page the backend will serve (ShareStore.MAX_HOLDER_PAGE_SIZE).
const PAGE_SIZE = 200;

/**
 * One row per shared item. The API lists a row per grant and grants add up, so
 * an item granted twice keeps its strongest row. It stays a team share only
 * when no grant names the user directly, since a direct grant is theirs to leave.
 *
 * @param {Array<Object>} shares
 * @returns {Array<Object>}
 */
export const mergeGrants = (shares) => {
    const merged = new Map();
    for ( const share of shares ) {
        const key = share.entryUid ?? share.path;
        const held = merged.get(key);
        if ( ! held ) {
            merged.set(key, share);
            continue;
        }
        const best = strongerMode(held.mode, share.mode) === held.mode ? held : share;
        const teamOnly = held.holderTeam && share.holderTeam;
        merged.set(key, { ...best, holderTeam: teamOnly ? best.holderTeam : undefined });
    }
    return [...merged.values()];
};

/**
 * Every item shared with the current user, across all pages. A page can be
 * short once unreachable items are filtered out, so it pages on `cursor`
 * rather than on the item count.
 *
 * @returns {Promise<Array<Object>>}
 */
const list_all_shared = async () => {
    const shares = [];
    let cursor;

    do {
        const page = await window.puter.fs.listShared({
            limit: PAGE_SIZE,
            ...(cursor ? { cursor } : {}),
        });
        shares.push(...(page.items ?? []));
        cursor = page.cursor;
    } while ( cursor );

    return mergeGrants(shares);
};

export default list_all_shared;
