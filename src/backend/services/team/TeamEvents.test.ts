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
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PuterServer } from '../../server.ts';
import { setupTestServer } from '../../testUtil.ts';

describe('team billing events', () => {
    let server: PuterServer;
    let service: PuterServer['services']['team'];
    let owner: { id: number };

    /** Every billing event emitted since the last reset, in order. */
    const seen: Array<{ key: string; data: Record<string, unknown> }> = [];
    const of = (key: string) => seen.filter((e) => e.key === key);

    const makeUser = async (): Promise<{ id: number; username: string }> => {
        const username = `bil_${Math.random().toString(36).slice(2, 10)}`;
        const created = (await server.stores.user.create({
            username,
            uuid: uuidv4(),
            password: null,
            email: `${username}@test.local`,
        })) as unknown as { id: number };
        return { id: created.id, username };
    };

    const freeHandle = () => `bw-${Math.random().toString(36).slice(2, 10)}`;

    const makeTeam = async () =>
        service.createTeam(owner.id, {
            name: 'Billing Co',
            handle: freeHandle(),
        });

    /** A real provisioned seat, as every chargeable account is. */
    const provision = async (team: { uid: string }) => {
        const username = `seat_${Math.random().toString(36).slice(2, 10)}`;
        const created = await service.provisionAccount(team.uid, owner.id, {
            username,
            email: `${username}@test.local`,
        });
        return created;
    };

    /** Same, for a team whose owner is not the shared one. */
    const provision2 = async (team: { uid: string }, ownerId: number) => {
        const username = `seat_${Math.random().toString(36).slice(2, 10)}`;
        return service.provisionAccount(team.uid, ownerId, {
            username,
            email: `${username}@test.local`,
        });
    };

    /** Bytes the report has to find; `size` is what `SUM(size)` reads. */
    const giveFile = async (userId: number, size: number) => {
        await server.clients.db.write(
            'INSERT INTO fsentries (uuid, parent_uid, user_id, name, path, is_dir, size, created, accessed, modified) ' +
                'VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)',
            [
                uuidv4(),
                userId,
                `f_${Math.random().toString(36).slice(2, 8)}`,
                `/f_${Math.random().toString(36).slice(2, 8)}`,
                server.clients.db.booleanValue(false),
                size,
                0,
                0,
                0,
            ],
        );
    };

    beforeAll(async () => {
        // The cap has its own suite; these tests need many teams.
        server = await setupTestServer({
            teams_enabled: true,
            max_teams_per_user: 100,
        } as never);
        service = server.services.team;
        owner = await makeUser();

        for (const key of [
            'team.account.created',
            'team.account.disabled',
            'team.account.enabled',
            'team.account.deleted',
            'team.deleted',
            'team.held-bytes.report',
        ]) {
            server.clients.event.on(
                key as never,
                ((k: string, data: Record<string, unknown>) => {
                    seen.push({ key: k, data });
                }) as never,
            );
        }
    });

    beforeEach(() => {
        seen.length = 0;
    });

    afterAll(async () => {
        await server?.shutdown();
    });

    // -- on-demand lifecycle events -----------------------------------

    it('emits account-created once, naming the team and the owner', async () => {
        const team = await makeTeam();
        const seat = await provision(team);

        const events = of('team.account.created');
        expect(events).toHaveLength(1);
        expect(events[0].data).toMatchObject({
            team_uid: team.uid,
            owner_user_id: owner.id,
            user_id: seat.userId,
            username: seat.username,
        });
        // The payment side keys the charge off this, so it must be present.
        expect(typeof events[0].data.user_uuid).toBe('string');
    });

    it('carries the held bytes on disable, so billing need not query back', async () => {
        const team = await makeTeam();
        const seat = await provision(team);
        await giveFile(seat.userId, 4096);
        seen.length = 0;

        await service.disableMember(team.uid, owner.id, seat.userId);

        const events = of('team.account.disabled');
        expect(events).toHaveLength(1);
        expect(events[0].data.held_bytes).toBe(4096);
        expect(events[0].data.user_id).toBe(seat.userId);
    });

    it('emits account-enabled with the bytes that stop being charged', async () => {
        const team = await makeTeam();
        const seat = await provision(team);
        await giveFile(seat.userId, 1024);
        await service.disableMember(team.uid, owner.id, seat.userId);
        seen.length = 0;

        await service.enableMember(team.uid, owner.id, seat.userId);

        const events = of('team.account.enabled');
        expect(events).toHaveLength(1);
        expect(events[0].data.held_bytes).toBe(1024);
    });

    it('emits one disabled event per seat plus a team event on delete', async () => {
        const team = await makeTeam();
        const a = await provision(team);
        const b = await provision(team);
        seen.length = 0;

        await service.deleteTeam(team.uid, owner.id);

        // Per seat, because the byte charge that follows is per account.
        const disabled = of('team.account.disabled');
        expect(disabled).toHaveLength(2);
        expect(disabled.map((e) => e.data.user_id).sort()).toEqual(
            [a.userId, b.userId].sort(),
        );

        const deleted = of('team.deleted');
        expect(deleted).toHaveLength(1);
        expect(deleted[0].data).toMatchObject({
            team_uid: team.uid,
            account_count: 2,
        });
    });

    it('emits account-deleted, which a post-delete listener could not', async () => {
        const team = await makeTeam();
        const seat = await provision(team);
        seen.length = 0;

        await server.services.userAccount.cascadeDelete(seat.userId);

        const events = of('team.account.deleted');
        expect(events).toHaveLength(1);
        expect(events[0].data).toMatchObject({
            team_uid: team.uid,
            user_id: seat.userId,
            username: seat.username,
        });
    });

    it('leaves the membership unreadable after the delete it was captured for', async () => {
        const team = await makeTeam();
        const seat = await provision(team);
        await server.services.userAccount.cascadeDelete(seat.userId);

        // `jct_user_group.user_id` is ON DELETE CASCADE -- this is why the
        // identity has to be captured before the row goes.
        expect(await server.stores.team.getOrgSeat(seat.userId)).toBeNull();
    });

    // -- the authorization cache ------------------------------------------
    // `isMember` and `getByUid` gate every team route, so a stale entry is
    // access, not a stray notification. Each bust gets its own case.

    it('stops answering member once the account is removed', async () => {
        const team = await makeTeam();
        const seat = await provision(team);
        expect(await server.stores.team.isMember(team.uid, seat.userId)).toBe(true);

        await server.stores.team.removeMember(team.uid, seat.userId);

        expect(await server.stores.team.isMember(team.uid, seat.userId)).toBe(false);
    });

    it('stops answering member once the account is deleted out from under it', async () => {
        const team = await makeTeam();
        const seat = await provision(team);
        expect(await server.stores.team.isMember(team.uid, seat.userId)).toBe(true);

        // Cascades the membership row without passing through TeamStore.
        await server.services.userAccount.cascadeDelete(seat.userId);

        expect(await server.stores.team.isMember(team.uid, seat.userId)).toBe(false);
    });

    it('stops resolving the team, and its memberships, once it is deleted', async () => {
        const team = await makeTeam();
        const seat = await provision(team);
        expect(await server.stores.team.getByUid(team.uid)).toBeTruthy();
        expect(await server.stores.team.isMember(team.uid, seat.userId)).toBe(true);

        await server.stores.team.softDelete(team.uid);

        expect(await server.stores.team.getByUid(team.uid)).toBeNull();
        expect(await server.stores.team.isMember(team.uid, seat.userId)).toBe(false);
    });

    it('serves the renamed team, not the name it was read at', async () => {
        const team = await makeTeam();
        expect((await server.stores.team.getByUid(team.uid))?.name).toBe('Billing Co');

        await server.stores.team.update(team.uid, { name: 'Renamed Co' });

        expect((await server.stores.team.getByUid(team.uid))?.name).toBe('Renamed Co');
    });

    it('does not serve a stale member list after the roster changes', async () => {
        const team = await makeTeam();
        const before = await server.stores.team.listMemberIdsByGroupId(team.id);

        const seat = await provision(team);
        const after = await server.stores.team.listMemberIdsByGroupId(team.id);
        expect(after).toContain(seat.userId);
        expect(after.length).toBe(before.length + 1);

        // The membership row cascades away with the account, never through
        // TeamStore -- the case a TTL alone would get wrong.
        await server.services.userAccount.cascadeDelete(seat.userId);
        expect(
            await server.stores.team.listMemberIdsByGroupId(team.id),
        ).not.toContain(seat.userId);
    });

    it('refuses to delete a live account', async () => {
        const team = await makeTeam();
        const seat = await provision(team);

        await expect(
            service.deleteMember(team.uid, owner.id, seat.userId),
        ).rejects.toMatchObject({
            statusCode: 409,
            legacyCode: 'account_must_be_disabled_first',
        });
        expect(await server.stores.user.getById(seat.userId)).toBeTruthy();
    });

    it('deletes a disabled account and closes the storage charge once', async () => {
        const team = await makeTeam();
        const seat = await provision(team);
        await service.disableMember(team.uid, owner.id, seat.userId);
        seen.length = 0;

        await service.deleteMember(team.uid, owner.id, seat.userId);

        expect(await server.stores.user.getById(seat.userId)).toBeFalsy();
        expect(of('team.account.deleted')).toHaveLength(1);
    });

    it('keeps the audit trail attributable after the account is gone', async () => {
        const team = await makeTeam();
        const seat = await provision(team);
        await service.disableMember(team.uid, owner.id, seat.userId);
        await service.deleteMember(team.uid, owner.id, seat.userId);

        const rows = await server.stores.team.listAudit(team.id);
        const mine = rows.items.filter(
            (r) => Number(r.user_id_keep) === seat.userId,
        );
        // The FKs are ON DELETE SET NULL, so `_keep` is the only thing left.
        expect(mine.map((r) => r.action)).toContain('delete_account');
    });

    it('says nothing about an account no team pays for', async () => {
        const outsider = await makeUser();
        seen.length = 0;

        await server.services.userAccount.cascadeDelete(outsider.id);

        expect(of('team.account.deleted')).toHaveLength(0);
    });

    it('does not open a second byte charge when a seat is disabled twice', async () => {
        const team = await makeTeam();
        const seat = await provision(team);
        await service.disableMember(team.uid, owner.id, seat.userId);
        seen.length = 0;

        await service.disableMember(team.uid, owner.id, seat.userId);

        // `held_bytes` opens a charge one `enabled` closes; two opens and one
        // close leaves the payer billed for storage nobody holds.
        expect(of('team.account.disabled')).toHaveLength(0);
    });

    it('does not close a charge that was never opened', async () => {
        const team = await makeTeam();
        const seat = await provision(team);
        seen.length = 0;

        await service.enableMember(team.uid, owner.id, seat.userId);

        expect(of('team.account.enabled')).toHaveLength(0);
    });
});
