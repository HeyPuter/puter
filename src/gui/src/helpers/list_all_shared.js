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

// Largest page the backend will serve (ShareStore.MAX_HOLDER_PAGE_SIZE).
const PAGE_SIZE = 200;

/**
 * Every share the current user holds, across all pages. A page can be short
 * once unreachable items are filtered out, so it pages on `cursor` rather than
 * on the item count.
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

    return shares;
};

export default list_all_shared;
