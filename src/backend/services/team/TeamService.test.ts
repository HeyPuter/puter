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
    let ownerUsername: string;

    const makeUser = async (): Promise<{ id: number; username: string }> => {
        const username = `svc_${Math.random().toString(36).slice(2, 10)}`;
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
        ownerUsername = (await server.stores.user.getById(owner.id))!.username;
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
        // `userProtected` rejects on `suspended`; the others gate nothing.
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

        // Revoked, not deleted: the row keeps last_ip / last_user_agent.
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


    // -- provisioning -------------------------------------------------

    it('creates an account the workspace owns, pending a password change', async () => {
        const { team } = await makeWorkspace();
        const username = `prov_${Math.random().toString(36).slice(2, 9)}`;

        const result = await service.provisionAccount(team.uid, owner.id, {
            username,
            email: `${username}@test.local`,
        });

        expect(result.username).toBe(username);
        const user = await server.stores.user.getById(result.userId);
        expect(Boolean(user?.requires_password_change)).toBe(true);

        const membership = await server.stores.team.getMembership(
            team.uid,
            result.userId,
        );
        expect(Number(membership?.org_owned)).toBe(1);
    });

    it('gives the new account its default filesystem tree', async () => {
        const { team } = await makeWorkspace();
        const username = `tree_${Math.random().toString(36).slice(2, 9)}`;

        const result = await service.provisionAccount(team.uid, owner.id, {
            username,
            email: `${username}@test.local`,
        });

        const user = await server.stores.user.getById(result.userId);
        expect(user?.trash_uuid).toBeTruthy();
    });

    it('returns a temporary password the admin delivers out of band', async () => {
        const { team } = await makeWorkspace();
        const username = `link_${Math.random().toString(36).slice(2, 9)}`;

        const result = await service.provisionAccount(team.uid, owner.id, {
            username,
            email: `${username}@test.local`,
        });

        expect(result.temporaryPassword).toHaveLength(16);
        const user = await server.stores.user.getById(result.userId);
        // Hashed, and the account cannot do anything until it is changed.
        expect(user?.password).not.toBe(result.temporaryPassword);
        expect(Boolean(user?.requires_password_change)).toBe(true);
    });

    it('writes nothing when the username is taken', async () => {
        const { team } = await makeWorkspace();
        const taken = await makeUser();
        const before = await server.stores.team.listMembers(team.uid);

        await expect(
            service.provisionAccount(team.uid, owner.id, {
                username: taken.username,
                email: 'someone@test.local',
            }),
        ).rejects.toMatchObject({ statusCode: 409 });

        // Checked before any row is written, so the workspace is untouched.
        const after = await server.stores.team.listMembers(team.uid);
        expect(after.items).toHaveLength(before.items.length);
    });

    it('offers free alternatives instead of modifying the name', async () => {
        const taken = await makeUser();
        const suggestions = await service.suggestUsernames(taken.username);

        expect(suggestions.length).toBeGreaterThan(0);
        for (const suggestion of suggestions) {
            expect(suggestion).not.toBe(taken.username);
            await expect(
                server.stores.user.getByUsername(suggestion),
            ).resolves.toBeFalsy();
        }
    });

    it('refuses provisioning by anyone but the workspace owner', async () => {
        const { team, member } = await makeWorkspace();
        await expect(
            service.provisionAccount(team.uid, member.id, {
                username: `nope_${Math.random().toString(36).slice(2, 9)}`,
                email: 'nope@test.local',
            }),
        ).rejects.toMatchObject({ statusCode: 403 });
    });

    it('re-issues a different credential each time', async () => {
        const { team } = await makeWorkspace();
        const username = `again_${Math.random().toString(36).slice(2, 9)}`;
        const result = await service.provisionAccount(team.uid, owner.id, {
            username,
            email: `${username}@test.local`,
        });
        const again = await service.reissueCredential(
            team.uid,
            owner.id,
            result.userId,
        );
        expect(again.temporaryPassword).not.toBe(result.temporaryPassword);
    });

    it('refuses to re-issue once the member has chosen a password', async () => {
        const { team } = await makeWorkspace();
        const username = `done_${Math.random().toString(36).slice(2, 9)}`;
        const result = await service.provisionAccount(team.uid, owner.id, {
            username,
            email: `${username}@test.local`,
        });
        // Simulate the member choosing their own password.
        await server.stores.user.update(result.userId, {
            requires_password_change: 0,
        });

        await expect(
            service.reissueCredential(team.uid, owner.id, result.userId),
        ).rejects.toMatchObject({ statusCode: 409 });
    });
    it('refuses an email that already belongs to an account', async () => {
        const { team } = await makeWorkspace();
        const existing = await makeUser();
        const row = await server.stores.user.getById(existing.id);

        await expect(
            service.provisionAccount(team.uid, owner.id, {
                username: `dup_${Math.random().toString(36).slice(2, 9)}`,
                email: row!.email!,
            }),
        ).rejects.toMatchObject({ statusCode: 409 });
    });

    it('refuses a username signup itself would reject', async () => {
        const { team } = await makeWorkspace();
        for (const username of ['has-hyphen', 'x'.repeat(46), 'admin']) {
            await expect(
                service.provisionAccount(team.uid, owner.id, {
                    username,
                    email: 'x@test.local',
                }),
            ).rejects.toMatchObject({ statusCode: 400 });
        }
    });

    it('refuses an invalid email', async () => {
        const { team } = await makeWorkspace();
        await expect(
            service.provisionAccount(team.uid, owner.id, {
                username: `bad_${Math.random().toString(36).slice(2, 9)}`,
                email: 'not-an-email',
            }),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('only suggests usernames the next call would accept', async () => {
        const taken = await makeUser();
        for (const s of await service.suggestUsernames(taken.username)) {
            expect(s.length).toBeLessThanOrEqual(45);
            expect(s).toMatch(/^\w+$/u);
        }
    });
    it('generates a different credential for every account', async () => {
        const { team } = await makeWorkspace();
        const seen = new Set<string>();
        for (let i = 0; i < 3; i++) {
            const u = `gen_${Math.random().toString(36).slice(2, 9)}`;
            const r = await service.provisionAccount(team.uid, owner.id, {
                username: u,
                email: `${u}@test.local`,
            });
            expect(r.temporaryPassword).toMatch(/^[A-Za-z2-9]{16}$/u);
            seen.add(r.temporaryPassword);
        }
        expect(seen.size).toBe(3);
    });

    it('survives having no email transport, since the notice carries nothing', async () => {
        const { team } = await makeWorkspace();
        const u = `noem_${Math.random().toString(36).slice(2, 9)}`;

        // The credential is returned, so delivery failing loses nothing.
        const r = await service.provisionAccount(team.uid, owner.id, {
            username: u,
            email: `${u}@test.local`,
        });
        expect(r.temporaryPassword).toBeTruthy();
    });
    // -- audit --------------------------------------------------------

    it('records provisioning, disabling and enabling as they happen', async () => {
        const { team } = await makeWorkspace();
        const username = `aud_${Math.random().toString(36).slice(2, 9)}`;
        const created = await service.provisionAccount(team.uid, owner.id, {
            username,
            email: `${username}@test.local`,
        });
        await service.disableMember(team.uid, owner.id, created.userId);
        await service.enableMember(team.uid, owner.id, created.userId);

        // Written by the service, so a caller bypassing the route cannot skip it.
        const { items: entries } = await service.listAudit(team.uid, owner.id);
        const forMember = entries.filter((e) => e.username === username);
        expect(forMember.map((e) => e.action)).toEqual([
            'enable',
            'disable',
            'provision',
        ]);
        expect(
            forMember.every((e) => e.actor_username === ownerUsername),
        ).toBe(true);
    });

    it('shows a member only their own entries', async () => {
        const { team } = await makeWorkspace();
        const a = `one_${Math.random().toString(36).slice(2, 9)}`;
        const b = `two_${Math.random().toString(36).slice(2, 9)}`;
        const first = await service.provisionAccount(team.uid, owner.id, {
            username: a,
            email: `${a}@test.local`,
        });
        await service.provisionAccount(team.uid, owner.id, {
            username: b,
            email: `${b}@test.local`,
        });

        const { items: own } = await service.listOwnAudit(team.uid, first.userId);
        expect(own).toHaveLength(1);
        expect(own[0].username).toBe(a);
        // Internal ids must not reach a caller, as `toClientTeam` does for `id`.
        expect(own[0]).not.toHaveProperty('user_id_keep');
        expect(own[0]).not.toHaveProperty('actor_user_id');
    });

    it('keeps the audit from a member who is not the owner', async () => {
        const { team, member } = await makeWorkspace();
        await expect(
            service.listAudit(team.uid, member.id),
        ).rejects.toMatchObject({ statusCode: 403 });
    });

    it('records a workspace deletion and survives the soft delete', async () => {
        const { team } = await makeWorkspace();
        await service.deleteWorkspace(team.uid, owner.id);

        // Gone from reads, but its owner can still read what happened.
        await expect(server.stores.team.getByUid(team.uid)).resolves.toBeNull();
        const { items: entries } = await service.listAudit(team.uid, owner.id);
        expect(entries.map((e) => e.action)).toContain('delete_team');
    });
    it('disables the accounts it created when the workspace is deleted', async () => {
        const { team } = await makeWorkspace();
        const u = `del_${Math.random().toString(36).slice(2, 9)}`;
        const provisioned = await service.provisionAccount(team.uid, owner.id, {
            username: u,
            email: `${u}@test.local`,
        });

        await service.deleteWorkspace(team.uid, owner.id);

        // Otherwise they keep working, unreachable through a deleted workspace.
        const row = await suspensionOf(provisioned.userId);
        expect(Boolean(row.suspended)).toBe(true);
        expect(row.suspended_reason).toBe('disabled_by_workspace');
    });

    it('leaves the workspace owner alone when its workspace is deleted', async () => {
        const { team } = await makeWorkspace();
        await service.deleteWorkspace(team.uid, owner.id);

        // org_owned = 0, so it pays for itself and is not the workspace's to close.
        expect(Boolean((await suspensionOf(owner.id)).suspended)).toBe(false);
    });

    it('pages the audit rather than truncating it', async () => {
        const { team } = await makeWorkspace();
        for (let i = 0; i < 2; i++) {
            const u = `pg_${Math.random().toString(36).slice(2, 9)}`;
            await service.provisionAccount(team.uid, owner.id, {
                username: u,
                email: `${u}@test.local`,
            });
        }

        const first = await service.listAudit(team.uid, owner.id, { limit: 1 });
        expect(first.items).toHaveLength(1);
        expect(first.cursor).toBeTruthy();

        // Older entries stay reachable instead of dropping off the view.
        const second = await service.listAudit(team.uid, owner.id, { limit: 1 });
        expect(second.items).toHaveLength(1);
    });
});
