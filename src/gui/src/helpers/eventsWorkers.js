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
 * Page through `puter.events.workers.list({ limit, cursor })` until the
 * server stops handing back a cursor, returning every item collected.
 *
 * `maxPages` only guards against a cursor that never terminates.
 *
 * @param {{ list?: (opts: { limit: number, cursor?: string }) => Promise<{ items: object[], cursor?: string }> }} [workersClient]
 * @param {object} [opts]
 * @param {number} [opts.limit]
 * @param {number} [opts.maxPages]
 * @returns {Promise<object[]>}
 */
export const fetchAllEventsWorkers = async (workersClient, { limit = 100, maxPages = 50 } = {}) => {
    if ( !workersClient || typeof workersClient.list !== 'function' ) return [];

    const items = [];
    let cursor;
    for ( let page = 0; page < maxPages; page++ ) {
        const resp = await workersClient.list({ limit, cursor });
        const pageItems = Array.isArray(resp?.items) ? resp.items : [];
        items.push(...pageItems);
        cursor = resp?.cursor;
        if ( !cursor || pageItems.length === 0 ) break;
    }
    return items;
};

/**
 * Display name for an events worker row — the app's title, falling back to
 * its internal name when no title is set.
 *
 * @param {{ appTitle?: string, appName?: string }} worker
 * @returns {string}
 */
export const eventsWorkerLabel = (worker) => worker?.appTitle || worker?.appName || '';

export default fetchAllEventsWorkers;
