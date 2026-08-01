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
import defaultConfig from '../../../../config.default.json' with { type: 'json' };
import { PuterServer } from '../../server.ts';
import { setupTestServer } from '../../testUtil.ts';

const DEFAULT_USER_GROUP = defaultConfig.default_user_group;
const DEFAULT_TEMP_GROUP = defaultConfig.default_temp_group;

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

    beforeAll(async () => {
        server = await setupTestServer();
        store = server.stores.group;
        owner = await makeUser();
        member = await makeUser();
    });

    afterAll(async () => {
        await server?.shutdown();
    });

    // -- create + read ------------------------------------------------

    it('creates a group and reads it back by uid with decoded JSON columns', async () => {
        const uid = await store.create({
            ownerUserId: owner.id,
            extra: { note: 'hi' },
            metadata: { title: 'Team' },
        });

        const group = await store.getByUid(uid);
        expect(group).not.toBeNull();
        expect(group!.uid).toBe(uid);
        expect(group!.owner_user_id).toBe(owner.id);
        expect(group!.extra).toEqual({ note: 'hi' });
        expect(group!.metadata).toEqual({ title: 'Team' });
    });

    it('defaults extra/metadata to empty objects when omitted', async () => {
        const uid = await store.create({ ownerUserId: owner.id });
        const group = await store.getByUid(uid);
        expect(group!.extra).toEqual({});
        expect(group!.metadata).toEqual({});
    });

    it('returns null for an unknown uid', async () => {
        expect(await store.getByUid('no-such-group')).toBeNull();
    });

    it('decodes a NULL json column as an empty object', async () => {
        const uid = await store.create({ ownerUserId: owner.id });
        await server.clients.db.write(
            'UPDATE `group` SET `extra` = NULL, `metadata` = NULL WHERE `uid` = ?',
            [uid],
        );
        const group = await store.getByUid(uid);
        expect(group!.extra).toEqual({});
        expect(group!.metadata).toEqual({});
    });

    it('falls back to an empty object when a json column holds unparseable text', async () => {
        const uid = await store.create({ ownerUserId: owner.id });
        await server.clients.db.write(
            'UPDATE `group` SET `extra` = ? WHERE `uid` = ?',
            ['{not json', uid],
        );
        const group = await store.getByUid(uid);
        expect(group!.extra).toEqual({});
    });

    // -- listing ------------------------------------------------------

    it('lists only the groups a given user owns', async () => {
        const otherOwner = await makeUser();
        const mine = await store.create({ ownerUserId: owner.id });
        const theirs = await store.create({ ownerUserId: otherOwner.id });

        const uids = (await store.listGroupsWithOwner(otherOwner.id)).map(
            (g) => g.uid,
        );
        expect(uids).toEqual([theirs]);
        expect(uids).not.toContain(mine);
    });

    it('returns an empty list for an owner with no groups', async () => {
        const lonely = await makeUser();
        expect(await store.listGroupsWithOwner(lonely.id)).toEqual([]);
    });

    it('lists groups by membership, not ownership', async () => {
        const uid = await store.create({
            ownerUserId: owner.id,
            metadata: { title: 'Members' },
        });
        await store.addUsers(uid, [member.username]);

        const memberGroups = await store.listGroupsWithMember(member.id);
        expect(memberGroups.map((g) => g.uid)).toContain(uid);
        // The owner is not implicitly a member.
        const ownerGroups = await store.listGroupsWithMember(owner.id);
        expect(ownerGroups.map((g) => g.uid)).not.toContain(uid);
        expect(memberGroups.find((g) => g.uid === uid)!.metadata).toEqual({
            title: 'Members',
        });
    });

    // -- membership ---------------------------------------------------

    it('adds and removes members by username', async () => {
        const uid = await store.create({ ownerUserId: owner.id });
        const second = await makeUser();

        await store.addUsers(uid, [member.username, second.username]);
        expect((await store.listMemberUsernames(uid)).sort()).toEqual(
            [member.username, second.username].sort(),
        );
        expect((await store.listMemberUserUuids(uid)).sort()).toEqual(
            [member.uuid, second.uuid].sort(),
        );

        await store.removeUsers(uid, [second.username]);
        expect(await store.listMemberUsernames(uid)).toEqual([member.username]);
    });

    it('ignores usernames that do not resolve to a user', async () => {
        const uid = await store.create({ ownerUserId: owner.id });
        await store.addUsers(uid, ['ghost-user-does-not-exist']);
        expect(await store.listMemberUsernames(uid)).toEqual([]);
    });

    it('treats an empty username list as a no-op for both add and remove', async () => {
        const uid = await store.create({ ownerUserId: owner.id });
        await store.addUsers(uid, [member.username]);

        await store.addUsers(uid, []);
        await store.removeUsers(uid, []);

        expect(await store.listMemberUsernames(uid)).toEqual([member.username]);
    });

    it('scopes membership queries to the requested group', async () => {
        const a = await store.create({ ownerUserId: owner.id });
        const b = await store.create({ ownerUserId: owner.id });
        await store.addUsers(a, [member.username]);

        expect(await store.listMemberUsernames(b)).toEqual([]);
        expect(await store.listMemberUserUuids(b)).toEqual([]);
    });

    it('removing a member from one group leaves other groups untouched', async () => {
        const a = await store.create({ ownerUserId: owner.id });
        const b = await store.create({ ownerUserId: owner.id });
        await store.addUsers(a, [member.username]);
        await store.addUsers(b, [member.username]);

        await store.removeUsers(a, [member.username]);

        expect(await store.listMemberUsernames(a)).toEqual([]);
        expect(await store.listMemberUsernames(b)).toEqual([member.username]);
    });

    // -- rate limiting ------------------------------------------------

    it('rejects the 21st group created by one owner within the hour', async () => {
        const spammer = await makeUser();
        for (let i = 0; i < 20; i++) {
            await store.create({ ownerUserId: spammer.id });
        }

        await expect(
            store.create({ ownerUserId: spammer.id }),
        ).rejects.toMatchObject({
            statusCode: 429,
            legacyCode: 'too_many_requests',
        });

        // The limit is per-owner: a different user is unaffected.
        await expect(
            store.create({ ownerUserId: (await makeUser()).id }),
        ).resolves.toEqual(expect.any(String));
    });

    it('does not count groups created outside the window', async () => {
        const veteran = await makeUser();
        for (let i = 0; i < 20; i++) {
            await store.create({ ownerUserId: veteran.id });
        }
        await server.clients.db.write(
            "UPDATE `group` SET `created_at` = '2020-01-01 00:00:00' WHERE `owner_user_id` = ?",
            [veteran.id],
        );

        await expect(
            store.create({ ownerUserId: veteran.id }),
        ).resolves.toEqual(expect.any(String));
    });

    // -- public group cache -------------------------------------------

    it('reads the configured public groups from the database on a cold cache', async () => {
        const groups = await store.listPublicGroups();
        const uids = groups.map((g) => g.uid);
        expect(uids).toContain(DEFAULT_USER_GROUP);
        expect(uids).toContain(DEFAULT_TEMP_GROUP);
    });

    it('serves the second read from the redis cache', async () => {
        // Prime, then make the DB answer differ from the cached copy: a
        // cached read must not see the change.
        await store.listPublicGroups();
        await server.clients.db.write(
            'UPDATE `group` SET `metadata` = ? WHERE `uid` = ?',
            [
                JSON.stringify({ title: 'renamed-after-cache' }),
                DEFAULT_USER_GROUP,
            ],
        );

        const cached = await store.listPublicGroups();
        const userGroup = cached.find((g) => g.uid === DEFAULT_USER_GROUP);
        expect(userGroup!.metadata).not.toEqual({
            title: 'renamed-after-cache',
        });
    });

    it('re-reads from the database once the cache entry is gone', async () => {
        await store.listPublicGroups();
        const keys = await server.clients.redis.keys('*group:public-groups');
        expect(keys.length).toBeGreaterThan(0);
        for (const key of keys) await server.clients.redis.del(key);

        const fresh = await store.listPublicGroups();
        const userGroup = fresh.find((g) => g.uid === DEFAULT_USER_GROUP);
        expect(userGroup!.metadata).toEqual({ title: 'renamed-after-cache' });
    });

    it('returns an empty list when no public groups are configured', async () => {
        const bare = await setupTestServer({
            default_user_group: '',
            default_temp_group: '',
        } as never);
        try {
            expect(await bare.stores.group.listPublicGroups()).toEqual([]);
        } finally {
            await bare.shutdown();
        }
    });
});
