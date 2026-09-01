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

describe('TeamService', () => {
    let server: PuterServer;
    let service: PuterServer['services']['team'];
    let owner: { id: number };

    const makeUser = async (): Promise<{ id: number; username: string }> => {
        const username = `svc-${Math.random().toString(36).slice(2, 10)}`;
        const created = (await server.stores.user.create({
            username,
            uuid: uuidv4(),
            password: null,
            email: `${username}@test.local`,
        })) as unknown as { id: number };
        return { id: created.id, username };
    };

    const freeHandle = () => `ws-${Math.random().toString(36).slice(2, 10)}`;

    /** A workspace with the owner admitted and one provisioned member. */
    const makeWorkspace = async () => {
        const team = await service.createWorkspace(owner.id, {
            name: 'Acme',
            handle: freeHandle(),
        });
        const member = await makeUser();
        await server.stores.team.addMember(team.uid, member.id, {
            orgOwned: true,
        });
        return { team, member };
    };

    const suspensionOf = async (userId: number) => {
        const [row] = (await server.clients.db.read(
            'SELECT `suspended`, `suspended_at`, `suspended_reason` FROM `user` WHERE `id` = ?',
            [userId],
        )) as {
            suspended: number | null;
            suspended_at: number | null;
            suspended_reason: string | null;
        }[];
        return row;
    };

    beforeAll(async () => {
        server = await setupTestServer();
        service = server.services.team;
        owner = await makeUser();
    });

    afterAll(async () => {
        await server?.shutdown();
    });

    // -- creating a workspace -----------------------------------------

    it('creates a workspace and admits its creator as the workspace owner', async () => {
        const team = await service.createWorkspace(owner.id, {
            name: 'Acme Design',
            handle: freeHandle(),
        });

        expect(team.owner_user_id).toBe(owner.id);
        const membership = await server.stores.team.getMembership(
            team.uid,
            owner.id,
        );
        // 0 is what makes the owner pay for itself.
        expect(Number(membership?.org_owned)).toBe(0);
    });

    it('holds the owner invariant that no dialect can express', async () => {
        const { team } = await makeWorkspace();
        await expect(service.checkOwnerInvariant(team.uid)).resolves.toBe(true);
    });

    it('breaks the invariant if a second account is admitted as the payer', async () => {
        const { team } = await makeWorkspace();
        const other = await makeUser();
        await server.stores.team.addMember(team.uid, other.id, {
            orgOwned: false,
        });

        // The check exists precisely because the schema cannot refuse this.
        await expect(service.checkOwnerInvariant(team.uid)).resolves.toBe(false);
    });

    // -- authority ----------------------------------------------------

    it('refuses a member who is not the workspace owner', async () => {
        const { team, member } = await makeWorkspace();
        await expect(
            service.requireOwner(team.uid, member.id),
        ).rejects.toMatchObject({ statusCode: 403 });
    });

    it('gives a stranger 404 rather than 403, so it is not an oracle', async () => {
        const { team } = await makeWorkspace();
        const stranger = await makeUser();
        await expect(
            service.requireMembership(team.uid, stranger.id),
        ).rejects.toMatchObject({ statusCode: 404 });
        await expect(
            service.requireOwner(team.uid, stranger.id),
        ).rejects.toMatchObject({ statusCode: 404 });
    });

    it('refuses the workspace owner as the target of a member route', async () => {
        const { team } = await makeWorkspace();
        await expect(
            service.requireOrgAccount(team.uid, owner.id),
        ).rejects.toMatchObject({ statusCode: 404 });
    });

    // -- disable and re-enable ----------------------------------------

    it('sets the column the request gate actually reads', async () => {
        const { team, member } = await makeWorkspace();

        await service.disableMember(team.uid, owner.id, member.id);

        const row = await suspensionOf(member.id);
        // `userProtected` rejects on `suspended`; the other two are its
        // siblings and do not gate anything on their own.
        expect(Boolean(row.suspended)).toBe(true);
        expect(row.suspended_at).toBeGreaterThan(0);
        expect(row.suspended_reason).toBe('disabled_by_workspace');
    });

    it('drops the disabled account\'s sessions', async () => {
        const { team, member } = await makeWorkspace();
        await server.clients.db.write(
            'INSERT INTO `sessions` (`uuid`, `user_id`) VALUES (?, ?)',
            [uuidv4(), member.id],
        );

        await service.disableMember(team.uid, owner.id, member.id);

        // Revoked, not deleted: the row keeps `last_ip` / `last_user_agent`,
        // which the member-facing audit view reads.
        const live = await server.clients.db.read(
            'SELECT COUNT(*) AS n FROM `sessions` WHERE `user_id` = ? AND `revoked_at` IS NULL',
            [member.id],
        );
        expect(Number(live[0].n)).toBe(0);

        const kept = await server.clients.db.read(
            'SELECT COUNT(*) AS n FROM `sessions` WHERE `user_id` = ?',
            [member.id],
        );
        expect(Number(kept[0].n)).toBe(1);
    });

    it('restores the account exactly as it was on re-enable', async () => {
        const { team, member } = await makeWorkspace();
        await service.disableMember(team.uid, owner.id, member.id);

        await service.enableMember(team.uid, owner.id, member.id);

        const row = await suspensionOf(member.id);
        expect(Boolean(row.suspended)).toBe(false);
        expect(row.suspended_at).toBeNull();
        expect(row.suspended_reason).toBeNull();
    });

    it('leaves the disabled account\'s files alone', async () => {
        const { team, member } = await makeWorkspace();
        await server.clients.db.write(
            'INSERT INTO `fsentries` (`uuid`, `name`, `user_id`, `modified`) VALUES (?, ?, ?, ?)',
            [uuidv4(), 'kept.txt', member.id, 0],
        );

        await service.disableMember(team.uid, owner.id, member.id);

        const rows = await server.clients.db.read(
            'SELECT COUNT(*) AS n FROM `fsentries` WHERE `user_id` = ?',
            [member.id],
        );
        expect(Number(rows[0].n)).toBe(1);
    });

    it('refuses to disable the workspace owner', async () => {
        const { team } = await makeWorkspace();
        await expect(
            service.disableMember(team.uid, owner.id, owner.id),
        ).rejects.toMatchObject({ statusCode: 404 });

        expect(Boolean((await suspensionOf(owner.id)).suspended)).toBe(false);
    });

    it('refuses a disable ordered by someone who is not the owner', async () => {
        const { team, member } = await makeWorkspace();
        const other = await makeUser();
        await server.stores.team.addMember(team.uid, other.id, {
            orgOwned: true,
        });

        await expect(
            service.disableMember(team.uid, other.id, member.id),
        ).rejects.toMatchObject({ statusCode: 403 });
        expect(Boolean((await suspensionOf(member.id)).suspended)).toBe(false);
    });

    it('refuses to disable a member of another workspace', async () => {
        const a = await makeWorkspace();
        const b = await makeWorkspace();

        await expect(
            service.disableMember(a.team.uid, owner.id, b.member.id),
        ).rejects.toMatchObject({ statusCode: 404 });
    });
    it('refuses to lift a suspension the workspace did not impose', async () => {
        const { team, member } = await makeWorkspace();
        // What a platform abuse suspension looks like.
        await server.stores.user.update(member.id, {
            suspended: 1,
            suspended_at: Math.floor(Date.now() / 1000),
            suspended_reason: 'abuse_detected',
        });

        await expect(
            service.enableMember(team.uid, owner.id, member.id),
        ).rejects.toMatchObject({ statusCode: 409 });

        const row = await suspensionOf(member.id);
        expect(Boolean(row.suspended)).toBe(true);
        expect(row.suspended_reason).toBe('abuse_detected');
    });

    it('lifts its own suspension normally', async () => {
        const { team, member } = await makeWorkspace();
        await service.disableMember(team.uid, owner.id, member.id);

        await service.enableMember(team.uid, owner.id, member.id);
        expect(Boolean((await suspensionOf(member.id)).suspended)).toBe(false);
    });
});
