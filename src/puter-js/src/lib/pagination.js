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
 * MERCHANTABILITY or FITNESS FOR PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * Client-side page iteration for list APIs that follow the standard
 * `{ items, cursor?, total? }` envelope (doc/pagination.md). List modules
 * build a `fetchPage` closure that issues one request with their base
 * arguments merged under the per-page pagination params.
 *
 * @typedef {{ items: unknown[], cursor?: string, total?: number }} ListPage
 * @typedef {(pageParams: { cursor: string | null, includeTotal?: boolean }) => Promise<ListPage | unknown[]>} FetchPage
 */

/**
 * Async generator over page envelopes, following `cursor` until it is
 * absent. `includeTotal` is sent on the first request only — totals cost
 * more the more items exist, and the count doesn't change page to page.
 * A backend that ignores pagination params responds with a bare array;
 * that becomes the one and only page, so old backends stay compatible.
 *
 * @param {FetchPage} fetchPage
 * @param {{ cursor?: string | null, includeTotal?: boolean }} [opts]
 * @returns {AsyncGenerator<ListPage, void, undefined>}
 */
async function* iteratePages (fetchPage, opts = {}) {
    /** @type {{ cursor: string | null, includeTotal?: boolean }} */
    let pageParams = {
        cursor: opts.cursor ?? null,
        ...(opts.includeTotal === true ? { includeTotal: true } : {}),
    };
    while ( true ) {
        const result = await fetchPage(pageParams);
        const page = Array.isArray(result) ? { items: result } : (result ?? { items: [] });
        yield page;
        if ( ! page.cursor ) return;
        pageParams = { cursor: page.cursor };
    }
}

/**
 * Fetches every page and returns the concatenated items — the legacy
 * full-listing shape, produced with bounded per-request work.
 *
 * @param {FetchPage} fetchPage
 * @returns {Promise<unknown[]>}
 */
async function fetchAllPages (fetchPage) {
    const items = [];
    for await ( const page of iteratePages(fetchPage) ) {
        items.push(...(page.items ?? []));
    }
    return items;
}

export { fetchAllPages, iteratePages };
