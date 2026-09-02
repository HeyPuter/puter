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
import type { Actor } from '../../core/actor';
import {
    setupTwoTeams,
    type TwoTeams,
} from '../../testFixtures/twoTeams.js';

describe('sharing with a team', () => {
    let fx: TwoTeams;

    const actorFor = async (userId: number): Promise<Actor> => {
        const user = await fx.env.server.stores.user.getById(userId);
        return { user } as unknown as Actor;
    };

    const shares = () => fx.env.server.services.share;

    /** A file the owner of team A owns, ready to be shared. */
    const makeFile = async (ownerId: number) => {
        const uid = crypto.randomUUID();
        const name = `f_${uid.slice(0, 8)}.txt`;
        const owner = await fx.env.server.stores.user.getById(ownerId);
        const path = `/${owner!.username}/${name}`;
        await fx.env.server.clients.db.write(
            'INSERT INTO `fsentries` (`uuid`, `name`, `path`, `user_id`, `is_dir`, `modified`) ' +
                'VALUES (?, ?, ?, ?, ?, ?)',
            [
                uid,
                name,
                path,
                ownerId,
                fx.env.server.clients.db.booleanValue(false),
                Math.floor(Date.now() / 1000),
            ],
        );
        return { path, uid };
    };

    /** A directory and a file inside it, both as real fsentry rows. */
    const makeNestedFile = async (ownerId: number) => {
        const owner = await fx.env.server.stores.user.getById(ownerId);
        const dirUid = crypto.randomUUID();
        const dirName = `d_${dirUid.slice(0, 8)}`;
        const dirPath = `/${owner!.username}/${dirName}`;
        const insert = (uid: string, name: string, path: string, isDir: boolean) =>
            fx.env.server.clients.db.write(
                'INSERT INTO `fsentries` (`uuid`, `name`, `path`, `user_id`, `is_dir`, `modified`) ' +
                    'VALUES (?, ?, ?, ?, ?, ?)',
                [
                    uid,
                    name,
                    path,
                    ownerId,
                    fx.env.server.clients.db.booleanValue(isDir),
                    Math.floor(Date.now() / 1000),
                ],
            );
        await insert(dirUid, dirName, dirPath, true);
        const fileUid = crypto.randomUUID();
        const fileName = `f_${fileUid.slice(0, 8)}.txt`;
        await insert(fileUid, fileName, `${dirPath}/${fileName}`, false);
        return { dirPath, dirUid, fileUid };
    };

    const shareWithTeam = async (
        ownerId: number,
        path: string,
        recipient: Record<string, string>,
        mode = 'read',
    ) =>
        shares().share(await actorFor(ownerId), {
            path,
            recipient,
            mode,
        } as never);

    const inbox = async (userId: number) =>
        shares().listSharedWithMe(await actorFor(userId), { limit: 100 });

    beforeAll(async () => {
        fx = await setupTwoTeams();
    }, 180_000);

    afterAll(async () => {
        await fx?.shutdown();
    });

    // -- the recipient -------------------------------------------------

    it('shares with a team addressed by uid', async () => {
        const file = await makeFile(fx.a.owner.userId);

        const res = await shareWithTeam(fx.a.owner.userId, file.path, {
            team: fx.a.uid,
        });

        expect(res.holderTeam?.uid).toBe(fx.a.uid);
        expect(res.isNew).toBe(true);
    });

    it('accepts the handle under its own field', async () => {
        const file = await makeFile(fx.a.owner.userId);

        const res = await shareWithTeam(fx.a.owner.userId, file.path, {
            teamHandle: fx.a.handle,
        });

        expect(res.holderTeam?.uid).toBe(fx.a.uid);
    });

    it('refuses both fields at once rather than picking one', async () => {
        const file = await makeFile(fx.a.owner.userId);

        await expect(
            shareWithTeam(fx.a.owner.userId, file.path, {
                team: fx.a.uid,
                teamHandle: fx.a.handle,
            }),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('404s on a team that does not exist', async () => {
        const file = await makeFile(fx.a.owner.userId);

        await expect(
            shareWithTeam(fx.a.owner.userId, file.path, {
                team: '00000000-0000-4000-8000-000000000000',
            }),
        ).rejects.toMatchObject({ statusCode: 404 });
    });

    it('does not read a team handle out of a bare string recipient', async () => {
        const file = await makeFile(fx.a.owner.userId);

        // A bare string is an email or a username, never a team — the
        // SDK contract that keeps this additive.
        await expect(
            shareWithTeam(fx.a.owner.userId, file.path, {
                username: fx.a.handle,
            } as never),
        ).rejects.toMatchObject({ statusCode: 404 });
    });

    // -- who it reaches ------------------------------------------------

    it('reaches every member of the team', async () => {
        const file = await makeFile(fx.a.owner.userId);
        await shareWithTeam(fx.a.owner.userId, file.path, { team: fx.a.uid });

        for (const seat of fx.a.seats) {
            const items = (await inbox(seat.userId)).items;
            expect(
                items.map((i) => i.entryUid),
                `seat ${seat.username}`,
            ).toContain(file.uid);
        }
    });

    it('does not reach the other team', async () => {
        const file = await makeFile(fx.a.owner.userId);
        await shareWithTeam(fx.a.owner.userId, file.path, { team: fx.a.uid });

        for (const seat of fx.b.seats) {
            const items = (await inbox(seat.userId)).items;
            expect(items.map((i) => i.entryUid)).not.toContain(file.uid);
        }
    });

    it('reaches someone who joins the team afterwards', async () => {
        const file = await makeFile(fx.a.owner.userId);
        await shareWithTeam(fx.a.owner.userId, file.path, { team: fx.a.uid });

        // The grant is one row against the team; the scan resolves it for
        // whoever is a member at the time.
        const username = `late_${Math.random().toString(36).slice(2, 9)}`;
        const created = await fx.env.server.services.team.provisionAccount(
            fx.a.uid,
            fx.a.owner.userId,
            { username, email: `${username}@test.local` },
        );

        const items = (await inbox(created.userId)).items;
        expect(items.map((i) => i.entryUid)).toContain(file.uid);
    });

    // -- listing: the silent failure this phase guards ----------------

    it('appears in a member inbox, which is what `#liveGrants` decides', async () => {
        const file = await makeFile(fx.a.owner.userId);
        await shareWithTeam(fx.a.owner.userId, file.path, { team: fx.a.uid });

        const items = (await inbox(fx.a.seats[0].userId)).items;
        const row = items.find((i) => i.entryUid === file.uid);
        // Without group evidence the share resolves correctly and is filtered
        // out of the listing as dead — nothing errors, it is simply absent.
        expect(row).toBeDefined();
        expect(row!.mode).toBe('read');
    });

    it('counts team shares in the total, not just the page', async () => {
        const file = await makeFile(fx.a.owner.userId);
        await shareWithTeam(fx.a.owner.userId, file.path, { team: fx.a.uid });

        const seat = fx.a.seats[0];
        const res = await shares().listSharedWithMe(
            await actorFor(seat.userId),
            { limit: 100, includeTotal: true },
        );
        expect(res.total).toBeGreaterThanOrEqual(res.items.length);
    });

    // -- revoke --------------------------------------------------------

    it('unsharing removes it from every member inbox', async () => {
        const file = await makeFile(fx.a.owner.userId);
        await shareWithTeam(fx.a.owner.userId, file.path, { team: fx.a.uid });

        await shares().unshare(await actorFor(fx.a.owner.userId), {
            path: file.path,
            recipient: { team: fx.a.uid },
        } as never);

        for (const seat of fx.a.seats) {
            const items = (await inbox(seat.userId)).items;
            expect(items.map((i) => i.entryUid)).not.toContain(file.uid);
        }
    });

    it('unsharing revokes the grant, not just the index row', async () => {
        const file = await makeFile(fx.a.owner.userId);
        await shareWithTeam(fx.a.owner.userId, file.path, { team: fx.a.uid });

        await shares().unshare(await actorFor(fx.a.owner.userId), {
            path: file.path,
            recipient: { team: fx.a.uid },
        } as never);

        // Deleting the row alone would hide the share while leaving every
        // member holding real access — worse than a listing bug.
        const perms = await fx.env.server.stores.permission.readUserGroupPerms(
            fx.a.seats[0].userId,
            [`fs:${file.uid}:read`],
        );
        expect(perms).toHaveLength(0);
    });

    // -- coexistence with user shares ---------------------------------

    it('leaves an external share working', async () => {
        const file = await makeFile(fx.a.owner.userId);
        const outsider = await fx.env.server.stores.user.getById(
            fx.outsider.userId,
        );

        // A member sharing outside the team is permitted; if that ever
        // stops working it should fail here rather than for a customer.
        const res = await shares().share(
            await actorFor(fx.a.owner.userId),
            {
                path: file.path,
                recipient: { username: outsider!.username },
                mode: 'read',
            } as never,
        );
        expect(res.holderId).toBe(fx.outsider.userId);

        const items = (await inbox(fx.outsider.userId)).items;
        expect(items.map((i) => i.entryUid)).toContain(file.uid);
    });

    it('keeps a user share when the team share is revoked', async () => {
        const file = await makeFile(fx.a.owner.userId);
        const outsider = await fx.env.server.stores.user.getById(
            fx.outsider.userId,
        );

        await shareWithTeam(fx.a.owner.userId, file.path, { team: fx.a.uid });
        await shares().share(await actorFor(fx.a.owner.userId), {
            path: file.path,
            recipient: { username: outsider!.username },
            mode: 'read',
        } as never);

        await shares().unshare(await actorFor(fx.a.owner.userId), {
            path: file.path,
            recipient: { team: fx.a.uid },
        } as never);

        // The two holders are independent rows and independent grants.
        const stillThere = (await inbox(fx.outsider.userId)).items;
        expect(stillThere.map((i) => i.entryUid)).toContain(file.uid);
        const gone = (await inbox(fx.a.seats[0].userId)).items;
        expect(gone.map((i) => i.entryUid)).not.toContain(file.uid);
    });

    // -- the index row -------------------------------------------------

    it('writes a group-held index row, not a user-held one', async () => {
        const file = await makeFile(fx.a.owner.userId);
        await shareWithTeam(fx.a.owner.userId, file.path, { team: fx.a.uid });

        const rows = (await fx.env.server.clients.db.read(
            'SELECT `holder_user_id`, `holder_group_id` FROM `share` ' +
                'WHERE `fsentry_id` = (SELECT `id` FROM `fsentries` WHERE `uuid` = ?)',
            [file.uid],
        )) as { holder_user_id: number | null; holder_group_id: number | null }[];

        expect(rows).toHaveLength(1);
        expect(rows[0].holder_user_id).toBeFalsy();
        expect(rows[0].holder_group_id).toBeTruthy();
    });

    it('re-sharing the same team does not spend quota twice', async () => {
        const file = await makeFile(fx.a.owner.userId);

        const first = await shareWithTeam(fx.a.owner.userId, file.path, {
            team: fx.a.uid,
        });
        const second = await shareWithTeam(fx.a.owner.userId, file.path, {
            team: fx.a.uid,
        });

        expect(first.isNew).toBe(true);
        expect(second.isNew).toBe(false);
    });

    // -- a group row is not a pending invite ---------------------------
    //
    // `holder_user_id IS NULL` meant "unclaimed invite" everywhere until a
    // team share gave that column a second reason to be null.

    it('lists a team share as a real share, not a pending invite', async () => {
        const file = await makeFile(fx.a.owner.userId);
        await shareWithTeam(fx.a.owner.userId, file.path, { team: fx.a.uid });

        const page = await shares().listSharedByMe(
            await actorFor(fx.a.owner.userId),
            { limit: 100 },
        );
        const row = page.items.find((i) => i.entryUid === file.uid);

        expect(row).toBeTruthy();
        expect(row?.pending).toBeFalsy();
        expect(row?.holderTeam?.uid).toBe(fx.a.uid);
    });

    it('does not show a phantom invite on the item it was shared with', async () => {
        const file = await makeFile(fx.a.owner.userId);
        await shareWithTeam(fx.a.owner.userId, file.path, { team: fx.a.uid });

        const rows = await shares().listSharesOf(
            await actorFor(fx.a.owner.userId),
            { uid: file.uid } as never,
        );

        // A blank-addressed pending row here is the group row misread.
        expect(
            rows.some((r) => r.pending && !r.recipientEmail),
        ).toBe(false);

        // And at the source: the group row must not be in the invite feed at
        // all. Asserted separately because `#resolvedShareRow` would mask it.
        const entry = await fx.env.server.stores.fsEntry.getEntryByUuid(
            file.uid,
        );
        const invites =
            await fx.env.server.stores.share.listPendingOnFsentry(entry!.id);
        expect(invites.filter((r) => r.holder_group_id)).toHaveLength(0);
    });

    it('revoking from the outbound listing withdraws the grant, not just the row', async () => {
        const file = await makeFile(fx.a.owner.userId);
        await shareWithTeam(fx.a.owner.userId, file.path, { team: fx.a.uid });

        const page = await shares().listSharedByMe(
            await actorFor(fx.a.owner.userId),
            { limit: 100 },
        );
        const row = page.items.find((i) => i.entryUid === file.uid);
        expect(row?.uid).toBeTruthy();

        await shares().revokeSharedByMe(
            await actorFor(fx.a.owner.userId),
            row!.uid,
        );

        // Probing the inbox would pass either way: deleting the index row alone
        // also empties the listing. The grant is what members actually resolve.
        const permission = `fs:${file.uid}:read`;
        for (const seat of fx.a.seats) {
            const rows = await fx.env.server.stores.permission.readUserGroupPerms(
                seat.userId,
                [permission],
            );
            expect(rows, `seat ${seat.username}`).toHaveLength(0);
        }
    });

    it('clears the caller own grant even when another issuer lost authority', async () => {
        const file = await makeFile(fx.a.owner.userId);
        const owner = await actorFor(fx.a.owner.userId);
        await shareWithTeam(fx.a.owner.userId, file.path, { team: fx.a.uid });

        // A second index row attributed to a seat, who cannot manage this node.
        // Impersonating them to revoke throws 403 and aborts the whole unshare.
        const team = await fx.env.server.stores.team.getByUid(fx.a.uid);
        const entry = await fx.env.server.stores.fsEntry.getEntryByUuid(
            file.uid,
        );
        await fx.env.server.stores.share.upsertActiveGroup({
            issuerUserId: fx.a.seats[0].userId,
            holderGroupId: team.id,
            fsentryId: entry.id,
            mode: 'read',
        });

        await shares().unshare(owner, {
            path: file.path,
            recipient: { team: fx.a.uid },
        });

        const rows = await fx.env.server.stores.permission.readUserGroupPerms(
            fx.a.seats[1].userId,
            [`fs:${file.uid}:read`],
        );
        expect(rows).toHaveLength(0);
    });

    it('counts members as reached, so they get live events on a shared folder', async () => {
        const file = await makeFile(fx.a.owner.userId);
        await shareWithTeam(fx.a.owner.userId, file.path, { team: fx.a.uid });
        const entry = await fx.env.server.stores.fsEntry.getEntryByUuid(
            file.uid,
        );

        // The feed behind `outer.gui.item.*`: without group rows a member sees
        // the folder but never a change inside it, so it goes stale silently.
        const rows =
            await fx.env.server.stores.share.listGroupReachingMembers([
                entry.id,
            ]);
        const reached = rows.map((r) => Number(r.holder_user_id));
        for (const seat of fx.a.seats) {
            expect(reached, `seat ${seat.username}`).toContain(seat.userId);
        }
    });

    it('clears the group grant when the entry itself is deleted', async () => {
        const file = await makeFile(fx.a.owner.userId);
        await shareWithTeam(fx.a.owner.userId, file.path, { team: fx.a.uid });
        const permission = `fs:${file.uid}:read`;
        const seat = fx.a.seats[0].userId;
        expect(
            await fx.env.server.stores.permission.readUserGroupPerms(seat, [
                permission,
            ]),
        ).toHaveLength(1);

        await shares().onEntryDeleted([file.uid]);

        // Otherwise the grant outlives the file and keeps answering "allowed".
        expect(
            await fx.env.server.stores.permission.readUserGroupPerms(seat, [
                permission,
            ]),
        ).toHaveLength(0);
    });

    it('does not let a team grant keep a revoked direct share listed', async () => {
        const file = await makeFile(fx.a.owner.userId);
        const seat = fx.a.seats[0];
        const owner = await actorFor(fx.a.owner.userId);

        // Same issuer reaches the same holder two ways: directly, and through
        // the team they share.
        await shares().share(owner, {
            path: file.path,
            recipient: { username: seat.username },
            mode: 'read',
        });
        await shareWithTeam(fx.a.owner.userId, file.path, { team: fx.a.uid });

        // The direct grant is withdrawn outside `unshare`, leaving its index
        // row behind. The group grant must not stand in for it.
        await fx.env.server.stores.permission.deleteUserUserPermsByPermissionPrefixes(
            [`fs:${file.uid}`, `manage:fs:${file.uid}`],
        );

        const page = await shares().listSharedByMe(owner, { limit: 100 });
        const direct = page.items.filter(
            (i) => i.entryUid === file.uid && !i.holderTeam,
        );
        expect(direct).toHaveLength(0);
    });

    it('shows the team in the share dialog for that item', async () => {
        const file = await makeFile(fx.a.owner.userId);
        await shareWithTeam(fx.a.owner.userId, file.path, { team: fx.a.uid });

        const rows = await shares().listSharesOf(
            await actorFor(fx.a.owner.userId),
            { uid: file.uid },
        );

        // Neither the holder feed nor the invite feed matches a group row, so
        // without its own read the dialog shows nothing to revoke.
        const team = rows.filter((r) => r.holderTeam?.uid === fx.a.uid);
        expect(team).toHaveLength(1);
        expect(team[0].pending).toBeFalsy();
    });
    // -- review findings ------------------------------------------------

    it('refuses to share into a team the sharer does not belong to', async () => {
        const file = await makeFile(fx.outsider.userId);

        await expect(
            shares().share(await actorFor(fx.outsider.userId), {
                path: file.path,
                recipient: { teamHandle: fx.a.handle },
                mode: 'read',
            }),
        ).rejects.toMatchObject({ statusCode: 404 });
    });

    it('revoking one row leaves another issuer grant on the same team', async () => {
        const file = await makeFile(fx.a.owner.userId);
        const owner = await actorFor(fx.a.owner.userId);
        await shareWithTeam(fx.a.owner.userId, file.path, { team: fx.a.uid });

        const team = await fx.env.server.stores.team.getByUid(fx.a.uid);
        const entry = await fx.env.server.stores.fsEntry.getEntryByUuid(file.uid);
        await fx.env.server.stores.share.upsertActiveGroup({
            issuerUserId: fx.a.seats[0].userId,
            holderGroupId: team.id,
            fsentryId: entry.id,
            mode: 'read',
        });

        const rows = await fx.env.server.stores.share.listGroupOnFsentry(entry.id);
        const delegateRow = rows.find(
            (r) => Number(r.issuer_user_id) === fx.a.seats[0].userId,
        );
        await shares().revokeSharedByMe(owner, String(delegateRow.uid));

        // Row-addressed revocation takes that row's issuer only.
        const left = await fx.env.server.stores.permission.readUserGroupPerms(
            fx.a.seats[1].userId,
            [`fs:${file.uid}:read`],
        );
        expect(left.length).toBeGreaterThan(0);
    });

    it('names the issuer of a team-only share in the dialog', async () => {
        const file = await makeFile(fx.a.owner.userId);
        await shareWithTeam(fx.a.owner.userId, file.path, { team: fx.a.uid });

        const rows = await shares().listSharesOf(
            await actorFor(fx.a.owner.userId),
            { uid: file.uid },
        );
        const team = rows.find((r) => r.holderTeam?.uid === fx.a.uid);

        // Without the issuer resolved the dialog reads "shared by nobody".
        expect(team?.issuer?.username).toBeTruthy();
    });

    it('lists a team reaching a file through a shared ancestor', async () => {
        const { dirPath, fileUid } = await makeNestedFile(fx.a.owner.userId);
        await shareWithTeam(fx.a.owner.userId, dirPath, { team: fx.a.uid });

        const rows = await shares().listSharesOf(
            await actorFor(fx.a.owner.userId),
            { uid: fileUid },
        );
        expect(rows.some((r) => r.holderTeam?.uid === fx.a.uid)).toBe(true);
    });
});
