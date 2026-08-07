/**
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

import { v4 as uuidv4 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestServer } from '../../testUtil.ts';

const unackKey = (userId) => `notifications:unack:${userId}`;

describe('NotificationStore', () => {
    let server;
    let store;
    let redis;
    let user;
    let other;

    const makeUser = async () => {
        const username = `notif-${Math.random().toString(36).slice(2, 10)}`;
        return server.stores.user.create({
            username,
            uuid: uuidv4(),
            password: null,
            email: `${username}@test.local`,
        });
    };

    beforeAll(async () => {
        server = await setupTestServer();
        store = server.stores.notification;
        redis = server.clients.redis;
        user = await makeUser();
        other = await makeUser();
    });

    afterAll(async () => {
        await server?.shutdown();
    });

    // -- create + read -------------------------------------------------

    it('creates a notification and returns it with the value parsed back', async () => {
        const created = await store.create({
            userId: user.id,
            value: { type: 'friend-request', from: 'someone' },
        });

        expect(created.uid).toBeTruthy();
        expect(created.user_id).toBe(user.id);
        expect(created.value).toEqual({
            type: 'friend-request',
            from: 'someone',
        });
        expect(created.acknowledged).toBeNull();
    });

    it('accepts a pre-serialized value and defaults a missing one to {}', async () => {
        const serialized = await store.create({
            userId: user.id,
            value: JSON.stringify({ a: 1 }),
        });
        expect(serialized.value).toEqual({ a: 1 });

        const empty = await store.create({ userId: user.id });
        expect(empty.value).toEqual({});
    });

    it('keeps a non-JSON string value as a string', async () => {
        const created = await store.create({
            userId: user.id,
            value: 'plain text',
        });
        expect(created.value).toBe('plain text');
    });

    it('rejects a create with no user', async () => {
        await expect(store.create({ value: {} })).rejects.toThrow(
            'userId is required',
        );
    });

    it('returns null for an unknown uid', async () => {
        expect(await store.getByUid('no-such-notification')).toBeNull();
    });

    it('will not hand one user another user notification when scoped', async () => {
        const mine = await store.create({ userId: user.id, value: { x: 1 } });

        // Unscoped lookup finds it (internal callers)...
        expect((await store.getByUid(mine.uid))?.uid).toBe(mine.uid);
        // ...but a user-scoped lookup by the wrong user does not.
        expect(await store.getByUid(mine.uid, { userId: other.id })).toBeNull();
        expect((await store.getByUid(mine.uid, { userId: user.id }))?.uid).toBe(
            mine.uid,
        );
    });

    // -- listing -------------------------------------------------------

    it('lists only the requesting user notifications', async () => {
        const listUser = await makeUser();
        const a = await store.create({ userId: listUser.id, value: { i: 1 } });
        await store.create({ userId: other.id, value: { i: 2 } });

        const rows = await store.listByUserId(listUser.id);
        expect(rows.map((r) => r.uid)).toEqual([a.uid]);
    });

    it('filters by acknowledged / unacknowledged / unseen', async () => {
        const u = await makeUser();
        const acked = await store.create({ userId: u.id, value: { n: 'a' } });
        const shown = await store.create({ userId: u.id, value: { n: 's' } });
        const fresh = await store.create({ userId: u.id, value: { n: 'f' } });

        await store.markAcknowledged(acked.uid, u.id);
        await store.markShown(shown.uid, u.id);

        const uids = (rows) => rows.map((r) => r.uid).sort();

        expect(uids(await store.listByUserId(u.id))).toEqual(
            [acked.uid, shown.uid, fresh.uid].sort(),
        );
        expect(
            uids(await store.listByUserId(u.id, { onlyUnacknowledged: true })),
        ).toEqual([shown.uid, fresh.uid].sort());
        expect(
            uids(await store.listByUserId(u.id, { filter: 'unacknowledged' })),
        ).toEqual([shown.uid, fresh.uid].sort());
        expect(
            uids(await store.listByUserId(u.id, { filter: 'unseen' })),
        ).toEqual([fresh.uid]);
        expect(
            uids(await store.listByUserId(u.id, { filter: 'acknowledged' })),
        ).toEqual([acked.uid]);
    });

    it('ignores an unrecognised filter and returns everything', async () => {
        const u = await makeUser();
        await store.create({ userId: u.id, value: {} });
        expect(
            await store.listByUserId(u.id, { filter: 'nonsense' }),
        ).toHaveLength(1);
    });

    it('honours the limit and coerces junk limits back to the default', async () => {
        const u = await makeUser();
        for (let i = 0; i < 3; i++) {
            await store.create({ userId: u.id, value: { i } });
        }

        expect(await store.listByUserId(u.id, { limit: 2 })).toHaveLength(2);
        expect(await store.listByUserId(u.id, { limit: 0 })).toHaveLength(0);
        expect(await store.listByUserId(u.id, { limit: -5 })).toHaveLength(0);
        expect(await store.listByUserId(u.id, { limit: 2.9 })).toHaveLength(2);
        expect(await store.listByUserId(u.id, { limit: 'lots' })).toHaveLength(
            3,
        );
    });

    // -- unacknowledged count + cache ----------------------------------

    it('returns zero for a falsy user without touching the database', async () => {
        expect(await store.countUnacknowledged(undefined)).toBe(0);
        expect(await store.countUnacknowledged(0)).toBe(0);
    });

    it('counts unacknowledged notifications and caches the result', async () => {
        const u = await makeUser();
        await store.create({ userId: u.id, value: {} });
        await store.create({ userId: u.id, value: {} });

        expect(await store.countUnacknowledged(u.id)).toBe(2);
        expect(await redis.get(unackKey(u.id))).toBe('2');
    });

    it('serves a cached count without re-querying', async () => {
        const u = await makeUser();
        await store.create({ userId: u.id, value: {} });
        await store.countUnacknowledged(u.id);

        await redis.set(unackKey(u.id), '99');
        expect(await store.countUnacknowledged(u.id)).toBe(99);
    });

    it('falls back to the database when the cached value is not a number', async () => {
        const u = await makeUser();
        await store.create({ userId: u.id, value: {} });
        await redis.set(unackKey(u.id), 'garbage');

        expect(await store.countUnacknowledged(u.id)).toBe(1);
    });

    it('invalidates the cached count on create', async () => {
        const u = await makeUser();
        await store.create({ userId: u.id, value: {} });
        expect(await store.countUnacknowledged(u.id)).toBe(1);
        expect(await redis.get(unackKey(u.id))).toBe('1');

        await store.create({ userId: u.id, value: {} });
        expect(await redis.get(unackKey(u.id))).toBeNull();
        expect(await store.countUnacknowledged(u.id)).toBe(2);
    });

    it('invalidates the cached count on acknowledge and on delete', async () => {
        const u = await makeUser();
        const a = await store.create({ userId: u.id, value: {} });
        const b = await store.create({ userId: u.id, value: {} });
        await store.countUnacknowledged(u.id);

        expect(await store.markAcknowledged(a.uid, u.id)).toBe(true);
        expect(await redis.get(unackKey(u.id))).toBeNull();
        expect(await store.countUnacknowledged(u.id)).toBe(1);

        expect(await store.deleteByUid(b.uid, u.id)).toBe(true);
        expect(await redis.get(unackKey(u.id))).toBeNull();
        expect(await store.countUnacknowledged(u.id)).toBe(0);
    });

    // -- mutations -----------------------------------------------------

    it('acknowledges only once and only for the owning user', async () => {
        const u = await makeUser();
        const n = await store.create({ userId: u.id, value: {} });

        expect(await store.markAcknowledged(n.uid, other.id)).toBe(false);
        expect(await store.markAcknowledged(n.uid, u.id)).toBe(true);
        // Already acknowledged — no second state change.
        expect(await store.markAcknowledged(n.uid, u.id)).toBe(false);

        const row = await store.getByUid(n.uid, { userId: u.id });
        expect(typeof row.acknowledged).toBe('number');
    });

    it('marks shown only once and leaves the unacknowledged count alone', async () => {
        const u = await makeUser();
        const n = await store.create({ userId: u.id, value: {} });
        expect(await store.countUnacknowledged(u.id)).toBe(1);

        expect(await store.markShown(n.uid, other.id)).toBe(false);
        expect(await store.markShown(n.uid, u.id)).toBe(true);
        expect(await store.markShown(n.uid, u.id)).toBe(false);

        // Cached count is deliberately untouched by markShown.
        expect(await redis.get(unackKey(u.id))).toBe('1');
    });

    it('will not delete another user notification', async () => {
        const u = await makeUser();
        const n = await store.create({ userId: u.id, value: {} });

        expect(await store.deleteByUid(n.uid, other.id)).toBe(false);
        expect(await store.getByUid(n.uid)).not.toBeNull();

        expect(await store.deleteByUid(n.uid, u.id)).toBe(true);
        expect(await store.getByUid(n.uid)).toBeNull();
    });
});
