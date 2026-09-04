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

import { describe, it, expect } from 'vitest';
import { fetchAllEventsWorkers, eventsWorkerLabel } from './eventsWorkers.js';

const worker = (over = {}) => ({
    appUid: 'app-1111',
    appName: 'my-worker-app',
    appTitle: 'My Worker App',
    handlerCount: 2,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
    script: 'export default {};',
    deployable: true,
    ...over,
});

describe('eventsWorkerLabel', () => {
    it('prefers appTitle', () => {
        expect(eventsWorkerLabel(worker())).toBe('My Worker App');
    });

    it('falls back to appName when there is no title', () => {
        expect(eventsWorkerLabel(worker({ appTitle: undefined }))).toBe('my-worker-app');
    });

    it('returns an empty string for a missing worker', () => {
        expect(eventsWorkerLabel(null)).toBe('');
        expect(eventsWorkerLabel({})).toBe('');
    });
});

// Minimal `puter.events.workers` double: paginate a fixed item set by cursor.
const makeWorkersClient = (pages) => {
    const calls = [];
    return {
        calls,
        list: async ({ limit, cursor }) => {
            calls.push({ limit, cursor });
            const index = cursor ? Number(cursor) : 0;
            return pages[index] ?? { items: [], cursor: undefined };
        },
    };
};

describe('fetchAllEventsWorkers', () => {
    it('returns [] when the client is missing (older SDK)', async () => {
        expect(await fetchAllEventsWorkers(undefined)).toEqual([]);
        expect(await fetchAllEventsWorkers({})).toEqual([]);
    });

    it('returns every item from a single page', async () => {
        const client = makeWorkersClient([
            { items: [worker({ appUid: 'a' }), worker({ appUid: 'b' })], cursor: undefined },
        ]);
        const items = await fetchAllEventsWorkers(client);
        expect(items.map((w) => w.appUid)).toEqual(['a', 'b']);
        expect(client.calls).toEqual([{ limit: 100, cursor: undefined }]);
    });

    it('follows the cursor across pages until one comes back empty', async () => {
        const client = makeWorkersClient([
            { items: [worker({ appUid: 'a' })], cursor: '1' },
            { items: [worker({ appUid: 'b' })], cursor: '2' },
            { items: [], cursor: undefined },
        ]);
        const items = await fetchAllEventsWorkers(client, { limit: 1 });
        expect(items.map((w) => w.appUid)).toEqual(['a', 'b']);
        expect(client.calls).toEqual([
            { limit: 1, cursor: undefined },
            { limit: 1, cursor: '1' },
            { limit: 1, cursor: '2' },
        ]);
    });

    it('stops at maxPages against a cursor that never runs out', async () => {
        const client = {
            list: async () => ({ items: [worker()], cursor: 'always-more' }),
        };
        const items = await fetchAllEventsWorkers(client, { maxPages: 3 });
        expect(items).toHaveLength(3);
    });

    it('tolerates a malformed response (no items array)', async () => {
        const client = { list: async () => ({}) };
        expect(await fetchAllEventsWorkers(client)).toEqual([]);
    });
});
