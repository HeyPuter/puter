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
import { v4 as uuidv4 } from 'uuid';
import { setupTestServer } from '../../testUtil.ts';
import { PuterServer } from '../../server.ts';
import {
    APP_WINDOW_SECONDS,
    GODMODE_TOKEN_MAX_AGE_SECONDS,
    GODMODE_TOKEN_WINDOW_SECONDS,
    WEB_WINDOW_SECONDS,
    WORKER_WINDOW_SECONDS,
} from './SessionStore.js';

describe('SessionStore', () => {
    let server: PuterServer;
    let target: any;

    beforeAll(async () => {
        server = await setupTestServer();
        target = server.stores.session;
    });

    afterAll(async () => {
        await server?.shutdown();
    });

    const makeUser = async () => {
        const username = `ss-${Math.random().toString(36).slice(2, 10)}`;
        return server.stores.user.create({
            username,
            uuid: uuidv4(),
            password: null,
            email: `${username}@test.local`,
            email_confirmed: 1,
        } as never);
    };

    // Reads the raw row (including revoked) so tests can assert
    // soft-revoke semantics — `getByUuid` filters revoked rows.
    const rawRow = async (uuid: string) => {
        const rows = await server.clients.db.read(
            'SELECT * FROM `sessions` WHERE `uuid` = ? LIMIT 1',
            [uuid],
        );
        return rows[0] ?? null;
    };

    /**
     * Answer replica reads of `sessions` the way a lagging replica would: each
     * listed uuid as its given row, or absent when `null`. A given row also
     * answers, ahead of any other row, the (user, app) lookups that would match
     * it. Returns a restore.
     */
    const lagReplica = (stale: Record<string, Record<string, any> | null>) => {
        const db = server.clients.db;
        const original = db.read.bind(db);
        const spy = vi
            .spyOn(db, 'read')
            .mockImplementation(async (sql: string, params?: unknown[]) => {
                const rows = await original(sql, params);
                if (!sql.includes('FROM `sessions`')) return rows;
                const result = rows.filter(
                    (row: Record<string, any>) => !(row.uuid in stale),
                );
                for (const [uuid, row] of Object.entries(stale)) {
                    if (!row) continue;
                    const byComposite =
                        sql.includes(`\`kind\` = '${row.kind}'`) &&
                        params?.includes(row.user_id) &&
                        params?.includes(row.app_uid);
                    if (params?.includes(uuid) || byComposite) {
                        result.unshift({ ...row });
                    }
                }
                return result;
            });
        // sqlite's `pread` goes through `read`; keep it on the primary.
        const primary = vi
            .spyOn(db, 'pread')
            .mockImplementation((sql: string, params?: unknown[]) =>
                original(sql, params),
            );
        return () => {
            spy.mockRestore();
            primary.mockRestore();
        };
    };

    describe('create', () => {
        it('defaults to kind="web" and stores request metadata', async () => {
            const user = await makeUser();
            const session = await target.create(user.id, {
                meta: { ip: '1.2.3.4' },
                last_ip: '1.2.3.4',
                last_user_agent: 'test-agent',
            });

            expect(session.kind).toBe('web');
            expect(session.parent_session_id).toBeNull();
            expect(session.revoked_at).toBeNull();

            const row = await rawRow(session.uuid);
            expect(row.kind).toBe('web');
            expect(row.last_ip).toBe('1.2.3.4');
            expect(row.last_user_agent).toBe('test-agent');
        });

        it('stores expires_at when provided', async () => {
            const user = await makeUser();
            const future = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
            const session = await target.create(user.id, {
                expires_at: future,
            });

            expect(session.expires_at).toBe(future);
            const row = await rawRow(session.uuid);
            expect(row.expires_at).toBe(future);
        });

        it('leaves expires_at NULL by default (JWT exp is sole truth)', async () => {
            const user = await makeUser();
            const session = await target.create(user.id);
            expect(session.expires_at).toBeNull();
            const row = await rawRow(session.uuid);
            expect(row.expires_at).toBeNull();
        });

        it('accepts derived kinds with a parent_session_id', async () => {
            const user = await makeUser();
            const parent = await target.create(user.id);
            const child = await target.create(user.id, {
                kind: 'app',
                parent_session_id: parent.uuid,
                label: 'Some App',
            });

            expect(child.kind).toBe('app');
            expect(child.parent_session_id).toBe(parent.uuid);

            const row = await rawRow(child.uuid);
            expect(row.parent_session_id).toBe(parent.uuid);
            expect(row.label).toBe('Some App');
        });
    });

    describe('getByUuid', () => {
        it('returns the row for an active session', async () => {
            const user = await makeUser();
            const session = await target.create(user.id);
            const fetched = await target.getByUuid(session.uuid);
            expect(fetched).toBeTruthy();
            expect(fetched.uuid).toBe(session.uuid);
        });

        it('returns null for a soft-revoked session', async () => {
            const user = await makeUser();
            const session = await target.create(user.id);
            await target.removeByUuid(session.uuid);
            const fetched = await target.getByUuid(session.uuid);
            expect(fetched).toBeNull();
        });

        it('returns null when expires_at is in the past', async () => {
            // expires_at enforcement lives in getByUuid so the row is
            // the single source of truth — no re-mint pass needed (we
            // run long-lived JWTs in v2).
            const user = await makeUser();
            const past = Math.floor(Date.now() / 1000) - 60;
            const session = await target.create(user.id, { expires_at: past });
            const fetched = await target.getByUuid(session.uuid);
            expect(fetched).toBeNull();
        });

        it('returns the row when expires_at is in the future', async () => {
            const user = await makeUser();
            const future = Math.floor(Date.now() / 1000) + 3600;
            const session = await target.create(user.id, {
                expires_at: future,
            });
            const fetched = await target.getByUuid(session.uuid);
            expect(fetched).toBeTruthy();
            expect(fetched.uuid).toBe(session.uuid);
            expect(fetched.expires_at).toBe(future);
        });

        it('returns null when uuid is empty', async () => {
            expect(await target.getByUuid('')).toBeNull();
            expect(await target.getByUuid(undefined)).toBeNull();
        });
    });

    describe('getByUserId', () => {
        it('returns only active sessions by default', async () => {
            const user = await makeUser();
            const active = await target.create(user.id);
            const revoked = await target.create(user.id);
            await target.removeByUuid(revoked.uuid);

            const rows = await target.getByUserId(user.id);
            const uuids = rows.map((r: { uuid: string }) => r.uuid);
            expect(uuids).toContain(active.uuid);
            expect(uuids).not.toContain(revoked.uuid);
        });

        it('with primary=true finds a session the replica has not seen yet', async () => {
            const user = await makeUser();
            const session = await target.create(user.id);

            const restore = lagReplica({ [session.uuid]: null });
            try {
                expect(await target.getByUserId(user.id)).toEqual([]);
                const rows = await target.getByUserId(user.id, {
                    primary: true,
                });
                expect(rows.map((r: { uuid: string }) => r.uuid)).toEqual([
                    session.uuid,
                ]);
            } finally {
                restore();
            }
        });

        it('returns revoked sessions when includeRevoked is true', async () => {
            const user = await makeUser();
            const active = await target.create(user.id);
            const revoked = await target.create(user.id);
            await target.removeByUuid(revoked.uuid);

            const rows = await target.getByUserId(user.id, {
                includeRevoked: true,
            });
            const uuids = rows.map((r: { uuid: string }) => r.uuid);
            expect(uuids).toContain(active.uuid);
            expect(uuids).toContain(revoked.uuid);
        });
    });

    describe('removeByUuid', () => {
        it('soft-revokes — row remains in DB with revoked_at set', async () => {
            const user = await makeUser();
            const session = await target.create(user.id);

            await target.removeByUuid(session.uuid);

            const row = await rawRow(session.uuid);
            expect(row).toBeTruthy();
            expect(row.revoked_at).not.toBeNull();
            expect(row.revoked_at).toBeGreaterThan(0);
        });

        it('leaves the revoked row cached, so no replica can re-introduce it', async () => {
            const user = await makeUser();
            const session = await target.create(user.id);
            await target.getByUuid(session.uuid);

            await target.removeByUuid(session.uuid);

            const read = vi.spyOn(server.clients.db, 'read');
            try {
                // Answered from the cache the revoke left, not from a read.
                expect(await target.getByUuid(session.uuid)).toBeNull();
                expect(read).not.toHaveBeenCalled();
            } finally {
                read.mockRestore();
            }
        });

        it('sends a peer region miss to the primary while its replica lags', async () => {
            const user = await makeUser();
            const session = await target.create(user.id);
            const live = await rawRow(session.uuid);

            await target.removeByUuid(session.uuid);
            // A peer gets the tombstone and a dropped key, not the row.
            await server.clients.redis.del(`sessions:v2:uuid:${session.uuid}`);

            const restore = lagReplica({ [session.uuid]: live });
            try {
                expect(await target.getByUuid(session.uuid)).toBeNull();
            } finally {
                restore();
            }
        });

        it('is idempotent — second call does not overwrite revoked_at', async () => {
            const user = await makeUser();
            const session = await target.create(user.id);

            await target.removeByUuid(session.uuid);
            const firstRevokedAt = (await rawRow(session.uuid)).revoked_at;

            await new Promise((r) => setTimeout(r, 1100));
            await target.removeByUuid(session.uuid);
            const secondRevokedAt = (await rawRow(session.uuid)).revoked_at;

            expect(secondRevokedAt).toBe(firstRevokedAt);
        });
    });

    describe('purgeEndedInRange', () => {
        it('deletes rows ended before their kind cutoff within the id range', async () => {
            const user = await makeUser();
            const now = Math.floor(Date.now() / 1000);
            const cutoffs = { cutoff: now - 100, webCutoff: now - 1000 };
            const end = async (column: string, at: number, kind = 'asset') => {
                const { uuid } = await target.create(user.id, { kind });
                await server.clients.db.write(
                    `UPDATE \`sessions\` SET \`${column}\` = ? WHERE \`uuid\` = ?`,
                    [at, uuid],
                );
                return uuid;
            };
            const revoked = await end('revoked_at', now - 101);
            const expired = await end('expires_at', now - 101);
            const webRecent = await end('revoked_at', now - 101, 'web');
            const webOld = await end('expires_at', now - 1001, 'web');
            const live = (await target.create(user.id, {})).uuid;
            const firstId = Number((await rawRow(revoked)).id);

            // A range ending at `revoked` leaves the later rows alone.
            expect(
                await target.purgeEndedInRange(firstId - 1, 1, cutoffs),
            ).toBe(1);
            expect(await rawRow(revoked)).toBeNull();
            expect(await rawRow(expired)).not.toBeNull();

            const maxId = await target.maxId();
            expect(
                await target.purgeEndedInRange(
                    firstId,
                    maxId - firstId,
                    cutoffs,
                ),
            ).toBe(2);
            expect(await rawRow(expired)).toBeNull();
            expect(await rawRow(webOld)).toBeNull();
            expect(await rawRow(webRecent)).not.toBeNull();
            expect(await rawRow(live)).not.toBeNull();
        });
    });

    describe('revokeCascade', () => {
        it('revokes the root session and all child sessions', async () => {
            const user = await makeUser();
            const parent = await target.create(user.id);
            const child1 = await target.create(user.id, {
                kind: 'app',
                parent_session_id: parent.uuid,
            });
            const child2 = await target.create(user.id, {
                kind: 'access_token',
                parent_session_id: parent.uuid,
            });

            const revoked = await target.revokeCascade(parent.uuid);

            // Reported back so callers can tear down anything else holding
            // one of these sessions open.
            expect(revoked.userId).toBe(user.id);
            expect(new Set(revoked.uuids)).toEqual(
                new Set([parent.uuid, child1.uuid, child2.uuid]),
            );

            expect(await target.getByUuid(parent.uuid)).toBeNull();
            expect(await target.getByUuid(child1.uuid)).toBeNull();
            expect(await target.getByUuid(child2.uuid)).toBeNull();

            expect((await rawRow(parent.uuid)).revoked_at).not.toBeNull();
            expect((await rawRow(child1.uuid)).revoked_at).not.toBeNull();
            expect((await rawRow(child2.uuid)).revoked_at).not.toBeNull();
        });

        it('does not touch unrelated sessions', async () => {
            const user = await makeUser();
            const parent = await target.create(user.id);
            const sibling = await target.create(user.id);
            const childOfSibling = await target.create(user.id, {
                kind: 'app',
                parent_session_id: sibling.uuid,
            });

            await target.revokeCascade(parent.uuid);

            expect(await target.getByUuid(sibling.uuid)).toBeTruthy();
            expect(await target.getByUuid(childOfSibling.uuid)).toBeTruthy();
        });

        it('is a no-op when the root uuid does not exist', async () => {
            await expect(
                target.revokeCascade('nonexistent-uuid'),
            ).resolves.toBeNull();
        });

        it('is a no-op when called with a falsy uuid', async () => {
            await expect(target.revokeCascade('')).resolves.toBeNull();
            await expect(target.revokeCascade(undefined)).resolves.toBeNull();
        });

        it('keeps the revoked rows revoked when a lagging replica still shows them live', async () => {
            const user = await makeUser();
            const parent = await target.create(user.id);
            const child = await target.create(user.id, {
                kind: 'access_token',
                parent_session_id: parent.uuid,
            });
            const live = {
                [parent.uuid]: await rawRow(parent.uuid),
                [child.uuid]: await rawRow(child.uuid),
            };

            await target.revokeCascade(parent.uuid);

            const restore = lagReplica(live);
            try {
                expect(await target.getByUuid(parent.uuid)).toBeNull();
                expect(await target.getByUuid(child.uuid)).toBeNull();
                // A peer region gets the tombstone and a dropped key, so its
                // next miss reads the primary rather than its replica.
                await server.clients.redis.del(
                    `sessions:v2:uuid:${parent.uuid}`,
                );
                expect(await target.getByUuid(parent.uuid)).toBeNull();
            } finally {
                restore();
            }
            // The primary read re-cached the revoked row.
            expect(
                JSON.parse(
                    (await server.clients.redis.get(
                        `sessions:v2:uuid:${parent.uuid}`,
                    )) as string,
                ).revoked_at,
            ).not.toBeNull();
        });

        it('revokes a session the replica has not seen yet', async () => {
            const user = await makeUser();
            const parent = await target.create(user.id);
            const child = await target.create(user.id, {
                kind: 'access_token',
                parent_session_id: parent.uuid,
            });

            const restore = lagReplica({
                [parent.uuid]: null,
                [child.uuid]: null,
            });
            let revoked;
            try {
                revoked = await target.revokeCascade(parent.uuid);
            } finally {
                restore();
            }

            expect(new Set(revoked.uuids)).toEqual(
                new Set([parent.uuid, child.uuid]),
            );
            expect((await rawRow(child.uuid)).revoked_at).not.toBeNull();
        });
    });

    describe('revokeCascades', () => {
        it('revokes every root and its children, reported per user', async () => {
            const alice = await makeUser();
            const bob = await makeUser();
            const aliceWeb = await target.create(alice.id);
            const aliceAsset = await target.create(alice.id, {
                kind: 'asset',
                parent_session_id: aliceWeb.uuid,
            });
            const aliceApp = await target.getOrCreateApp(
                alice.id,
                `app-${uuidv4()}`,
            );
            const bobWeb = await target.create(bob.id);
            const untouched = await target.create(alice.id);

            const revoked = await target.revokeCascades([
                aliceWeb.uuid,
                // Already covered by its parent's cascade.
                aliceAsset.uuid,
                aliceApp.uuid,
                bobWeb.uuid,
            ]);

            const byUser = new Map(
                revoked.map((r: { userId: number; uuids: string[] }) => [
                    r.userId,
                    new Set(r.uuids),
                ]),
            );
            expect(byUser).toEqual(
                new Map([
                    [
                        alice.id,
                        new Set([
                            aliceWeb.uuid,
                            aliceAsset.uuid,
                            aliceApp.uuid,
                        ]),
                    ],
                    [bob.id, new Set([bobWeb.uuid])],
                ]),
            );
            for (const uuid of [
                aliceWeb.uuid,
                aliceAsset.uuid,
                aliceApp.uuid,
                bobWeb.uuid,
            ]) {
                expect(await target.getByUuid(uuid)).toBeNull();
            }
            expect(await target.getByUuid(untouched.uuid)).toBeTruthy();
            expect(
                (await target.getOrCreateApp(alice.id, aliceApp.app_uid)).uuid,
            ).not.toBe(aliceApp.uuid);
        });

        it('returns nothing when no root is active', async () => {
            expect(await target.revokeCascades([])).toEqual([]);
            expect(await target.revokeCascades(['nonexistent-uuid'])).toEqual(
                [],
            );
        });
    });

    // ── Composite-key lookups ──────────────────────────────────────

    describe('getOrCreateApp', () => {
        it('creates a kind="app" row on first call with the right shape', async () => {
            const user = await makeUser();
            const appUid = `app-${uuidv4()}`;
            const row = await target.getOrCreateApp(user.id, appUid, {
                auth_id: user.uuid,
            });
            expect(row).toBeTruthy();
            expect(row.kind).toBe('app');
            expect(row.app_uid).toBe(appUid);
            expect(row.parent_session_id).toBeNull();
            expect(row.user_id).toBe(user.id);
            // Sliding window seeded for app — bound matches the live
            // APP_WINDOW_SECONDS constant so a future bump to the window
            // doesn't silently fail this assertion.
            const now = Math.floor(Date.now() / 1000);
            expect(row.expires_at).toBeGreaterThan(now);
            expect(row.expires_at).toBeLessThanOrEqual(
                now + APP_WINDOW_SECONDS + 5,
            );
        });

        it('is idempotent for the same (user_id, app_uid)', async () => {
            const user = await makeUser();
            const appUid = `app-${uuidv4()}`;
            const a = await target.getOrCreateApp(user.id, appUid);
            const b = await target.getOrCreateApp(user.id, appUid);
            expect(a.uuid).toBe(b.uuid);
        });

        it('converges to a single row under concurrent racers', async () => {
            const user = await makeUser();
            const appUid = `app-${uuidv4()}`;
            const results = await Promise.all(
                Array.from({ length: 10 }, () =>
                    target.getOrCreateApp(user.id, appUid),
                ),
            );
            const uuids = new Set(results.map((r: { uuid: string }) => r.uuid));
            expect(uuids.size).toBe(1);
        });

        it('returns null when called with falsy inputs', async () => {
            expect(await target.getOrCreateApp(null, 'app-x')).toBeNull();
            expect(await target.getOrCreateApp(1, null)).toBeNull();
        });

        it('mints a new row after the previous one was revoked', async () => {
            // After revoke, the partial-unique index has no active row for
            // (user_id, app_uid), so a fresh INSERT succeeds with a new uuid.
            const user = await makeUser();
            const appUid = `app-${uuidv4()}`;
            const first = await target.getOrCreateApp(user.id, appUid);
            await target.removeByUuid(first.uuid);
            const second = await target.getOrCreateApp(user.id, appUid);
            expect(second.uuid).not.toBe(first.uuid);
        });

        it('mints a new row, and does not re-cache the revoked one, while a lagging replica shows it live', async () => {
            const user = await makeUser();
            const appUid = `app-${uuidv4()}`;
            const first = await target.getOrCreateApp(user.id, appUid);
            const live = await rawRow(first.uuid);

            await target.revokeCascade(first.uuid);
            // A peer region gets the tombstone and dropped keys, not the row.
            await server.clients.redis.del(`sessions:v2:uuid:${first.uuid}`);

            const restore = lagReplica({ [first.uuid]: live });
            let second;
            try {
                second = await target.getOrCreateApp(user.id, appUid);
                expect(await target.getByUuid(first.uuid)).toBeNull();
            } finally {
                restore();
            }
            expect(second.uuid).not.toBe(first.uuid);
            expect(await target.getByUuid(second.uuid)).toMatchObject({
                uuid: second.uuid,
            });
        });
    });

    describe('getOrCreateGodmodeToken', () => {
        const nowS = () => Math.floor(Date.now() / 1000);
        const mint = (
            userId: number,
            parentSessionUid: string,
            appUid = 'app-gm',
        ) =>
            target.getOrCreateGodmodeToken(userId, {
                parentSessionUid,
                appUid,
                expiresAt: nowS() + GODMODE_TOKEN_WINDOW_SECONDS,
                maxAgeSeconds: GODMODE_TOKEN_MAX_AGE_SECONDS,
            });
        const desktop = async () => {
            const user = await makeUser();
            const web = await target.create(user.id);
            return { userId: user.id as number, web: web.uuid as string };
        };

        it('renews from the cache with no primary read and no write', async () => {
            const { userId, web } = await desktop();
            const first = await mint(userId, web);

            const pread = vi.spyOn(server.clients.db, 'pread');
            const write = vi.spyOn(server.clients.db, 'write');
            try {
                const second = await mint(userId, web);
                expect(second.row.uuid).toBe(first.row.uuid);
                expect(second.row.expires_at).toBe(first.row.expires_at);
                expect(second.replaced).toBeNull();
                expect(pread).not.toHaveBeenCalled();
                expect(write).not.toHaveBeenCalled();
            } finally {
                pread.mockRestore();
                write.mockRestore();
            }
        });

        it('extends the row once the move is an hour or more', async () => {
            const { userId, web } = await desktop();
            const { row } = await mint(userId, web);
            await server.clients.db.write(
                'UPDATE `sessions` SET `expires_at` = ? WHERE `uuid` = ?',
                [nowS() + 2 * 60 * 60, row.uuid],
            );
            await target.publishCacheKeys({
                keys: [`sessions:v2:uuid:${row.uuid}`],
            });

            const renewed = await mint(userId, web);
            expect(renewed.row.uuid).toBe(row.uuid);
            expect(renewed.row.expires_at).toBeGreaterThanOrEqual(
                nowS() + GODMODE_TOKEN_WINDOW_SECONDS - 1,
            );
            expect((await rawRow(row.uuid)).expires_at).toBe(
                renewed.row.expires_at,
            );
        });

        it('mints a new row once the cached one is revoked', async () => {
            const { userId, web } = await desktop();
            const first = await mint(userId, web);
            await target.revokeCascade(first.row.uuid);

            const next = await mint(userId, web);
            expect(next.row.uuid).not.toBe(first.row.uuid);
            expect(next.replaced).toBeNull();

            const second = await mint(userId, web);
            await target.removeByUuid(second.row.uuid);
            expect((await mint(userId, web)).row.uuid).not.toBe(
                second.row.uuid,
            );
        });

        it('mints a new row when a lagging read re-cached the revoked one', async () => {
            const { userId, web } = await desktop();
            const { row } = await mint(userId, web);
            await target.revokeCascade(row.uuid);
            // A replica that hadn't seen the revoke yet answered a read.
            await server.clients.redis.set(
                `sessions:v2:uuid:${row.uuid}`,
                JSON.stringify(row),
            );

            const next = await mint(userId, web);
            expect(next.row.uuid).not.toBe(row.uuid);
        });

        it('mints a new row when a renewal finds the cached one already revoked', async () => {
            const { userId, web } = await desktop();
            const { row } = await mint(userId, web);
            const soon = nowS() + 2 * 60 * 60;
            // Revoked in the database, still live and due for renewal in the cache.
            await server.clients.db.write(
                'UPDATE `sessions` SET `revoked_at` = ? WHERE `uuid` = ?',
                [nowS(), row.uuid],
            );
            await server.clients.redis.set(
                `sessions:v2:uuid:${row.uuid}`,
                JSON.stringify({ ...row, expires_at: soon }),
            );

            const next = await mint(userId, web);
            expect(next.row.uuid).not.toBe(row.uuid);
            expect((await rawRow(row.uuid)).expires_at).toBe(row.expires_at);
        });

        it('keeps one row per web session and app', async () => {
            const { userId, web } = await desktop();
            const other = (await target.create(userId)).uuid;
            const first = await mint(userId, web);

            expect((await mint(userId, other)).row.uuid).not.toBe(
                first.row.uuid,
            );
            expect((await mint(userId, web, 'app-gm-other')).row.uuid).not.toBe(
                first.row.uuid,
            );
            expect((await mint(userId, web)).row.uuid).toBe(first.row.uuid);
        });

        it('ignores a cached pointer to a row of another session', async () => {
            const { userId, web } = await desktop();
            const other = (await target.create(userId)).uuid;
            const mine = await mint(userId, web);
            const theirs = await mint(userId, other);
            await server.clients.redis.set(
                `sessions:v2:godmode:${userId}:${web}:app-gm`,
                JSON.stringify({ uuid: theirs.row.uuid }),
            );

            expect((await mint(userId, web)).row.uuid).toBe(mine.row.uuid);
        });
    });

    describe('getOrCreateWorker', () => {
        it('creates a kind="worker" row tagged meta.worker / meta.worker_name', async () => {
            const user = await makeUser();
            const appUid = `app-${uuidv4()}`;
            const workerName = `wk-${Math.random().toString(36).slice(2, 8)}`;
            const row = await target.getOrCreateWorker(user.id, {
                appUid,
                workerName,
                auth_id: user.uuid,
            });
            expect(row).toBeTruthy();
            expect(row.kind).toBe('worker');
            expect(row.app_uid).toBe(appUid);
            expect(row.user_id).toBe(user.id);
            expect(row.parent_session_id).toBeNull();
            expect(row.meta.worker).toBe(true);
            expect(row.meta.worker_name).toBe(workerName);

            // Sliding window seeded for worker — bound matches the live
            // WORKER_WINDOW_SECONDS constant so a future bump to the window
            // doesn't silently fail this assertion.
            const now = Math.floor(Date.now() / 1000);
            expect(row.expires_at).toBeGreaterThan(now);
            expect(row.expires_at).toBeLessThanOrEqual(
                now + WORKER_WINDOW_SECONDS + 5,
            );

            const raw = await rawRow(row.uuid);
            expect(raw.kind).toBe('worker');
            expect(raw.app_uid).toBe(appUid);
        });

        it('is idempotent on (user, app, worker_name)', async () => {
            const user = await makeUser();
            const appUid = `app-${uuidv4()}`;
            const workerName = `wk-${Math.random().toString(36).slice(2, 8)}`;
            const a = await target.getOrCreateWorker(user.id, {
                appUid,
                workerName,
            });
            const b = await target.getOrCreateWorker(user.id, {
                appUid,
                workerName,
            });
            expect(a.uuid).toBe(b.uuid);
        });

        it('is idempotent on (user, worker_name) when app_uid is null (user-scoped)', async () => {
            // The partial unique index uses IFNULL(app_uid, '') so two
            // user-scoped (app_uid=null) workers with the same worker_name
            // still dedupe. Without IFNULL, SQLite would treat the NULLs as
            // distinct per the SQL standard and let duplicates through.
            const user = await makeUser();
            const workerName = `wk-${Math.random().toString(36).slice(2, 8)}`;
            const a = await target.getOrCreateWorker(user.id, {
                appUid: null,
                workerName,
            });
            const b = await target.getOrCreateWorker(user.id, {
                appUid: null,
                workerName,
            });
            expect(a.uuid).toBe(b.uuid);
            expect(a.app_uid).toBeNull();
        });

        it('mints distinct rows for different worker_names under the same (user, app)', async () => {
            const user = await makeUser();
            const appUid = `app-${uuidv4()}`;
            const a = await target.getOrCreateWorker(user.id, {
                appUid,
                workerName: `wk-${Math.random().toString(36).slice(2, 8)}-a`,
            });
            const b = await target.getOrCreateWorker(user.id, {
                appUid,
                workerName: `wk-${Math.random().toString(36).slice(2, 8)}-b`,
            });
            expect(a.uuid).not.toBe(b.uuid);
        });

        it('does NOT collide with an interactive kind="app" row for the same (user, app)', async () => {
            // Worker rows are intentionally carved out of the
            // idx_sessions_user_app_active index (which is WHERE kind='app').
            // An app session and a worker session for the same (user, app)
            // must coexist.
            const user = await makeUser();
            const appUid = `app-${uuidv4()}`;
            const appRow = await target.getOrCreateApp(user.id, appUid);
            const workerRow = await target.getOrCreateWorker(user.id, {
                appUid,
                workerName: `wk-${Math.random().toString(36).slice(2, 8)}`,
            });
            expect(appRow.uuid).not.toBe(workerRow.uuid);
            expect(appRow.kind).toBe('app');
            expect(workerRow.kind).toBe('worker');
        });

        it('converges to a single row under concurrent racers', async () => {
            const user = await makeUser();
            const appUid = `app-${uuidv4()}`;
            const workerName = `wk-${Math.random().toString(36).slice(2, 8)}`;
            const results = await Promise.all(
                Array.from({ length: 10 }, () =>
                    target.getOrCreateWorker(user.id, { appUid, workerName }),
                ),
            );
            const uuids = new Set(results.map((r: { uuid: string }) => r.uuid));
            expect(uuids.size).toBe(1);

            // And only one row ever made it into the table.
            const rows = await server.clients.db.read(
                "SELECT `uuid` FROM `sessions` WHERE `user_id` = ? AND `kind` = 'worker' AND `app_uid` = ?",
                [user.id, appUid],
            );
            expect(rows).toHaveLength(1);
        });

        it('returns null when called with falsy inputs', async () => {
            expect(
                await target.getOrCreateWorker(null, { workerName: 'wk' }),
            ).toBeNull();
            expect(await target.getOrCreateWorker(1, {})).toBeNull();
            expect(
                await target.getOrCreateWorker(1, { workerName: '' }),
            ).toBeNull();
        });

        it('mints a new row after the previous one was revoked', async () => {
            // After revoke, the partial-unique index has no active row
            // for (user_id, app_uid, worker_name), so the next call mints
            // a fresh uuid instead of being short-circuited by the
            // composite cache or by re-SELECTing the revoked row.
            const user = await makeUser();
            const appUid = `app-${uuidv4()}`;
            const workerName = `wk-${Math.random().toString(36).slice(2, 8)}`;
            const first = await target.getOrCreateWorker(user.id, {
                appUid,
                workerName,
            });
            await target.removeByUuid(first.uuid);
            const second = await target.getOrCreateWorker(user.id, {
                appUid,
                workerName,
            });
            expect(second.uuid).not.toBe(first.uuid);
            expect(second.kind).toBe('worker');
        });

        it('revokeCascade invalidates the worker composite cache', async () => {
            // Mirrors the app cascade-invalidation test. First call primes
            // the worker composite cache; cascading revoke must drop it so
            // the next call doesn't serve the revoked row.
            const user = await makeUser();
            const appUid = `app-${uuidv4()}`;
            const workerName = `wk-${Math.random().toString(36).slice(2, 8)}`;
            const first = await target.getOrCreateWorker(user.id, {
                appUid,
                workerName,
            });
            await target.revokeCascade(first.uuid);
            const second = await target.getOrCreateWorker(user.id, {
                appUid,
                workerName,
            });
            expect(second.uuid).not.toBe(first.uuid);
        });
    });

    describe('listWorkerSessions', () => {
        it('pages live sessions for one worker name, oldest id first', async () => {
            const user = await makeUser();
            const workerName = `wk-${Math.random().toString(36).slice(2, 8)}`;
            const appA = `app-${uuidv4()}`;
            const appB = `app-${uuidv4()}`;
            const a = await target.getOrCreateWorker(user.id, {
                appUid: appA,
                workerName,
            });
            const b = await target.getOrCreateWorker(user.id, {
                appUid: appB,
                workerName,
            });

            const rows = await target.listWorkerSessions({ workerName });
            const uuids = rows.map((row: { uuid: string }) => row.uuid);
            expect(uuids).toContain(a.uuid);
            expect(uuids).toContain(b.uuid);
            expect(rows.every((row: { id: number }) => Number.isFinite(row.id)))
                .toBe(true);
        });

        it('does not return a revoked session', async () => {
            const user = await makeUser();
            const workerName = `wk-${Math.random().toString(36).slice(2, 8)}`;
            const row = await target.getOrCreateWorker(user.id, {
                appUid: `app-${uuidv4()}`,
                workerName,
            });
            await target.removeByUuid(row.uuid);

            const rows = await target.listWorkerSessions({ workerName });
            expect(rows.map((r: { uuid: string }) => r.uuid)).not.toContain(
                row.uuid,
            );
        });

        it('never returns a different worker name', async () => {
            const user = await makeUser();
            const appUid = `app-${uuidv4()}`;
            const wanted = `wk-${Math.random().toString(36).slice(2, 8)}`;
            const other = `wk-${Math.random().toString(36).slice(2, 8)}`;
            await target.getOrCreateWorker(user.id, {
                appUid,
                workerName: other,
            });

            const rows = await target.listWorkerSessions({
                workerName: wanted,
            });
            expect(rows).toEqual([]);
        });

        it('a user-scoped worker (no app) is never returned', async () => {
            // The stray-session sweep only ever finds rows with an app to
            // check for existence — a worker session with no app has
            // nothing for it to resolve.
            const user = await makeUser();
            const workerName = `wk-${Math.random().toString(36).slice(2, 8)}`;
            await target.getOrCreateWorker(user.id, {
                appUid: null,
                workerName,
            });

            const rows = await target.listWorkerSessions({ workerName });
            expect(rows).toEqual([]);
        });

        it('respects the keyset cursor and limit', async () => {
            const user = await makeUser();
            const workerName = `wk-${Math.random().toString(36).slice(2, 8)}`;
            const first = await target.getOrCreateWorker(user.id, {
                appUid: `app-${uuidv4()}`,
                workerName,
            });
            const second = await target.getOrCreateWorker(user.id, {
                appUid: `app-${uuidv4()}`,
                workerName,
            });

            const page = await target.listWorkerSessions({
                workerName,
                limit: 1,
            });
            expect(page).toHaveLength(1);
            expect(page[0].uuid).toBe(first.uuid);

            const next = await target.listWorkerSessions({
                workerName,
                afterId: page[0].id,
            });
            expect(next.map((r: { uuid: string }) => r.uuid)).toContain(
                second.uuid,
            );
            expect(next.map((r: { uuid: string }) => r.uuid)).not.toContain(
                first.uuid,
            );
        });
    });

    describe('deleteWorkerSessions', () => {
        const name = () => `wk-${Math.random().toString(36).slice(2, 8)}`;

        it('deletes every row of a worker name across users and apps, and nothing else', async () => {
            const alice = await makeUser();
            const bob = await makeUser();
            const workerName = name();
            const userScoped = await target.getOrCreateWorker(alice.id, {
                appUid: null,
                workerName,
            });
            const appScoped = await target.getOrCreateWorker(bob.id, {
                appUid: `app-${uuidv4()}`,
                workerName,
            });
            const otherWorker = await target.getOrCreateWorker(alice.id, {
                appUid: null,
                workerName: name(),
            });

            const deleted = await target.deleteWorkerSessions({ workerName });

            expect(deleted.map((r: { uuid: string }) => r.uuid).sort()).toEqual(
                [userScoped.uuid, appScoped.uuid].sort(),
            );
            expect(await rawRow(userScoped.uuid)).toBeNull();
            expect(await rawRow(appScoped.uuid)).toBeNull();
            expect(await rawRow(otherWorker.uuid)).not.toBeNull();
        });

        it('filters by user and app together', async () => {
            const user = await makeUser();
            const other = await makeUser();
            const appUid = `app-${uuidv4()}`;
            const deployed = await target.getOrCreateWorker(user.id, {
                appUid,
                workerName: name(),
            });
            const otherApp = await target.getOrCreateWorker(user.id, {
                appUid: `app-${uuidv4()}`,
                workerName: name(),
            });
            const userScoped = await target.getOrCreateWorker(user.id, {
                appUid: null,
                workerName: name(),
            });
            const otherUser = await target.getOrCreateWorker(other.id, {
                appUid,
                workerName: name(),
            });

            await target.deleteWorkerSessions({ userId: user.id, appUid });

            expect(await rawRow(deployed.uuid)).toBeNull();
            expect(await rawRow(otherApp.uuid)).not.toBeNull();
            expect(await rawRow(userScoped.uuid)).not.toBeNull();
            expect(await rawRow(otherUser.uuid)).not.toBeNull();
        });

        it('takes derived sessions with it', async () => {
            const user = await makeUser();
            const worker = await target.getOrCreateWorker(user.id, {
                appUid: `app-${uuidv4()}`,
                workerName: name(),
            });
            const child = await target.create(user.id, {
                kind: 'access_token',
                parent_session_id: worker.uuid,
                access_token_uid: uuidv4(),
            });

            const deleted = await target.deleteWorkerSessions({
                userId: user.id,
                appUid: worker.app_uid,
            });

            expect(await rawRow(child.uuid)).toBeNull();
            expect(
                deleted.find((r: { uuid: string }) => r.uuid === child.uuid)
                    ?.accessTokenUid,
            ).toBe(child.access_token_uid);
        });

        it('drops the cached rows, so a lookup misses and a redeploy mints fresh', async () => {
            const user = await makeUser();
            const workerName = name();
            const first = await target.getOrCreateWorker(user.id, {
                appUid: null,
                workerName,
            });
            // Warm both the uuid and the composite worker cache.
            expect(await target.getByUuidAny(first.uuid)).toBeTruthy();
            expect(
                await target.getWorker(user.id, { appUid: null, workerName }),
            ).toBeTruthy();

            await target.deleteWorkerSessions({ workerName });

            expect(await target.getByUuidAny(first.uuid)).toBeNull();
            const second = await target.getOrCreateWorker(user.id, {
                appUid: null,
                workerName,
            });
            expect(second.uuid).not.toBe(first.uuid);
        });

        it('keeps a deleted session gone while a lagging replica still has it', async () => {
            const user = await makeUser();
            const workerName = name();
            const worker = await target.getOrCreateWorker(user.id, {
                appUid: null,
                workerName,
            });
            const live = await rawRow(worker.uuid);

            await target.deleteWorkerSessions({ workerName });

            const restore = lagReplica({ [worker.uuid]: live });
            try {
                expect(await target.getByUuidAny(worker.uuid)).toBeNull();
                expect(
                    await target.getWorker(user.id, {
                        appUid: null,
                        workerName,
                    }),
                ).toBeNull();
            } finally {
                restore();
            }
        });

        it('refuses to run without a filter', async () => {
            const user = await makeUser();
            const row = await target.getOrCreateWorker(user.id, {
                appUid: null,
                workerName: name(),
            });
            expect(await target.deleteWorkerSessions({})).toEqual([]);
            expect(await rawRow(row.uuid)).not.toBeNull();
        });
    });

    describe('error propagation (no silent swallow)', () => {
        // INSERT-IGNORE used to mask every constraint violation, not just
        // the partial-unique-index conflict the `getOrCreate*` paths rely
        // on for idempotency. These tests pin the post-fix behavior: real
        // schema errors throw, the unique-key conflict path still no-ops.

        it('create() with an unsupported kind throws (CHECK constraint surfaces)', async () => {
            // The `sessions.kind` column carries a CHECK constraint
            // restricting it to the known set. A bogus kind must throw
            // rather than be silently coerced or swallowed.
            const user = await makeUser();
            await expect(
                target.create(user.id, { kind: 'not-a-real-kind' }),
            ).rejects.toThrow();
        });

        it('create() accepts kind="worker" (regression: post-migration the CHECK allows it)', async () => {
            // Sanity check that migration 0056 actually relaxed the CHECK.
            // Pre-migration this threw `CHECK constraint failed`.
            const user = await makeUser();
            const session = await target.create(user.id, {
                kind: 'worker',
                meta: { worker: true, worker_name: 'direct' },
            });
            expect(session.kind).toBe('worker');
        });

        it('create() with a duplicate (user_id, app_uid) on kind="app" throws (UNIQUE surfaces)', async () => {
            // `create()` runs with ignoreConflict=false, so the partial
            // unique index `idx_sessions_user_app_active` fires loudly.
            // This is the path that pre-fix `INSERT IGNORE` was silently
            // collapsing — verify it now throws as expected.
            const user = await makeUser();
            const appUid = `app-${uuidv4()}`;
            await target.create(user.id, { kind: 'app', app_uid: appUid });
            await expect(
                target.create(user.id, { kind: 'app', app_uid: appUid }),
            ).rejects.toThrow();
        });

        it('getOrCreateApp swallows the partial-unique conflict (idempotent get-or-create)', async () => {
            // Counterpart to the previous test. The same INSERT path
            // routed through getOrCreateApp (ignoreConflict=true) must
            // still no-op the unique-key conflict and return the existing
            // row instead of throwing.
            const user = await makeUser();
            const appUid = `app-${uuidv4()}`;
            const first = await target.getOrCreateApp(user.id, appUid);
            await expect(
                target.getOrCreateApp(user.id, appUid),
            ).resolves.toMatchObject({ uuid: first.uuid });
        });
    });

    describe('touch slides expires_at per kind', () => {
        it('extends expires_at on web sessions', async () => {
            const user = await makeUser();
            const session = await target.create(user.id, { kind: 'web' });
            // Backdate the row so the SQL `last_activity < ?` guard
            // fires deterministically on the slide call. Test would
            // otherwise be racy against same-second precision.
            const ancient = Math.floor(Date.now() / 1000) - 3600;
            await server.clients.db.write(
                'UPDATE `sessions` SET `last_activity` = ?, `expires_at` = ? WHERE `uuid` = ?',
                [ancient, ancient + 30 * 24 * 60 * 60, session.uuid],
            );

            const now = Math.floor(Date.now() / 1000);
            await target.updateActivity(session.uuid, now);

            const row = await rawRow(session.uuid);
            // After slide, expires_at = now + WEB_WINDOW_SECONDS (within
            // a tolerance for between-statement wall-clock drift). Use
            // the constant directly so a future window bump doesn't
            // need a parallel edit here.
            expect(row.expires_at).toBeGreaterThanOrEqual(
                now + WEB_WINDOW_SECONDS - 5,
            );
            expect(row.expires_at).toBeLessThanOrEqual(
                now + WEB_WINDOW_SECONDS + 5,
            );
        });

        it('does NOT slide expires_at on access_token rows (hard expiry)', async () => {
            const user = await makeUser();
            const hard = Math.floor(Date.now() / 1000) + 3600;
            const session = await target.create(user.id, {
                kind: 'access_token',
                expires_at: hard,
            });
            await target.updateActivity(
                session.uuid,
                Math.floor(Date.now() / 1000),
            );
            const row = await rawRow(session.uuid);
            expect(row.expires_at).toBe(hard);
        });
    });

    describe('updateActivity refreshes last_ip / last_user_agent', () => {
        // Backdate so the SQL `last_activity < ?` guard fires deterministically.
        const backdate = async (uuid: string) => {
            const ancient = Math.floor(Date.now() / 1000) - 3600;
            await server.clients.db.write(
                'UPDATE `sessions` SET `last_activity` = ? WHERE `uuid` = ?',
                [ancient, uuid],
            );
        };

        it('writes new ip and user-agent when changed', async () => {
            const user = await makeUser();
            const session = await target.create(user.id, {
                kind: 'web',
                last_ip: '1.1.1.1',
                last_user_agent: 'old-agent',
            });
            await backdate(session.uuid);

            await target.updateActivity(
                session.uuid,
                Math.floor(Date.now() / 1000),
                { ip: '2.2.2.2', userAgent: 'new-agent' },
            );

            const row = await rawRow(session.uuid);
            expect(row.last_ip).toBe('2.2.2.2');
            expect(row.last_user_agent).toBe('new-agent');
        });

        it('leaves existing ip / ua untouched when args are null', async () => {
            const user = await makeUser();
            const session = await target.create(user.id, {
                kind: 'web',
                last_ip: '3.3.3.3',
                last_user_agent: 'keep-me',
            });
            await backdate(session.uuid);

            await target.updateActivity(
                session.uuid,
                Math.floor(Date.now() / 1000),
                {},
            );

            const row = await rawRow(session.uuid);
            expect(row.last_ip).toBe('3.3.3.3');
            expect(row.last_user_agent).toBe('keep-me');
        });

        it('does not overwrite when values are unchanged', async () => {
            const user = await makeUser();
            const session = await target.create(user.id, {
                kind: 'web',
                last_ip: '4.4.4.4',
                last_user_agent: 'same-agent',
            });
            await backdate(session.uuid);

            await target.updateActivity(
                session.uuid,
                Math.floor(Date.now() / 1000),
                { ip: '4.4.4.4', userAgent: 'same-agent' },
            );

            const row = await rawRow(session.uuid);
            expect(row.last_ip).toBe('4.4.4.4');
            expect(row.last_user_agent).toBe('same-agent');
        });
    });

    describe('setLabel', () => {
        it('renames the label for the owning user', async () => {
            const user = await makeUser();
            const session = await target.create(user.id, { label: 'old' });
            const ok = await target.setLabel(session.uuid, user.id, 'new');
            expect(ok).toBe(true);
            const row = await rawRow(session.uuid);
            expect(row.label).toBe('new');
        });

        it('returns false when the uuid belongs to another user', async () => {
            const owner = await makeUser();
            const interloper = await makeUser();
            const session = await target.create(owner.id, { label: 'mine' });
            const ok = await target.setLabel(
                session.uuid,
                interloper.id,
                'pwned',
            );
            expect(ok).toBe(false);
            const row = await rawRow(session.uuid);
            expect(row.label).toBe('mine');
        });

        it('returns false when the row is soft-revoked', async () => {
            const user = await makeUser();
            const session = await target.create(user.id, { label: 'live' });
            await target.removeByUuid(session.uuid);
            const ok = await target.setLabel(session.uuid, user.id, 'after');
            expect(ok).toBe(false);
            const row = await rawRow(session.uuid);
            expect(row.label).toBe('live');
        });

        it('returns false on falsy uuid / userId', async () => {
            expect(await target.setLabel('', 1, 'x')).toBe(false);
            expect(await target.setLabel('some-uuid', 0, 'x')).toBe(false);
        });
    });

    describe('revokeCascade invalidates composite caches', () => {
        it('a revoked app row is not re-served by getOrCreateApp cache hit', async () => {
            // First create primes the app composite cache. Revoke via
            // cascade should invalidate it so the next call mints fresh.
            const user = await makeUser();
            const appUid = `app-${uuidv4()}`;
            const first = await target.getOrCreateApp(user.id, appUid);
            await target.revokeCascade(first.uuid);
            const second = await target.getOrCreateApp(user.id, appUid);
            expect(second.uuid).not.toBe(first.uuid);
        });
    });
});
