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

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { setupTestServer } from '../../testUtil.ts';
import { PuterServer } from '../../server.ts';

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
            // PUT-1014 moved expires_at enforcement into getByUuid so the
            // row is the single source of truth — no AUTH-4 re-mint pass
            // needed (we run long-lived JWTs in v2).
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

            await target.revokeCascade(parent.uuid);

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
            ).resolves.toBeUndefined();
        });

        it('is a no-op when called with a falsy uuid', async () => {
            await expect(target.revokeCascade('')).resolves.toBeUndefined();
            await expect(
                target.revokeCascade(undefined),
            ).resolves.toBeUndefined();
        });
    });

    // ── PUT-1014 composite-key lookups ──────────────────────────────

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
            // Sliding window seeded — 90 days for app.
            const now = Math.floor(Date.now() / 1000);
            expect(row.expires_at).toBeGreaterThan(now);
            expect(row.expires_at).toBeLessThanOrEqual(
                now + 90 * 24 * 60 * 60 + 5,
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
    });

    describe('findOrCreateLegacyAccessToken', () => {
        it('creates a kind="access_token" row tagged legacy_backfill', async () => {
            const user = await makeUser();
            const tokenUid = uuidv4();
            const row = await target.findOrCreateLegacyAccessToken(tokenUid, {
                userId: user.id,
                auth_id: user.uuid,
            });
            expect(row.kind).toBe('access_token');
            expect(row.legacy_token_uid).toBe(tokenUid);
            expect(row.created_via).toBe('legacy_backfill');
        });

        it('is idempotent for the same legacy_token_uid', async () => {
            const user = await makeUser();
            const tokenUid = uuidv4();
            const a = await target.findOrCreateLegacyAccessToken(tokenUid, {
                userId: user.id,
            });
            const b = await target.findOrCreateLegacyAccessToken(tokenUid, {
                userId: user.id,
            });
            expect(a.uuid).toBe(b.uuid);
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
            // After slide, expires_at = now + 30d (within a tolerance
            // for between-statement wall-clock drift).
            expect(row.expires_at).toBeGreaterThanOrEqual(
                now + 30 * 24 * 60 * 60 - 5,
            );
            expect(row.expires_at).toBeLessThanOrEqual(
                now + 30 * 24 * 60 * 60 + 5,
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
