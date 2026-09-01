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
import { PuterServer } from '../../server.ts';
import { setupTestServer } from '../../testUtil.ts';
import { checkHandle } from './TeamStore.ts';

describe('TeamStore', () => {
    let server: PuterServer;
    let store: PuterServer['stores']['team'];
    let owner: { id: number };

    const makeUser = async (): Promise<{ id: number }> => {
        const username = `team-${Math.random().toString(36).slice(2, 10)}`;
        const created = (await server.stores.user.create({
            username,
            uuid: uuidv4(),
            password: null,
            email: `${username}@test.local`,
        })) as unknown as { id: number };
        return { id: created.id };
    };

    // Random so parallel cases never collide on the unique index.
    const freeHandle = () => `ws-${Math.random().toString(36).slice(2, 10)}`;

    beforeAll(async () => {
        server = await setupTestServer();
        store = server.stores.team;
        owner = await makeUser();
    });

    afterAll(async () => {
        await server?.shutdown();
    });

    // -- handle validation --------------------------------------------

    it('accepts lowercase handles with single inner hyphens', () => {
        for (const handle of ['acme', 'acme-design', 'a1-b2-c3', 'x'.repeat(64)]) {
            expect(checkHandle(handle)).toBeNull();
        }
    });

    it('refuses handles that are malformed, mis-sized or reserved', () => {
        expect(checkHandle('ab')).toBe('too_short');
        expect(checkHandle('x'.repeat(65))).toBe('too_long');
        expect(checkHandle('Acme')).toBe('malformed');
        expect(checkHandle('acme_design')).toBe('malformed');
        expect(checkHandle('-acme')).toBe('malformed');
        expect(checkHandle('acme-')).toBe('malformed');
        expect(checkHandle('acme--design')).toBe('malformed');
        expect(checkHandle('café')).toBe('malformed');
        // The point of the list: these read like Puter itself.
        expect(checkHandle('puter-support')).toBe('reserved');
        expect(checkHandle('security')).toBe('reserved');
        expect(checkHandle('admin')).toBe('reserved');
    });

    it('refuses a reserved handle at the store boundary, not just in the checker', async () => {
        await expect(
            store.create({ ownerUserId: owner.id, name: 'Support', handle: 'support' }),
        ).rejects.toThrow(/reserved/u);
    });

    // -- create and read ----------------------------------------------

    it('creates a workspace and reads it back by uid', async () => {
        const handle = freeHandle();
        const created = await store.create({
            ownerUserId: owner.id,
            name: 'Acme Design',
            handle,
        });

        expect(created).toMatchObject({
            owner_user_id: owner.id,
            kind: 'team',
            name: 'Acme Design',
            handle,
            deleted_at: null,
        });
        expect(created.uid).toMatch(/^[0-9a-f-]{36}$/u);
        await expect(store.getByUid(created.uid)).resolves.toMatchObject({
            uid: created.uid,
        });
    });

    it('creates a workspace without a handle', async () => {
        const created = await store.create({
            ownerUserId: owner.id,
            name: 'Unnamed',
        });
        expect(created.handle).toBeNull();
    });

    it('resolves a handle case-insensitively', async () => {
        const handle = freeHandle();
        const created = await store.create({
            ownerUserId: owner.id,
            name: 'Case',
            handle,
        });
        // NOCASE on sqlite, utf8mb4_unicode_ci on mysql, lower() on postgres.
        await expect(
            store.getByHandle(handle.toUpperCase()),
        ).resolves.toMatchObject({ uid: created.uid });
    });

    it('refuses a duplicate handle, including one differing only in case', async () => {
        const handle = freeHandle();
        await store.create({ ownerUserId: owner.id, name: 'First', handle });

        await expect(
            store.create({ ownerUserId: owner.id, name: 'Second', handle }),
        ).rejects.toThrow();
        // `create` rejects uppercase before any SQL, so insert directly.
        await expect(
            server.clients.db.write(
                'INSERT INTO `group` (`uid`, `owner_user_id`, `kind`, `name`, `handle`, `extra`, `metadata`) ' +
                    'VALUES (?, ?, ?, ?, ?, ?, ?)',
                [uuidv4(), owner.id, 'team', 'Third', handle.toUpperCase(), '{}', '{}'],
            ),
        ).rejects.toThrow(/unique|duplicate/iu);
    });

    it('returns null for a uid that is not a workspace', async () => {
        await expect(store.getByUid(uuidv4())).resolves.toBeNull();
        await expect(store.getByHandle(freeHandle())).resolves.toBeNull();
    });

    // -- the seeded system groups -------------------------------------

    it('never returns a seeded system group from any method', async () => {
        const seeded = (await server.clients.db.read(
            'SELECT `uid`, `owner_user_id` FROM `group` WHERE `kind` IS NULL',
        )) as { uid: string; owner_user_id: number }[];
        expect(seeded.length).toBeGreaterThan(1);

        // Unreachable by predicate: a team admin is not a platform admin.
        for (const group of seeded) {
            await expect(store.getByUid(group.uid)).resolves.toBeNull();
        }
        const owners = new Set(seeded.map((g) => g.owner_user_id));
        for (const ownerId of owners) {
            const listed = await store.listByOwner(ownerId);
            expect(listed.map((t) => t.uid)).not.toContain(seeded[0].uid);
        }
    });

    // -- update -------------------------------------------------------

    it('renames a workspace without changing its uid', async () => {
        const created = await store.create({
            ownerUserId: owner.id,
            name: 'Before',
            handle: freeHandle(),
        });

        const updated = await store.update(created.uid, { name: 'After' });
        expect(updated).toMatchObject({ uid: created.uid, name: 'After' });
    });

    it('keeps the uid valid after the handle changes', async () => {
        const created = await store.create({
            ownerUserId: owner.id,
            name: 'Movable',
            handle: freeHandle(),
        });
        const next = freeHandle();

        await store.update(created.uid, { handle: next });

        // The whole point of addressing by uid: the reference survives a rename.
        await expect(store.getByUid(created.uid)).resolves.toMatchObject({
            handle: next,
        });
    });

    it('refuses to update into a reserved handle', async () => {
        const created = await store.create({
            ownerUserId: owner.id,
            name: 'Fine',
            handle: freeHandle(),
        });
        await expect(
            store.update(created.uid, { handle: 'admin' }),
        ).rejects.toThrow(/reserved/u);
    });

    it('returns null when updating a uid that does not exist', async () => {
        await expect(
            store.update(uuidv4(), { name: 'Ghost' }),
        ).resolves.toBeNull();
    });

    // -- soft delete --------------------------------------------------

    it('excludes a soft-deleted workspace from reads', async () => {
        const handle = freeHandle();
        const created = await store.create({
            ownerUserId: owner.id,
            name: 'Doomed',
            handle,
        });

        await expect(store.softDelete(created.uid)).resolves.toBe(true);

        await expect(store.getByUid(created.uid)).resolves.toBeNull();
        await expect(store.getByHandle(handle)).resolves.toBeNull();
        const listed = await store.listByOwner(owner.id);
        expect(listed.map((t) => t.uid)).not.toContain(created.uid);
    });

    it('releases the handle on soft delete so it can be claimed again', async () => {
        const handle = freeHandle();
        const first = await store.create({
            ownerUserId: owner.id,
            name: 'First',
            handle,
        });
        await store.softDelete(first.uid);

        // Nothing addresses by handle, so the name returns to the pool.
        const second = await store.create({
            ownerUserId: owner.id,
            name: 'Second',
            handle,
        });
        expect(second.uid).not.toBe(first.uid);
        await expect(store.getByHandle(handle)).resolves.toMatchObject({
            uid: second.uid,
        });
    });

    it('keeps `name` on a soft-deleted workspace so history still reads', async () => {
        const created = await store.create({
            ownerUserId: owner.id,
            name: 'Remembered',
            handle: freeHandle(),
        });
        await store.softDelete(created.uid);

        const [row] = (await server.clients.db.read(
            'SELECT `name`, `handle`, `deleted_at` FROM `group` WHERE `uid` = ?',
            [created.uid],
        )) as { name: string; handle: string | null; deleted_at: string }[];
        expect(row.name).toBe('Remembered');
        expect(row.handle).toBeNull();
        expect(row.deleted_at).not.toBeNull();
    });

    it('reports no rows affected when soft-deleting twice', async () => {
        const created = await store.create({
            ownerUserId: owner.id,
            name: 'Once',
            handle: freeHandle(),
        });
        await expect(store.softDelete(created.uid)).resolves.toBe(true);
        await expect(store.softDelete(created.uid)).resolves.toBe(false);
    });
    it('refuses a name that is empty or longer than mysql allows', async () => {
        await expect(
            store.create({ ownerUserId: owner.id, name: '   ' }),
        ).rejects.toThrow(/required/iu);
        await expect(
            store.create({ ownerUserId: owner.id, name: 'x'.repeat(256) }),
        ).rejects.toThrow(/too long/iu);

        const team = await store.create({
            ownerUserId: owner.id,
            name: '  Padded  ',
            handle: freeHandle(),
        });
        expect(team.name).toBe('Padded');
    });
});
