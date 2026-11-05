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

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PuterServer } from '../../server.js';
import { setupTestServer } from '../../testUtil.js';

let server: PuterServer;

beforeAll(async () => {
    server = await setupTestServer();
});

afterAll(async () => {
    await server?.shutdown();
});

const slug = () => Math.random().toString(36).slice(2, 10);

// Ends the post-write window in which app rows aren't cached.
const endChangeWindow = async () => {
    const redis = server.clients.redis;
    for (const key of await redis.keys('apps:*:deleted')) await redis.del(key);
};

const filetypeQueries = async <T>(fn: () => Promise<T>) => {
    const read = vi.spyOn(server.clients.db, 'read');
    const pread = vi.spyOn(server.clients.db, 'pread');
    try {
        const result = await fn();
        const count = [...read.mock.calls, ...pread.mock.calls].filter(
            ([sql]) => /FROM `app_filetype_association`/.test(String(sql)),
        ).length;
        return { result, count };
    } finally {
        read.mockRestore();
        pread.mockRestore();
    }
};

describe('AppService.views filetype associations', () => {
    it('takes them from the cached app row and reflects a change', async () => {
        const name = `ftv-${slug()}`;
        const app = await server.stores.app.create(
            { name, title: name, index_url: `https://${name}.example.com/` },
            { ownerUserId: 1 },
        );
        await server.stores.app.setFiletypeAssociations(app.id, ['txt']);
        await endChangeWindow();
        // Fill the row cache.
        await server.stores.app.getByUid(app.uid);
        await new Promise((r) => setTimeout(r, 20));

        const warm = await filetypeQueries(async () => {
            const row = await server.stores.app.getByUid(app.uid);
            return server.services.app.views([row!], undefined);
        });
        expect(warm.count).toBe(0);
        expect(warm.result[0]!.view.filetype_associations).toEqual(['txt']);

        await server.stores.app.setFiletypeAssociations(app.id, ['csv', 'md']);
        const row = await server.stores.app.getByUid(app.uid);
        const [{ view }] = await server.services.app.views([row!], undefined);
        expect([...view.filetype_associations].sort()).toEqual(['csv', 'md']);
    });

    it('queries rows that were loaded without them', async () => {
        const name = `ftv-${slug()}`;
        const app = await server.stores.app.create(
            { name, title: name, index_url: `https://${name}.example.com/` },
            { ownerUserId: 1 },
        );
        await server.stores.app.setFiletypeAssociations(app.id, ['txt']);
        await endChangeWindow();
        const { filetype_associations: _dropped, ...bare } =
            (await server.stores.app.getByUid(app.uid))!;
        await new Promise((r) => setTimeout(r, 20));

        const { result, count } = await filetypeQueries(() =>
            server.services.app.views([bare], undefined),
        );
        expect(count).toBe(1);
        expect(result[0]!.view.filetype_associations).toEqual(['txt']);
    });
});
