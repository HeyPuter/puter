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

describe('group grants', () => {
    let fx: TwoTeams;

    /** A plain user actor, which is what a grant is issued as. */
    const actorFor = async (userId: number): Promise<Actor> => {
        const user = await fx.env.server.stores.user.getById(userId);
        return { user } as unknown as Actor;
    };

    /** Written directly: these tests are about granting, not about writing. */
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
                // `is_dir` is a real boolean on postgres.
                fx.env.server.clients.db.booleanValue(false),
                Math.floor(Date.now() / 1000),
            ],
        );
        return { path, uid };
    };

    const permissions = () => fx.env.server.services.permission;
    const store = () => fx.env.server.stores.permission;

    beforeAll(async () => {
        fx = await setupTwoTeams();
    }, 180_000);

    afterAll(async () => {
        await fx?.shutdown();
    });

    // -- the fixture itself -------------------------------------------

    it('builds two teams, each with its own owner and two seats', async () => {
        expect(fx.a.uid).not.toBe(fx.b.uid);
        expect(fx.a.owner.userId).not.toBe(fx.b.owner.userId);
        expect(fx.a.seats).toHaveLength(2);
        expect(fx.b.seats).toHaveLength(2);

        // Distinct throughout, or it cannot tell this team from any.
        const ids = [
            fx.a.owner.userId,
            fx.b.owner.userId,
            ...fx.a.seats.map((s) => s.userId),
            ...fx.b.seats.map((s) => s.userId),
            fx.outsider.userId,
        ];
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('runs against the shipped one-team-per-user cap', async () => {
        // Lifting the cap here would stop it resembling production.
        const cfg = fx.env.server.services.team.config as {
            max_teams_per_user?: number;
        };
        expect(cfg.max_teams_per_user ?? 1).toBe(1);
    });

    it('seats can actually call the API', async () => {
        // An inert token would make every assertion below vacuous.
        const res = await fx.call('GET', `/teams/${fx.a.uid}`, fx.a.seats[0].token);
        expect(res.status).toBe(200);
    });

    // -- grants resolve for members, and only members -----------------

    it('resolves a grant for every member of the team it was given to', async () => {
        const file = await makeFile(fx.outsider.userId);
        const permission = `fs:${file.uid}:read`;

        await permissions().grantUserGroupPermission(
            await actorFor(fx.outsider.userId),
            fx.a.uid,
            permission,
        );

        for (const seat of fx.a.seats) {
            const rows = await store().readUserGroupPerms(seat.userId, [
                permission,
            ]);
            expect(rows, `seat ${seat.username}`).toHaveLength(1);
        }
    });

    it('does not resolve for the other team', async () => {
        const file = await makeFile(fx.outsider.userId);
        const permission = `fs:${file.uid}:read`;

        await permissions().grantUserGroupPermission(
            await actorFor(fx.outsider.userId),
            fx.a.uid,
            permission,
        );

        // Why the fixture has two: with one, an unscoped query still passes.
        for (const seat of fx.b.seats) {
            const rows = await store().readUserGroupPerms(seat.userId, [
                permission,
            ]);
            expect(rows, `B seat ${seat.username}`).toHaveLength(0);
        }
    });

    it('does not resolve for a user in no team', async () => {
        const file = await makeFile(fx.a.owner.userId);
        const permission = `fs:${file.uid}:read`;

        await permissions().grantUserGroupPermission(
            await actorFor(fx.a.owner.userId),
            fx.a.uid,
            permission,
        );

        const rows = await store().readUserGroupPerms(fx.outsider.userId, [
            permission,
        ]);
        expect(rows).toHaveLength(0);
    });

    // -- revoke --------------------------------------------------------

    it('revoking removes it for every member', async () => {
        const file = await makeFile(fx.outsider.userId);
        const permission = `fs:${file.uid}:read`;
        const issuer = await actorFor(fx.outsider.userId);

        await permissions().grantUserGroupPermission(
            issuer,
            fx.a.uid,
            permission,
        );
        const removed = await permissions().revokeUserGroupPermission(
            issuer,
            fx.a.uid,
            permission,
        );

        expect(removed).toBe(true);
        for (const seat of fx.a.seats) {
            expect(
                await store().readUserGroupPerms(seat.userId, [permission]),
            ).toHaveLength(0);
        }
    });

    it('announces the revoke for every member, so their watches get settled', async () => {
        const file = await makeFile(fx.outsider.userId);
        const permission = `fs:${file.uid}:read`;
        const issuer = await actorFor(fx.outsider.userId);
        const announced: number[] = [];
        const bus = fx.env.server.clients.event;
        const listen = ((_k: string, d: { holderUserId: number }) => {
            announced.push(d.holderUserId);
        }) as never;
        bus.on('permission.revoked', listen);

        try {
            await permissions().grantUserGroupPermission(
                issuer,
                fx.a.uid,
                permission,
            );
            announced.length = 0;
            await permissions().revokeUserGroupPermission(
                issuer,
                fx.a.uid,
                permission,
            );
        } finally {
            bus.off?.('permission.revoked', listen);
        }

        for (const seat of fx.a.seats) {
            expect(announced).toContain(seat.userId);
        }
    });

    it('reports false when there was nothing to revoke', async () => {
        const file = await makeFile(fx.outsider.userId);
        const removed = await permissions().revokeUserGroupPermission(
            await actorFor(fx.outsider.userId),
            fx.a.uid,
            `fs:${file.uid}:read`,
        );
        // Matching nothing is not an error, but a caller must be able to tell.
        expect(removed).toBe(false);
    });

    it('one issuer revoking does not drop another issuer identical grant', async () => {
        // Revoker owns the file; the rival grant is written directly.
        const file = await makeFile(fx.a.owner.userId);
        const permission = `fs:${file.uid}:write`;
        const groupId = (await store().resolveGroupId(fx.a.uid))!;

        // The only shape where the DELETE's issuer scoping decides anything.
        await permissions().grantUserGroupPermission(
            await actorFor(fx.a.owner.userId),
            fx.a.uid,
            permission,
        );
        await store().upsertUserGroupPerm(
            groupId,
            fx.outsider.userId,
            permission,
            {},
        );
        expect(
            await store().readUserGroupPerms(fx.a.seats[0].userId, [permission]),
        ).toHaveLength(2);

        await permissions().revokeUserGroupPermission(
            await actorFor(fx.a.owner.userId),
            fx.a.uid,
            permission,
        );

        // The owner's row is gone; the other issuer's survives.
        const left = await store().readUserGroupPerms(fx.a.seats[0].userId, [
            permission,
        ]);
        expect(left).toHaveLength(1);
        expect(left[0].user_id).toBe(fx.outsider.userId);
    });

    // -- authorization and shape --------------------------------------

    it('refuses a grant the issuer has no authority over', async () => {
        const file = await makeFile(fx.b.owner.userId);

        await expect(
            permissions().grantUserGroupPermission(
                await actorFor(fx.outsider.userId),
                fx.a.uid,
                `fs:${file.uid}:write`,
            ),
        ).rejects.toMatchObject({ statusCode: 403 });
    });

    it('404s on a group that does not exist', async () => {
        const file = await makeFile(fx.outsider.userId);
        await expect(
            permissions().grantUserGroupPermission(
                await actorFor(fx.outsider.userId),
                '00000000-0000-4000-8000-000000000000',
                `fs:${file.uid}:read`,
            ),
        ).rejects.toMatchObject({ statusCode: 404 });
    });

    it('round-trips a path-form permission through grant and revoke', async () => {
        const owner = await fx.env.server.stores.user.getById(
            fx.outsider.userId,
        );
        const file = await makeFile(fx.outsider.userId);
        const issuer = await actorFor(fx.outsider.userId);

        // Both must collapse to the same `fs:<uuid>:` string, or nothing matches.
        const pathPerm = `fs:${file.path}:read`;
        await permissions().grantUserGroupPermission(
            issuer,
            fx.a.uid,
            pathPerm,
        );
        expect(owner).toBeTruthy();

        const stored = await store().readUserGroupPerms(fx.a.seats[0].userId, [
            `fs:${file.uid}:read`,
        ]);
        expect(stored).toHaveLength(1);

        expect(
            await permissions().revokeUserGroupPermission(
                issuer,
                fx.a.uid,
                pathPerm,
            ),
        ).toBe(true);
    });

    it('audits both the grant and the revoke', async () => {
        const file = await makeFile(fx.outsider.userId);
        const permission = `fs:${file.uid}:read`;
        const issuer = await actorFor(fx.outsider.userId);

        await permissions().grantUserGroupPermission(
            issuer,
            fx.a.uid,
            permission,
        );
        await permissions().revokeUserGroupPermission(
            issuer,
            fx.a.uid,
            permission,
        );

        const rows = (await fx.env.server.clients.db.read(
            'SELECT `action` FROM `audit_user_to_group_permissions` ' +
                'WHERE `permission` = ? ORDER BY `id`',
            [permission],
        )) as { action: string }[];
        expect(rows.map((r) => r.action)).toEqual(['grant', 'revoke']);
    });

    it('stops resolving once the team is soft-deleted', async () => {
        const file = await makeFile(fx.outsider.userId);
        const permission = `fs:${file.uid}:read`;
        await permissions().grantUserGroupPermission(
            await actorFor(fx.outsider.userId),
            fx.b.uid,
            permission,
        );
        const seat = fx.b.seats[0].userId;
        expect(
            await store().readUserGroupPerms(seat, [permission]),
        ).toHaveLength(1);

        // Deletion suspends the seats but leaves memberships and grants, and
        // the uid stops resolving -- so this access would be unwithdrawable.
        await fx.env.server.stores.team.softDelete(fx.b.uid);

        expect(
            await store().readUserGroupPerms(seat, [permission]),
        ).toHaveLength(0);
    });
});
