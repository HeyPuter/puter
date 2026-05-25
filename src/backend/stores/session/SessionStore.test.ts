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

        it('returns the row even when expires_at is in the past (AUTH-4 owns expiry)', async () => {
            const user = await makeUser();
            const past = Math.floor(Date.now() / 1000) - 60;
            const session = await target.create(user.id, { expires_at: past });
            const fetched = await target.getByUuid(session.uuid);
            expect(fetched).toBeTruthy();
            expect(fetched.uuid).toBe(session.uuid);
            expect(fetched.expires_at).toBe(past);
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
});
