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
 * `maxPages` only guards against a cursor that never terminates. `deployable`
 * comes off the first page: a server with events disabled or the worker
 * runtime unconfigured answers it `false` (or rejects the call outright,
 * reported as `failed`) rather than ever handing back a worker — the caller
 * uses this to tell "off" apart from "genuinely empty".
 *
 * @param {{ list?: (opts: { limit: number, cursor?: string }) => Promise<{ items: object[], cursor?: string, deployable?: boolean }> }} [workersClient]
 * @param {object} [opts]
 * @param {number} [opts.limit]
 * @param {number} [opts.maxPages]
 * @returns {Promise<{ items: object[], deployable: boolean, failed: boolean }>}
 */
export const fetchAllEventsWorkers = async (workersClient, { limit = 100, maxPages = 50 } = {}) => {
    if ( !workersClient || typeof workersClient.list !== 'function' ) {
        return { items: [], deployable: false, failed: true };
    }

    const items = [];
    let cursor;
    let deployable = false;
    for ( let page = 0; page < maxPages; page++ ) {
        let resp;
        try {
            resp = await workersClient.list({ limit, cursor });
        } catch {
            return { items, deployable, failed: page === 0 };
        }
        if ( page === 0 ) deployable = resp?.deployable === true;
        const pageItems = Array.isArray(resp?.items) ? resp.items : [];
        items.push(...pageItems);
        cursor = resp?.cursor;
        if ( !cursor || pageItems.length === 0 ) break;
    }
    return { items, deployable, failed: false };
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
