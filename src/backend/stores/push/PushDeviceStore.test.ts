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

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PuterServer } from '../../server.js';
import { createTestUser, setupTestServer } from '../../testUtil.js';
import {
    hashPushToken,
    PUSH_DEVICE_LABEL_MAX_LENGTH,
    PUSH_DEVICE_USER_AGENT_MAX_LENGTH,
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

    const sessionOf = new Map<number, string>();

    const newSession = async (userId: number): Promise<string> => {
        const row = (await server.stores.session.create(userId)) as {
            uuid: string;
        };
        return row.uuid;
    };

    const makeUser = async () => {
        const username = `pd${Math.random().toString(36).slice(2, 9)}`;
        await createTestUser(server, { username, password: 'pw-test-1234' });
        const user = await server.stores.user.getByUsername(username);
        if (!user) throw new Error('test user missing');
        sessionOf.set(user.id, await newSession(user.id));
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
            sessionUid: sessionOf.get(userId) ?? 'no-session',
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
                sessionUid: sessionOf.get(user.id),
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
            await server.clients.db.write(
                'UPDATE `push_device` SET `created_at` = 1000 WHERE `uid` = ?',
                [original.uid],
            );

            const moved = await register(next.id, { token, appUid: null });

            expect(moved.uid).not.toBe(original.uid);
            expect(moved.createdAt).toBeGreaterThan(1000);
            expect(moved.sessionUid).toBe(sessionOf.get(next.id));
            expect(await store().getByUid(original.uid)).toBeNull();
            expect(moved.userId).toBe(next.id);
            expect(moved.appUid).toBeNull();
            expect(await store().listByUser(previous.id)).toEqual([]);
            expect(
                await store().listForDelivery(previous.id, 'app-one'),
            ).toEqual([]);
            expect(
                (await store().listByUser(next.id)).map((d) => d.uid),
            ).toEqual([moved.uid]);
            expect(await countByToken(token)).toBe(1);
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
            expect(device.userAgent).toHaveLength(
                PUSH_DEVICE_USER_AGENT_MAX_LENGTH,
            );
            expect(device.label).toHaveLength(PUSH_DEVICE_LABEL_MAX_LENGTH);
        });

        // `otherId` takes `token` before each of the next `times` read-backs.
        const interleave = (otherId: number, token: string, times: number) => {
            const db = server.clients.db;
            const pread = db.pread.bind(db);
            let remaining = times;
            let busy = false;
            return vi.spyOn(db, 'pread').mockImplementation(async (q, p) => {
                if (!busy && remaining > 0 && q.includes('`token_hash` = ?')) {
                    remaining--;
                    busy = true;
                    try {
                        await register(otherId, { token });
                    } finally {
                        busy = false;
                    }
                }
                return pread(q, p);
            });
        };

        it('retries once when another user takes the token mid-register', async () => {
            const user = await makeUser();
            const other = await makeUser();
            const token = freshToken();
            const spy = interleave(other.id, token, 1);
            try {
                const device = await register(user.id, { token });
                expect(device.userId).toBe(user.id);
            } finally {
                spy.mockRestore();
            }
            expect(await store().listByUser(other.id)).toEqual([]);
            expect(await countByToken(token)).toBe(1);
        });

        it('throws a conflict when another user keeps taking the token', async () => {
            const user = await makeUser();
            const other = await makeUser();
            const token = freshToken();
            const spy = interleave(other.id, token, 2);
            try {
                await expect(
                    register(user.id, { token }),
                ).rejects.toMatchObject({ statusCode: 409 });
            } finally {
                spy.mockRestore();
            }
            const [owned] = await store().listByUser(other.id);
            expect(owned?.userId).toBe(other.id);
        });
    });

    describe('listForDelivery', () => {
        it('reads from the primary, so a device registered just now counts', async () => {
            const user = await makeUser();
            await register(user.id);
            const pread = vi.spyOn(server.clients.db, 'pread');
            try {
                await store().listForDelivery(user.id, null);
                expect(pread).toHaveBeenCalledTimes(1);
            } finally {
                pread.mockRestore();
            }
        });

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

        it('skips devices whose session was revoked or has expired', async () => {
            const user = await makeUser();
            const active = await register(user.id);
            const revokedSession = await newSession(user.id);
            const expiredSession = await newSession(user.id);
            const revoked = await register(user.id, {
                sessionUid: revokedSession,
            });
            const expired = await register(user.id, {
                sessionUid: expiredSession,
            });
            const unknown = await register(user.id, {
                sessionUid: 'no-such-session',
            });
            const sessionless = await register(user.id);
            await server.clients.db.write(
                'UPDATE `push_device` SET `session_uid` = NULL WHERE `uid` = ?',
                [sessionless.uid],
            );
            await server.stores.session.revokeCascade(revokedSession);
            await server.clients.db.write(
                'UPDATE `sessions` SET `expires_at` = ? WHERE `uuid` = ?',
                [Math.floor(Date.now() / 1000) - 60, expiredSession],
            );

            const uids = (await store().listForDelivery(user.id, null)).map(
                (t) => t.uid,
            );
            expect(uids.sort()).toEqual([active.uid, sessionless.uid].sort());
            expect(uids).not.toContain(revoked.uid);
            expect(uids).not.toContain(expired.uid);
            expect(uids).not.toContain(unknown.uid);
            const revokedRows = await server.clients.db.read(
                'SELECT `revoked_at` FROM `sessions` WHERE `uuid` = ?',
                [revokedSession],
            );
            expect(revokedRows[0]?.revoked_at).not.toBeNull();
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

            await store().recordFailure(user.id, [device.uid, device.uid]);
            await store().touch(user.id, [device.uid]);

            const row = await store().getByUid(device.uid);
            expect(row?.failureCount).toBe(4);
            expect(row?.lastSeenAt).toBeGreaterThanOrEqual(device.lastSeenAt);
        });

        it('touches and counts failures only on the named owner’s rows', async () => {
            const previous = await makeUser();
            const next = await makeUser();
            const token = freshToken();
            const old = await register(previous.id, { token });
            const moved = await register(next.id, { token });
            const earlier = moved.lastSeenAt - 100;
            await setLastSeen(moved.uid, earlier);

            await store().recordFailure(previous.id, [old.uid, moved.uid]);
            await store().touch(previous.id, [old.uid, moved.uid]);

            const row = await store().getByUid(moved.uid);
            expect(row?.failureCount).toBe(3);
            expect(row?.lastSeenAt).toBe(earlier);
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
