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

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PuterServer } from '../../server.js';
import { setupTestServer } from '../../testUtil.js';

let server: PuterServer;
let ownerUserId: number;

beforeAll(async () => {
    server = await setupTestServer();
    const owner = await server.stores.user.create({
        username: `byname-owner-${Math.random().toString(36).slice(2, 8)}`,
        uuid: randomUUID(),
        password: null,
        email: null,
        free_storage: 1024,
        requires_email_confirmation: false,
    });
    ownerUserId = owner.id;
});

afterAll(async () => {
    await server?.shutdown();
});

const freshName = () => `byname-${Math.random().toString(36).slice(2, 10)}`;

const createApp = (name = freshName()) =>
    server.stores.app.create(
        { name, title: name, index_url: `https://${name}.example.test/` },
        { ownerUserId },
    );

describe('AppStore.getByNames', () => {
    it('keys each found app by the requested name and omits misses', async () => {
        const a = await createApp();
        const b = await createApp();

        const byName = await server.stores.app.getByNames([
            a.name,
            'byname-missing',
            b.name,
        ]);

        expect([...byName.keys()].sort()).toEqual([a.name, b.name].sort());
        expect(byName.get(a.name).id).toBe(a.id);
        expect(byName.get(b.name).id).toBe(b.id);
    });

    it('resolves a recent old name to the renamed app, as getByName does', async () => {
        const app = await createApp();
        const oldName = app.name;
        await server.stores.app.update(app.id, { name: freshName() });

        const byName = await server.stores.app.getByNames([oldName]);

        expect(byName.get(oldName)?.id).toBe(app.id);
        expect((await server.stores.app.getByName(oldName))?.id).toBe(app.id);
    });

    it('reads uncached live names with one query, not one per name', async () => {
        const apps = await Promise.all([0, 1, 2, 3, 4].map(() => createApp()));
        await server.clients.redis.del(
            ...apps.map((app) => `apps:name:${app.name}`),
        );
        const read = vi.spyOn(server.clients.db, 'read');
        try {
            const byName = await server.stores.app.getByNames(
                apps.map((app) => app.name),
            );
            expect(byName.size).toBe(5);
            const appReads = read.mock.calls.filter((call) =>
                String(call[0]).includes('FROM `apps`'),
            );
            expect(appReads).toHaveLength(1);
        } finally {
            read.mockRestore();
        }
    });

    it('returns an empty map for no names', async () => {
        expect((await server.stores.app.getByNames([])).size).toBe(0);
    });
});
