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

describe('GroupStore', () => {
    let server: PuterServer;
    let store: PuterServer['stores']['group'];
    let owner: { id: number; username: string };
    let member: { id: number; username: string; uuid: string };

    const makeUser = async (): Promise<{
        id: number;
        username: string;
        uuid: string;
    }> => {
        const username = `grp-${Math.random().toString(36).slice(2, 10)}`;
        const uuid = uuidv4();
        const created = (await server.stores.user.create({
            username,
            uuid,
            password: null,
            email: `${username}@test.local`,
        })) as unknown as { id: number };
        return { id: created.id, username, uuid };
    };

    // Groups are seeded by migration in production; nothing creates one at
    // runtime, so the tests insert rows the same way a migration does.
    const seedGroup = async (ownerUserId: number): Promise<string> => {
        const uid = uuidv4();
        await server.clients.db.write(
            'INSERT INTO `group` (`uid`, `owner_user_id`, `extra`, `metadata`) ' +
                'VALUES (?, ?, ?, ?)',
            [uid, ownerUserId, '{}', '{}'],
        );
        return uid;
    };

    const memberUsernames = async (uid: string): Promise<string[]> => {
        const rows = await server.clients.db.read(
            'SELECT u.username FROM `user` u ' +
                'JOIN `jct_user_group` ug ON u.id = ug.user_id ' +
                'WHERE ug.group_id = (SELECT id FROM `group` WHERE uid = ?)',
            [uid],
        );
        return rows.map((r) => String(r.username));
    };

    beforeAll(async () => {
        server = await setupTestServer();
        store = server.stores.group;
        owner = await makeUser();
        member = await makeUser();
    });

    afterAll(async () => {
        await server?.shutdown();
    });

    // -- membership ---------------------------------------------------

    it('adds and removes members by username', async () => {
        const uid = await seedGroup(owner.id);
        const second = await makeUser();

        await store.addUsers(uid, [member.username, second.username]);
        expect((await memberUsernames(uid)).sort()).toEqual(
            [member.username, second.username].sort(),
        );

        await store.removeUsers(uid, [second.username]);
        expect(await memberUsernames(uid)).toEqual([member.username]);
    });

    it('treats re-adding an existing member as a no-op, not a conflict', async () => {
        const uid = await seedGroup(owner.id);

        await store.addUsers(uid, [member.username]);
        // Before the unique index this duplicated the row; now it would raise.
        await expect(
            store.addUsers(uid, [member.username]),
        ).resolves.toBeUndefined();

        expect(await memberUsernames(uid)).toEqual([member.username]);
        const rows = await server.clients.db.read(
            'SELECT COUNT(*) AS n FROM `jct_user_group` ' +
                'WHERE `group_id` = (SELECT id FROM `group` WHERE uid = ?)',
            [uid],
        );
        expect(Number(rows[0].n)).toBe(1);
    });

    it('adds a new member alongside one that is already present', async () => {
        const uid = await seedGroup(owner.id);
        const second = await makeUser();

        await store.addUsers(uid, [member.username]);
        // The conflicting row must not discard the batch's other inserts.
        await store.addUsers(uid, [member.username, second.username]);

        expect((await memberUsernames(uid)).sort()).toEqual(
            [member.username, second.username].sort(),
        );
    });

    it('ignores usernames that do not resolve to a user', async () => {
        const uid = await seedGroup(owner.id);
        await store.addUsers(uid, ['ghost-user-does-not-exist']);
        expect(await memberUsernames(uid)).toEqual([]);
    });

    it('treats an empty username list as a no-op for both add and remove', async () => {
        const uid = await seedGroup(owner.id);
        await store.addUsers(uid, [member.username]);

        await store.addUsers(uid, []);
        await store.removeUsers(uid, []);

        expect(await memberUsernames(uid)).toEqual([member.username]);
    });

    it('scopes membership writes to the requested group', async () => {
        const a = await seedGroup(owner.id);
        const b = await seedGroup(owner.id);
        await store.addUsers(a, [member.username]);

        expect(await memberUsernames(b)).toEqual([]);
    });

    it('removing a member from one group leaves other groups untouched', async () => {
        const a = await seedGroup(owner.id);
        const b = await seedGroup(owner.id);
        await store.addUsers(a, [member.username]);
        await store.addUsers(b, [member.username]);

        await store.removeUsers(a, [member.username]);

        expect(await memberUsernames(a)).toEqual([]);
        expect(await memberUsernames(b)).toEqual([member.username]);
    });
    // -- the boundary with TeamStore ----------------------------------

    it('refuses to add a member to a team, leaving that to TeamStore', async () => {
        const uid = uuidv4();
        await server.clients.db.write(
            'INSERT INTO `group` (`uid`, `owner_user_id`, `kind`, `name`, `extra`, `metadata`) ' +
                'VALUES (?, ?, ?, ?, ?, ?)',
            [uid, owner.id, 'team', 'Not Yours', '{}', '{}'],
        );

        // Two writers produced the duplicates; the split is enforced in SQL.
        await store.addUsers(uid, [member.username]);
        expect(await memberUsernames(uid)).toEqual([]);
    });

    it('refuses to remove a member from a team', async () => {
        const uid = uuidv4();
        await server.clients.db.write(
            'INSERT INTO `group` (`uid`, `owner_user_id`, `kind`, `name`, `extra`, `metadata`) ' +
                'VALUES (?, ?, ?, ?, ?, ?)',
            [uid, owner.id, 'team', 'Also Not Yours', '{}', '{}'],
        );
        await server.stores.team.addMember(uid, member.id, { orgOwned: true });

        await store.removeUsers(uid, [member.username]);
        expect(await memberUsernames(uid)).toEqual([member.username]);
    });
});
