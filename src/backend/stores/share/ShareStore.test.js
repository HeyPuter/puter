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

describe('ShareStore', () => {
    let server;
    let store;
    let issuer;
    let otherIssuer;

    const makeUser = async () => {
        const username = `share-${Math.random().toString(36).slice(2, 10)}`;
        return server.stores.user.create({
            username,
            uuid: uuidv4(),
            password: null,
            email: `${username}@test.local`,
        });
    };

    beforeAll(async () => {
        server = await setupTestServer();
        store = server.stores.share;
        issuer = await makeUser();
        otherIssuer = await makeUser();
    });

    afterAll(async () => {
        await server?.shutdown();
    });

    // -- create -------------------------------------------------------

    it('creates a share with a generated uid and returns the stored row', async () => {
        const created = await store.create({
            issuerUserId: issuer.id,
            recipientEmail: 'invitee@test.local',
            data: { permissions: ['fs:/foo:read'] },
        });

        expect(created.uid).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u,
        );
        expect(created.issuer_user_id).toBe(issuer.id);
        expect(created.recipient_email).toBe('invitee@test.local');
        expect(created.data).toEqual({ permissions: ['fs:/foo:read'] });
        expect(created.created_at).toBeDefined();
    });

    it('gives each share a distinct uid', async () => {
        const a = await store.create({
            issuerUserId: issuer.id,
            recipientEmail: 'dup@test.local',
            data: {},
        });
        const b = await store.create({
            issuerUserId: issuer.id,
            recipientEmail: 'dup@test.local',
            data: {},
        });
        expect(a.uid).not.toBe(b.uid);
    });

    it('stores a pre-serialized JSON string as-is and parses it back on read', async () => {
        const created = await store.create({
            issuerUserId: issuer.id,
            recipientEmail: 'raw@test.local',
            data: JSON.stringify({ a: 1 }),
        });
        expect(created.data).toEqual({ a: 1 });
    });

    it('defaults missing data to an empty object', async () => {
        const created = await store.create({
            issuerUserId: issuer.id,
            recipientEmail: 'nodata@test.local',
        });
        expect(created.data).toEqual({});
    });

    it('leaves a non-JSON string payload as a string rather than throwing', async () => {
        const created = await store.create({
            issuerUserId: issuer.id,
            recipientEmail: 'plain@test.local',
            data: 'not-json',
        });
        expect(created.data).toBe('not-json');
    });

    it('rejects a create with no issuer or no recipient', async () => {
        await expect(
            store.create({ recipientEmail: 'x@test.local' }),
        ).rejects.toThrow('issuerUserId and recipientEmail are required');
        await expect(store.create({ issuerUserId: issuer.id })).rejects.toThrow(
            'issuerUserId and recipientEmail are required',
        );
        await expect(
            store.create({ issuerUserId: issuer.id, recipientEmail: '' }),
        ).rejects.toThrow('issuerUserId and recipientEmail are required');
    });

    // -- reads --------------------------------------------------------

    it('returns null for an unknown uid instead of throwing', async () => {
        expect(await store.getByUid('no-such-share')).toBeNull();
    });

    it('lists only the shares addressed to the requested recipient', async () => {
        const email = `recipient-${Date.now()}@test.local`;
        const mine = await store.create({
            issuerUserId: issuer.id,
            recipientEmail: email,
            data: { n: 1 },
        });
        await store.create({
            issuerUserId: issuer.id,
            recipientEmail: `other-${Date.now()}@test.local`,
            data: { n: 2 },
        });

        const rows = await store.listByRecipientEmail(email);
        expect(rows.map((r) => r.uid)).toEqual([mine.uid]);
        expect(rows[0].data).toEqual({ n: 1 });
    });

    it('returns an empty list for a recipient with no shares', async () => {
        expect(await store.listByRecipientEmail('nobody@test.local')).toEqual(
            [],
        );
    });

    it('never leaks another issuer rows through listByIssuer', async () => {
        const mine = await store.create({
            issuerUserId: issuer.id,
            recipientEmail: 'iso-a@test.local',
            data: {},
        });
        const theirs = await store.create({
            issuerUserId: otherIssuer.id,
            recipientEmail: 'iso-b@test.local',
            data: {},
        });

        const uids = (await store.listByIssuer(otherIssuer.id)).map(
            (r) => r.uid,
        );
        expect(uids).toContain(theirs.uid);
        expect(uids).not.toContain(mine.uid);
    });

    it('orders a recipient inbox newest-first', async () => {
        const email = `ordered-${Date.now()}@test.local`;
        const older = await store.create({
            issuerUserId: issuer.id,
            recipientEmail: email,
            data: { which: 'older' },
        });
        const newer = await store.create({
            issuerUserId: issuer.id,
            recipientEmail: email,
            data: { which: 'newer' },
        });
        // `created_at` defaults to a second-granularity timestamp, so both
        // rows can land in the same second. Age one explicitly.
        await server.clients.db.write(
            "UPDATE `share` SET `created_at` = '2020-01-01 00:00:00' WHERE `uid` = ?",
            [older.uid],
        );

        const rows = await store.listByRecipientEmail(email);
        expect(rows.map((r) => r.uid)).toEqual([newer.uid, older.uid]);
    });

    // -- deletes ------------------------------------------------------

    it('deletes a single share by uid and reports whether a row was removed', async () => {
        const created = await store.create({
            issuerUserId: issuer.id,
            recipientEmail: 'del@test.local',
            data: {},
        });

        expect(await store.deleteByUid(created.uid)).toBe(true);
        expect(await store.getByUid(created.uid)).toBeNull();
        // Second delete finds nothing.
        expect(await store.deleteByUid(created.uid)).toBe(false);
    });

    it('deletes every share for a recipient in one call', async () => {
        const email = `bulk-${Date.now()}@test.local`;
        await store.create({
            issuerUserId: issuer.id,
            recipientEmail: email,
            data: {},
        });
        await store.create({
            issuerUserId: otherIssuer.id,
            recipientEmail: email,
            data: {},
        });
        const survivor = await store.create({
            issuerUserId: issuer.id,
            recipientEmail: `keep-${Date.now()}@test.local`,
            data: {},
        });

        expect(await store.deleteByRecipientEmail(email)).toBe(true);
        expect(await store.listByRecipientEmail(email)).toEqual([]);
        expect(await store.getByUid(survivor.uid)).not.toBeNull();
    });

    it('reports false when a recipient bulk delete matches nothing', async () => {
        expect(await store.deleteByRecipientEmail('ghost@test.local')).toBe(
            false,
        );
    });
});
