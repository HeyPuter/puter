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

import { v4 as uuidv4 } from 'uuid';
import {
    afterAll,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import type { Actor } from '../../core/actor.js';
import { runWithContext } from '../../core/context.js';
import type { TeamRow, TeamStoreContract } from '../../core/teams.js';
import { PuterServer } from '../../server.js';
import { installSeatStub } from '../../testFixtures/seatStub.js';
import { createTestUser, setupTestServer } from '../../testUtil.js';

describe('ShareService: sharing with a team', () => {
    let server: PuterServer;
    const teams = new Map<number, TeamRow>();
    const members = new Map<number, Set<number>>();

    beforeAll(async () => {
        server = await setupTestServer();
    });

    afterAll(async () => {
        await server?.shutdown();
    });

    // Teams is optional, so the store contract is answered here over real
    // group rows: the grants and membership checks beneath it stay real.
    beforeEach(() => {
        installSeatStub(server as never, []);
        const byUid = (uid: string) =>
            [...teams.values()].find((team) => team.uid === uid) ?? null;
        Object.assign(server.stores.team as TeamStoreContract, {
            getByUid: async (uid: string) => byUid(uid),
            getByHandle: async (handle: string) =>
                [...teams.values()].find((team) => team.handle === handle) ??
                null,
            getByIdIncludingDeleted: async (id: number) =>
                teams.get(id) ?? null,
            getByIdsIncludingDeleted: async (ids: number[]) =>
                new Map(
                    ids
                        .filter((id) => teams.has(id))
                        .map((id) => [id, teams.get(id)!]),
                ),
            isMember: async (uid: string, userId: number) =>
                members.get(byUid(uid)?.id ?? -1)?.has(userId) ?? false,
            listGroupIdsForUser: async (userId: number) =>
                [...members.entries()]
                    .filter(([, ids]) => ids.has(userId))
                    .map(([groupId]) => groupId),
            listMemberIdsByGroupId: async (groupId: number) => [
                ...(members.get(groupId) ?? []),
            ],
            memberIdsAmong: async (uid: string, userIds: number[]) =>
                userIds.filter((id) =>
                    members.get(byUid(uid)?.id ?? -1)?.has(id),
                ),
        } satisfies Partial<TeamStoreContract>);
    });

    const makeUser = async () => {
        const username = `st${Math.random().toString(36).slice(2, 9)}`;
        await createTestUser(server, { username, password: 'pw-test-1234' });
        const user = await server.stores.user.getByUsername(username);
        if (!user) throw new Error('test user missing');
        const email = `${username}@test.local`;
        await server.stores.user.update(user.id, {
            email,
            clean_email: email,
            email_confirmed: true,
        });
        const fresh = await server.stores.user.getById(user.id, {
            force: true,
        });
        const actor: Actor = {
            user: fresh as Actor['user'],
            effectiveApp: null,
        };
        return { user: fresh!, actor, email };
    };

    const makeFile = async (owner: { id: number; username: string }) => {
        const home = await server.stores.fsEntry.getRootEntryForUser(owner.id);
        if (!home) throw new Error('home directory missing');
        const uuid = uuidv4();
        const name = `f-${uuid.slice(0, 8)}.txt`;
        const path = `/${owner.username}/${name}`;
        await server.clients.db.write(
            'INSERT INTO `fsentries` (`uuid`, `name`, `path`, `user_id`, `is_dir`, `modified`, `parent_id`, `parent_uid`) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [
                uuid,
                name,
                path,
                owner.id,
                server.clients.db.booleanValue(false),
                Math.floor(Date.now() / 1000),
                home.id,
                home.uuid,
            ],
        );
        const entry = await server.stores.fsEntry.getEntryByPath(path);
        if (!entry) throw new Error('fsentry not created');
        return entry;
    };

    /** A team group row with `people` as members, registered with the stub. */
    const makeTeam = async (
        owner: { id: number },
        people: Array<{ id: number }>,
    ): Promise<TeamRow> => {
        const uid = uuidv4();
        const handle = `team-${uid.slice(0, 8)}`;
        await server.clients.db.write(
            'INSERT INTO `group` (`uid`, `owner_user_id`, `kind`, ' +
                '`name`, `extra`, `metadata`) VALUES (?, ?, ?, ?, ?, ?)',
            [uid, owner.id, 'team', 'Design', '{}', '{}'],
        );
        const [group] = (await server.clients.db.read(
            'SELECT id FROM `group` WHERE uid = ?',
            [uid],
        )) as { id: number }[];
        for (const person of people) {
            await server.clients.db.write(
                'INSERT INTO `jct_user_group` (`user_id`, `group_id`) ' +
                    'VALUES (?, ?)',
                [person.id, group.id],
            );
        }
        const team: TeamRow = {
            id: Number(group.id),
            uid,
            owner_user_id: owner.id,
            kind: 'team',
            name: 'Design',
            handle,
            deleted_at: null,
            created_at: '2026-01-01 00:00:00',
            directory_enabled: 0,
            require_2fa: 0,
        };
        teams.set(team.id, team);
        members.set(team.id, new Set(people.map((person) => person.id)));
        return team;
    };

    const canRead = (actor: Actor, path: string) =>
        server.services.acl.check(
            actor,
            {
                path,
                resolveAncestors: () =>
                    server.services.fs.getAncestorChain(path),
            },
            'read',
        );

    const share = (actor: Actor, input: Record<string, unknown>) =>
        runWithContext({ actor }, () =>
            server.services.share.share(actor, input as never),
        );
    const unshare = (actor: Actor, input: Record<string, unknown>) =>
        runWithContext({ actor }, () =>
            server.services.share.unshare(actor, input as never),
        );

    /** An owner, a fellow member, an outsider, their team and the owner's file. */
    const scene = async () => {
        const owner = await makeUser();
        const member = await makeUser();
        const outsider = await makeUser();
        const team = await makeTeam(owner.user, [owner.user, member.user]);
        const file = await makeFile(owner.user);
        return { owner, member, outsider, team, file };
    };

    it('grants every member through one share, and reports a repeat as not new', async () => {
        const { owner, member, outsider, team, file } = await scene();

        const first = await share(owner.actor, {
            uid: file.uuid,
            recipient: { team: team.uid },
            mode: 'read',
        });

        expect(first).toMatchObject({
            mode: 'read',
            isNew: true,
            holderGroupId: team.id,
            holderTeam: { uid: team.uid, name: 'Design', handle: team.handle },
        });
        expect(await canRead(member.actor, file.path)).toBe(true);
        expect(await canRead(outsider.actor, file.path)).toBe(false);

        const again = await share(owner.actor, {
            uid: file.uuid,
            recipient: { teamHandle: team.handle },
            mode: 'read',
        });
        expect(again.isNew).toBe(false);
        expect(again.uid).toBe(first.uid);
    });

    it('refuses a team the sharer is not in, an unknown team, and a doubly named one', async () => {
        const { owner, outsider, team, file } = await scene();
        const theirs = await makeFile(outsider.user);

        await expect(
            share(outsider.actor, {
                uid: theirs.uuid,
                recipient: { teamHandle: team.handle },
                mode: 'read',
            }),
        ).rejects.toMatchObject({
            statusCode: 404,
            legacyCode: 'team_not_found',
        });
        for (const recipient of [
            { team: uuidv4() },
            { teamHandle: 'no-such-team' },
        ]) {
            await expect(
                share(owner.actor, { uid: file.uuid, recipient, mode: 'read' }),
            ).rejects.toMatchObject({
                statusCode: 404,
                legacyCode: 'team_not_found',
            });
        }
        await expect(
            share(owner.actor, {
                uid: file.uuid,
                recipient: { team: team.uid, teamHandle: team.handle },
                mode: 'read',
            }),
        ).rejects.toMatchObject({
            statusCode: 400,
            legacyCode: 'bad_request',
        });
        expect(
            await server.stores.share.listGroupSharesByFsentry(file.id),
        ).toEqual([]);
    });

    it('names the team in the listings of the sharer, a member, and the item', async () => {
        const { owner, member, outsider, team, file } = await scene();
        const shared = await share(owner.actor, {
            uid: file.uuid,
            recipient: { team: team.uid },
            mode: 'read',
        });
        const holderTeam = {
            uid: team.uid,
            name: 'Design',
            handle: team.handle,
        };

        const byMe = await server.services.share.listSharedByMe(owner.actor);
        expect(byMe.items).toEqual([
            expect.objectContaining({ uid: shared.uid, holderTeam }),
        ]);

        const withMember = await server.services.share.listSharedWithMe(
            member.actor,
        );
        expect(withMember.items).toEqual([
            expect.objectContaining({ uid: shared.uid, holderTeam }),
        ]);
        const withOutsider = await server.services.share.listSharedWithMe(
            outsider.actor,
        );
        expect(withOutsider.items).toEqual([]);

        const ofItem = await runWithContext({ actor: owner.actor }, () =>
            server.services.share.listSharesOf(owner.actor, {
                uid: file.uuid,
            }),
        );
        expect(ofItem).toEqual([
            expect.objectContaining({ uid: shared.uid, holderTeam }),
        ]);
    });

    it('withdraws the whole team when the owner unshares it', async () => {
        const { owner, member, team, file } = await scene();
        await share(owner.actor, {
            uid: file.uuid,
            recipient: { team: team.uid },
            mode: 'read',
        });

        const result = await unshare(owner.actor, {
            uid: file.uuid,
            recipient: { team: team.uid },
        });

        expect(result.revoked).toBeGreaterThan(0);
        expect(await canRead(member.actor, file.path)).toBe(false);
        expect(
            await server.stores.share.listGroupSharesByFsentry(file.id),
        ).toEqual([]);
        expect(
            (await server.services.share.listSharedWithMe(member.actor)).items,
        ).toEqual([]);

        // Nothing left to take back.
        expect(
            await unshare(owner.actor, {
                uid: file.uuid,
                recipient: { team: team.uid },
            }),
        ).toEqual({ revoked: 0 });
    });

    it('takes what a member re-shared along with the team grant', async () => {
        const { owner, member, outsider, team, file } = await scene();
        await share(owner.actor, {
            uid: file.uuid,
            recipient: { team: team.uid },
            mode: 'manage',
        });
        await share(member.actor, {
            uid: file.uuid,
            recipient: { email: outsider.email },
            mode: 'read',
        });
        expect(await canRead(outsider.actor, file.path)).toBe(true);

        await unshare(owner.actor, {
            uid: file.uuid,
            recipient: { team: team.uid },
        });

        expect(await canRead(member.actor, file.path)).toBe(false);
        expect(await canRead(outsider.actor, file.path)).toBe(false);
    });

    it('keeps a re-share by a member who also holds manage in their own right', async () => {
        const { owner, member, outsider, team, file } = await scene();
        await share(owner.actor, {
            uid: file.uuid,
            recipient: { team: team.uid },
            mode: 'manage',
        });
        await share(owner.actor, {
            uid: file.uuid,
            recipient: { email: member.email },
            mode: 'manage',
        });
        await share(member.actor, {
            uid: file.uuid,
            recipient: { email: outsider.email },
            mode: 'read',
        });

        await unshare(owner.actor, {
            uid: file.uuid,
            recipient: { team: team.uid },
        });

        expect(await canRead(member.actor, file.path)).toBe(true);
        expect(await canRead(outsider.actor, file.path)).toBe(true);
    });

    it("takes a delegate's team share when the delegate is unshared", async () => {
        const owner = await makeUser();
        const delegate = await makeUser();
        const member = await makeUser();
        const team = await makeTeam(delegate.user, [
            delegate.user,
            member.user,
        ]);
        const file = await makeFile(owner.user);
        await share(owner.actor, {
            uid: file.uuid,
            recipient: { email: delegate.email },
            mode: 'manage',
        });
        await share(delegate.actor, {
            uid: file.uuid,
            recipient: { team: team.uid },
            mode: 'read',
        });
        expect(await canRead(member.actor, file.path)).toBe(true);

        await unshare(owner.actor, {
            uid: file.uuid,
            recipient: { email: delegate.email },
        });

        expect(await canRead(delegate.actor, file.path)).toBe(false);
        expect(await canRead(member.actor, file.path)).toBe(false);
        expect(
            await server.stores.share.listGroupSharesByFsentry(file.id),
        ).toEqual([]);
    });

    it('rolls the group grant back when the share cannot be recorded', async () => {
        const { owner, member, team, file } = await scene();
        const failing = vi
            .spyOn(server.stores.share, 'upsertActiveGroup')
            .mockRejectedValueOnce(new Error('index write failed'));
        try {
            await expect(
                share(owner.actor, {
                    uid: file.uuid,
                    recipient: { team: team.uid },
                    mode: 'read',
                }),
            ).rejects.toThrow('index write failed');
        } finally {
            failing.mockRestore();
        }

        expect(await canRead(member.actor, file.path)).toBe(false);
        expect(
            await server.stores.share.listGroupSharesByFsentry(file.id),
        ).toEqual([]);
    });

    it('revokes a team share addressed by its uid', async () => {
        const { owner, member, team, file } = await scene();
        const shared = await share(owner.actor, {
            uid: file.uuid,
            recipient: { team: team.uid },
            mode: 'read',
        });

        const result = await runWithContext({ actor: owner.actor }, () =>
            server.services.share.revokeSharedByMe(owner.actor, shared.uid),
        );

        expect(result.revoked).toBeGreaterThan(0);
        expect(await canRead(member.actor, file.path)).toBe(false);
        expect(await server.stores.share.getByUid(shared.uid)).toBeFalsy();
    });

    it('answers not-found for a team share whose team can no longer be resolved', async () => {
        const { owner, team, file } = await scene();
        const shared = await share(owner.actor, {
            uid: file.uuid,
            recipient: { team: team.uid },
            mode: 'read',
        });
        teams.delete(team.id);

        await expect(
            runWithContext({ actor: owner.actor }, () =>
                server.services.share.revokeSharedByMe(owner.actor, shared.uid),
            ),
        ).rejects.toMatchObject({
            statusCode: 404,
            legacyCode: 'subject_does_not_exist',
        });
    });
});
