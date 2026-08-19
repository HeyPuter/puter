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

    // -- active shares (the index) -------------------------------------

    describe('active shares', () => {
        let holder;

        const makeEntry = async (owner) => {
            const uuid = uuidv4();
            await server.clients.db.write(
                'INSERT INTO `fsentries` (`uuid`, `name`, `path`, `user_id`, `is_dir`, `modified`) VALUES (?, ?, ?, ?, 0, ?)',
                [
                    uuid,
                    `f-${uuid.slice(0, 8)}`,
                    `/x/${uuid}`,
                    owner.id,
                    Math.floor(Date.now() / 1000),
                ],
            );
            const rows = await server.clients.db.read(
                'SELECT `id` FROM `fsentries` WHERE `uuid` = ?',
                [uuid],
            );
            return { id: Number(rows[0].id), uuid };
        };

        beforeAll(async () => {
            holder = await makeUser();
        });

        it('finds a subtree share even when the descendant has no path yet', async () => {
            const now = Math.floor(Date.now() / 1000);
            const dirUuid = uuidv4();
            await server.clients.db.write(
                'INSERT INTO `fsentries` (`uuid`, `name`, `path`, `user_id`, `is_dir`, `modified`) VALUES (?, ?, ?, ?, 1, ?)',
                [dirUuid, `d-${dirUuid.slice(0, 8)}`, `/x/${dirUuid}`, issuer.id, now],
            );
            const dirRows = await server.clients.db.read(
                'SELECT `id` FROM `fsentries` WHERE `uuid` = ?',
                [dirUuid],
            );
            const dirId = Number(dirRows[0].id);

            const childUuid = uuidv4();
            await server.clients.db.write(
                'INSERT INTO `fsentries` (`uuid`, `name`, `path`, `user_id`, `is_dir`, `modified`, `parent_id`, `parent_uid`) VALUES (?, ?, NULL, ?, 0, ?, ?, ?)',
                [childUuid, `f-${childUuid.slice(0, 8)}`, issuer.id, now, dirId, dirUuid],
            );
            const childRows = await server.clients.db.read(
                'SELECT `id` FROM `fsentries` WHERE `uuid` = ?',
                [childUuid],
            );
            const childId = Number(childRows[0].id);

            await store.upsertActive({
                issuerUserId: issuer.id,
                holderUserId: holder.id,
                fsentryId: childId,
                mode: 'read',
            });

            const rows = await store.listByFsentrySubtree(dirId);
            expect(
                rows.some((r) => Number(r.fsentry_id) === childId),
            ).toBe(true);
        });

        it('records an active share and lists it for the holder', async () => {
            const entry = await makeEntry(issuer);
            const created = await store.upsertActive({
                issuerUserId: issuer.id,
                holderUserId: holder.id,
                fsentryId: entry.id,
                mode: 'read',
            });

            expect(created.holder_user_id).toBe(holder.id);
            expect(created.fsentry_id).toBe(entry.id);
            expect(created.mode).toBe('read');
            expect(created.applied_at).toBeTruthy();

            const page = await store.listByHolder(holder.id);
            expect(page.items.map((r) => r.uid)).toContain(created.uid);
        });

        it('moves an existing share to a new mode instead of duplicating it', async () => {
            const entry = await makeEntry(issuer);
            const first = await store.upsertActive({
                issuerUserId: issuer.id,
                holderUserId: holder.id,
                fsentryId: entry.id,
                mode: 'read',
            });
            const second = await store.upsertActive({
                issuerUserId: issuer.id,
                holderUserId: holder.id,
                fsentryId: entry.id,
                mode: 'write',
            });

            expect(second.uid).toBe(first.uid);
            expect(second.mode).toBe('write');
            expect(await store.listByFsentry(entry.id)).toHaveLength(1);
        });

        it('keeps a separate row per issuer on the same node', async () => {
            const entry = await makeEntry(issuer);
            await store.upsertActive({
                issuerUserId: issuer.id,
                holderUserId: holder.id,
                fsentryId: entry.id,
                mode: 'read',
            });
            await store.upsertActive({
                issuerUserId: otherIssuer.id,
                holderUserId: holder.id,
                fsentryId: entry.id,
                mode: 'write',
            });

            const rows = await store.listByFsentry(entry.id);
            expect(rows).toHaveLength(2);
            expect(rows.map((r) => r.issuer_user_id).sort()).toEqual(
                [issuer.id, otherIssuer.id].sort(),
            );
        });

        it('deletes one issuer share, or every issuer share for the holder', async () => {
            const entry = await makeEntry(issuer);
            await store.upsertActive({
                issuerUserId: issuer.id,
                holderUserId: holder.id,
                fsentryId: entry.id,
                mode: 'read',
            });
            await store.upsertActive({
                issuerUserId: otherIssuer.id,
                holderUserId: holder.id,
                fsentryId: entry.id,
                mode: 'read',
            });

            expect(
                await store.deleteActive({
                    holderUserId: holder.id,
                    fsentryId: entry.id,
                    issuerUserId: issuer.id,
                }),
            ).toBe(true);
            expect(await store.listByFsentry(entry.id)).toHaveLength(1);

            expect(
                await store.deleteActive({
                    holderUserId: holder.id,
                    fsentryId: entry.id,
                }),
            ).toBe(true);
            expect(await store.listByFsentry(entry.id)).toEqual([]);
        });

        it('retires the share when the file is deleted', async () => {
            const entry = await makeEntry(issuer);
            const created = await store.upsertActive({
                issuerUserId: issuer.id,
                holderUserId: holder.id,
                fsentryId: entry.id,
                mode: 'read',
            });

            await server.clients.db.write(
                'DELETE FROM `fsentries` WHERE `id` = ?',
                [entry.id],
            );

            // The cascade is what stops a deleted file lingering in the
            // recipient's listing forever.
            expect(await store.getByUid(created.uid)).toBeNull();
        });

        it('paginates by keyset and stops without a trailing cursor', async () => {
            const pageHolder = await makeUser();
            const uids = [];
            for (let i = 0; i < 5; i++) {
                const entry = await makeEntry(issuer);
                const row = await store.upsertActive({
                    issuerUserId: issuer.id,
                    holderUserId: pageHolder.id,
                    fsentryId: entry.id,
                    mode: 'read',
                });
                uids.push(row.uid);
            }

            const seen = [];
            let cursor;
            for (let guard = 0; guard < 10; guard++) {
                const page = await store.listByHolder(pageHolder.id, {
                    limit: 2,
                    cursor,
                });
                seen.push(...page.items.map((r) => r.uid));
                cursor = page.cursor;
                if (!cursor) break;
            }

            expect(seen).toEqual(uids);
            expect(cursor).toBeUndefined();
            expect(await store.countByHolder(pageHolder.id)).toBe(5);
        });

        it('never returns another holder rows', async () => {
            const stranger = await makeUser();
            const entry = await makeEntry(issuer);
            await store.upsertActive({
                issuerUserId: issuer.id,
                holderUserId: holder.id,
                fsentryId: entry.id,
                mode: 'read',
            });

            const page = await store.listByHolder(stranger.id);
            expect(page.items).toEqual([]);
        });

        it('claims a pending invite without dropping the row', async () => {
            const entry = await makeEntry(issuer);
            const pending = await store.create({
                issuerUserId: issuer.id,
                recipientEmail: `pending-${uuidv4()}@test.local`,
                data: {},
            });

            const applied = await store.applyPending({
                uid: pending.uid,
                holderUserId: holder.id,
                fsentryId: entry.id,
                mode: 'read',
            });

            expect(applied.holder_user_id).toBe(holder.id);
            expect(applied.mode).toBe('read');
            expect(applied.applied_at).toBeTruthy();
            // Second claim finds nothing left to claim.
            expect(
                await store.applyPending({
                    uid: pending.uid,
                    holderUserId: holder.id,
                }),
            ).toBeNull();
        });

        it('excludes pending invites from a holder listing', async () => {
            const freshHolder = await makeUser();
            await store.create({
                issuerUserId: issuer.id,
                recipientEmail: `unclaimed-${uuidv4()}@test.local`,
                data: {},
            });

            const page = await store.listByHolder(freshHolder.id);
            expect(page.items).toEqual([]);
        });

        it('rejects an incomplete active share', async () => {
            await expect(
                store.upsertActive({
                    issuerUserId: issuer.id,
                    holderUserId: holder.id,
                    mode: 'read',
                }),
            ).rejects.toThrow('are required');
        });
    });
});
