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
 * Against a real database, so the table and its unique index are exercised on
 * whichever engine the run is configured for — `PUTER_TEST_DB_ENGINE=postgres`
 * covers the second dialect's migration.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PuterServer } from '../../server.js';
import { createTestUser, setupTestServer } from '../../testUtil.js';

describe('UserBlockStore', () => {
    let server: PuterServer;

    beforeAll(async () => {
        server = await setupTestServer();
    });

    afterAll(async () => {
        await server?.shutdown();
    });

    const makeUser = async () => {
        const username = `ub${Math.random().toString(36).slice(2, 9)}`;
        await createTestUser(server, { username, password: 'pw-test-1234' });
        const user = await server.stores.user.getByUsername(username);
        if (!user) throw new Error('test user missing');
        return user;
    };

    it('round-trips a block, idempotently in both directions', async () => {
        const blocker = await makeUser();
        const blocked = await makeUser();
        const store = server.stores.userBlock;

        expect(await store.isBlocked(blocker.id, blocked.id)).toBe(false);
        expect(await store.create(blocker.id, blocked.id)).toBe(true);
        expect(await store.create(blocker.id, blocked.id)).toBe(false);
        expect(await store.isBlocked(blocker.id, blocked.id)).toBe(true);

        // Blocking is one-directional: it says nothing about the other way.
        expect(await store.isBlocked(blocked.id, blocker.id)).toBe(false);

        expect(await store.deleteByPair(blocker.id, blocked.id)).toBe(true);
        expect(await store.deleteByPair(blocker.id, blocked.id)).toBe(false);
        expect(await store.isBlocked(blocker.id, blocked.id)).toBe(false);
    });

    it('lists a blocker’s own rows, most recent first', async () => {
        const blocker = await makeUser();
        const other = await makeUser();
        const first = await makeUser();
        const second = await makeUser();
        const store = server.stores.userBlock;

        await store.create(blocker.id, first.id);
        await store.create(blocker.id, second.id);
        await store.create(other.id, first.id);

        const rows = await store.listByBlocker(blocker.id);
        expect(rows.map((row) => Number(row.blocked_user_id))).toEqual([
            second.id,
            first.id,
        ]);
        expect(Number.isFinite(Number(rows[0].created_at))).toBe(true);
    });
});
