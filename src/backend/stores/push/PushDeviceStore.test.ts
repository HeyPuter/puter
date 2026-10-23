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

// Real database: PUTER_TEST_DB_ENGINE=postgres covers the postgres migration.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PuterServer } from '../../server.js';
import { createTestUser, setupTestServer } from '../../testUtil.js';
import {
    hashPushToken,
    type PushDeviceRegistration,
} from './PushDeviceStore.js';

describe('PushDeviceStore', () => {
    let server: PuterServer;

    beforeAll(async () => {
        server = await setupTestServer();
    });

    afterAll(async () => {
        await server?.shutdown();
    });

    const store = () => server.stores.pushDevice;

    const makeUser = async () => {
        const username = `pd${Math.random().toString(36).slice(2, 9)}`;
        await createTestUser(server, { username, password: 'pw-test-1234' });
        const user = await server.stores.user.getByUsername(username);
        if (!user) throw new Error('test user missing');
        return user;
    };

    const freshToken = () =>
        `https://push.example.test/${Math.random().toString(36).slice(2)}`;

    const register = (
        userId: number,
        overrides: Partial<PushDeviceRegistration> = {},
    ) =>
        store().register({
            userId,
            sessionUid: 'session-a',
            platform: 'web',
            token: freshToken(),
            ...overrides,
        });

    const setLastSeen = async (uid: string, seconds: number) => {
        await server.clients.db.write(
            'UPDATE `push_device` SET `last_seen_at` = ?, `failure_count` = 3 WHERE `uid` = ?',
            [seconds, uid],
        );
    };

    const countByToken = async (token: string) => {
        const rows = await server.clients.db.read(
            'SELECT COUNT(*) AS n FROM `push_device` WHERE `token_hash` = ?',
            [hashPushToken(token)],
        );
        return Number(rows[0]?.n);
    };

    describe('register', () => {
        it('adds a device the owner can list and look up', async () => {
            const user = await makeUser();
            const device = await register(user.id, {
                appUid: null,
                userAgent: '  Firefox  ',
                label: 'Laptop',
            });

            expect(device).toMatchObject({
                userId: user.id,
                sessionUid: 'session-a',
                platform: 'web',
                appUid: null,
                userAgent: 'Firefox',
                label: 'Laptop',
                failureCount: 0,
            });
            expect(device.uid).toMatch(/^[0-9a-f-]{36}$/);
            expect(device).not.toHaveProperty('token');
            expect(await store().getByUid(device.uid)).toEqual(device);
            expect(await store().listByUser(user.id)).toEqual([device]);
        });

        it('refreshes the existing device when the same token comes back', async () => {
            const user = await makeUser();
            const token = freshToken();
            const first = await register(user.id, { token, label: 'Old' });
            await setLastSeen(first.uid, first.lastSeenAt - 1000);

            const again = await register(user.id, {
                token,
                sessionUid: 'session-b',
                label: 'New',
            });

            expect(again.uid).toBe(first.uid);
            expect(again.createdAt).toBe(first.createdAt);
            expect(again.sessionUid).toBe('session-b');
            expect(again.label).toBe('New');
            expect(again.failureCount).toBe(0);
            expect(again.lastSeenAt).toBeGreaterThanOrEqual(first.lastSeenAt);
            expect(await countByToken(token)).toBe(1);
        });

        it('moves a token to whoever registers it last', async () => {
            const previous = await makeUser();
            const next = await makeUser();
            const token = freshToken();
            const original = await register(previous.id, {
                token,
                appUid: 'app-one',
            });

            const moved = await register(next.id, { token, appUid: null });

            expect(moved.uid).toBe(original.uid);
            expect(moved.userId).toBe(next.id);
            expect(moved.appUid).toBeNull();
            expect(await store().listByUser(previous.id)).toEqual([]);
            expect(
                await store().listForDelivery(previous.id, 'app-one'),
            ).toEqual([]);
            expect(
                (await store().listByUser(next.id)).map((d) => d.uid),
            ).toEqual([original.uid]);
        });

        it('keeps one row when the same token registers twice at once', async () => {
            const user = await makeUser();
            const token = freshToken();
            const [a, b] = await Promise.all([
                register(user.id, { token }),
                register(user.id, { token }),
            ]);
            expect(a.uid).toBe(b.uid);
            expect(await countByToken(token)).toBe(1);
        });

        it('bounds the user agent and label', async () => {
            const user = await makeUser();
            const device = await register(user.id, {
                userAgent: 'u'.repeat(2000),
                label: 'l'.repeat(200),
            });
            expect(device.userAgent).toHaveLength(512);
            expect(device.label).toHaveLength(64);
        });
    });

    describe('listForDelivery', () => {
        it('sends a Puter push only to Puter devices', async () => {
            const user = await makeUser();
            const puter = await register(user.id);
            await register(user.id, { appUid: 'app-one' });

            const targets = await store().listForDelivery(user.id, null);
            expect(targets.map((t) => t.uid)).toEqual([puter.uid]);
            expect(targets[0].token).toMatch(
                /^https:\/\/push\.example\.test\//,
            );
        });

        it('sends an app push to Puter devices and that app’s own', async () => {
            const user = await makeUser();
            const puter = await register(user.id);
            const mine = await register(user.id, { appUid: 'app-one' });
            await register(user.id, { appUid: 'app-two' });

            const targets = await store().listForDelivery(user.id, 'app-one');
            expect(targets.map((t) => t.uid).sort()).toEqual(
                [puter.uid, mine.uid].sort(),
            );
        });

        it('never returns another user’s devices', async () => {
            const user = await makeUser();
            const other = await makeUser();
            await register(other.id);
            await register(other.id, { appUid: 'app-one' });

            expect(await store().listForDelivery(user.id, null)).toEqual([]);
            expect(await store().listForDelivery(user.id, 'app-one')).toEqual(
                [],
            );
        });

        it('respects the limit, newest first', async () => {
            const user = await makeUser();
            await register(user.id);
            const second = await register(user.id);
            const third = await register(user.id);

            const targets = await store().listForDelivery(user.id, null, {
                limit: 2,
            });
            expect(targets.map((t) => t.uid)).toEqual([third.uid, second.uid]);
            expect(
                await store().listByUser(user.id, { limit: 1 }),
            ).toHaveLength(1);
        });
    });

    describe('removal and bookkeeping', () => {
        it('removes a device by uid only for its owner', async () => {
            const owner = await makeUser();
            const other = await makeUser();
            const device = await register(owner.id);

            expect(await store().removeByUid(other.id, device.uid)).toBe(false);
            expect(await store().getByUid(device.uid)).not.toBeNull();
            expect(await store().removeByUid(owner.id, device.uid)).toBe(true);
            expect(await store().getByUid(device.uid)).toBeNull();
        });

        it('removes devices by token hash', async () => {
            const user = await makeUser();
            const token = freshToken();
            const gone = await register(user.id, { token });
            const kept = await register(user.id);

            expect(
                await store().removeByTokenHashes([hashPushToken(token)]),
            ).toBe(1);
            expect(await store().removeByTokenHashes([])).toBe(0);
            expect(await store().getByUid(gone.uid)).toBeNull();
            expect(await store().getByUid(kept.uid)).not.toBeNull();
        });

        it('removes only the named sessions of the named user', async () => {
            const user = await makeUser();
            const other = await makeUser();
            const a = await register(user.id, { sessionUid: 's-1' });
            const b = await register(user.id, { sessionUid: 's-2' });
            const c = await register(user.id, { sessionUid: 's-3' });
            const others = await register(other.id, { sessionUid: 's-1' });

            expect(
                await store().removeBySessions(user.id, ['s-1', 's-2']),
            ).toBe(2);
            expect(await store().getByUid(a.uid)).toBeNull();
            expect(await store().getByUid(b.uid)).toBeNull();
            expect(await store().getByUid(c.uid)).not.toBeNull();
            expect(await store().getByUid(others.uid)).not.toBeNull();
        });

        it('touches last_seen_at and counts failures', async () => {
            const user = await makeUser();
            const device = await register(user.id);
            await setLastSeen(device.uid, 1000);

            await store().recordFailure([device.uid, device.uid]);
            await store().touch([device.uid]);

            const row = await store().getByUid(device.uid);
            expect(row?.failureCount).toBe(4);
            expect(row?.lastSeenAt).toBeGreaterThanOrEqual(device.lastSeenAt);
        });

        it('removes devices unseen since a cutoff, in batches', async () => {
            const user = await makeUser();
            const old = await register(user.id);
            const older = await register(user.id);
            const recent = await register(user.id);
            await setLastSeen(old.uid, 2000);
            await setLastSeen(older.uid, 1000);

            expect(await store().removeUnseenSince(5000, { limit: 1 })).toBe(1);
            expect(await store().getByUid(older.uid)).toBeNull();
            expect(await store().removeUnseenSince(5000, { limit: 10 })).toBe(
                1,
            );
            expect(await store().getByUid(old.uid)).toBeNull();
            expect(await store().getByUid(recent.uid)).not.toBeNull();
        });
    });
});
