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

/**
 * Team sharing, asked the question the product actually asks: *can this member
 * open the file*. `TeamShare.test.ts` covers the rows and the listings, both of
 * which resolve a team share without ever entering the permission scan — so a
 * scan that never terminates leaves that whole suite green.
 *
 * The scan is only reachable when the issuer does not own the entry: the
 * `is-owner` implicator (`FSService`) is a shortcut, so an owner's sub-scan
 * returns before the group scanner runs. A member re-sharing into their own
 * team is the case that gets past it.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Actor } from '../../core/actor';
import { setupTwoTeams, type TwoTeams } from '../../testFixtures/twoTeams.js';

describe('resolving access to a team-shared item', () => {
    let fx: TwoTeams;

    const actorFor = async (userId: number): Promise<Actor> => {
        const user = await fx.env.server.stores.user.getById(userId);
        return { user } as unknown as Actor;
    };

    const shares = () => fx.env.server.services.share;

    /** Read access as ACLService answers it — the real authorization path. */
    const canRead = async (userId: number, path: string): Promise<boolean> =>
        fx.env.server.services.acl.check(
            await actorFor(userId),
            {
                path,
                resolveAncestors: () =>
                    fx.env.server.services.fs.getAncestorChain(path),
            },
            'read',
        );

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

    const shareWithTeam = async (
        actingUserId: number,
        path: string,
        teamUid: string,
        mode: string,
    ) =>
        shares().share(await actorFor(actingUserId), {
            path,
            recipient: { team: teamUid },
            mode,
        } as never);

    /**
     * Owner hands the team `manage`, then a seat re-shares into that same
     * team. The second grant is issued by someone who is himself a member, so
     * the issuer's own scan reaches the row he wrote.
     */
    const reshareIntoOwnTeam = async () => {
        const file = await makeFile(fx.a.owner.userId);
        // `manage` is what lets a member re-share at all.
        await shareWithTeam(fx.a.owner.userId, file.path, fx.a.uid, 'manage');
        await shareWithTeam(fx.a.seats[0].userId, file.path, fx.a.uid, 'read');
        return file;
    };

    beforeAll(async () => {
        fx = await setupTwoTeams();
    }, 180_000);

    afterAll(async () => {
        await fx?.shutdown();
    });

    it('answers for a plain team share', async () => {
        const file = await makeFile(fx.a.owner.userId);
        await shareWithTeam(fx.a.owner.userId, file.path, fx.a.uid, 'read');

        // Baseline: the owner issues it, so `is-owner` ends the sub-scan and
        // the group scanner never runs. This passes with or without the fix.
        expect(await canRead(fx.a.seats[0].userId, file.path)).toBe(true);
        expect(await canRead(fx.b.seats[0].userId, file.path)).toBe(false);
    }, 60_000);

    it('terminates when a member re-shared into the team they belong to', async () => {
        const file = await reshareIntoOwnTeam();

        // Without the fix this never returns: the scan of the re-sharer finds
        // his own row again, and the scan cache is only written on completion
        // so the in-flight re-entry always misses.
        expect(await canRead(fx.a.seats[1].userId, file.path)).toBe(true);
    }, 60_000);

    it('still resolves for the re-sharer after someone else took that path', async () => {
        const file = await reshareIntoOwnTeam();

        // Order matters: the other member's check is what runs the pruned
        // sub-scan of the re-sharer. If that pruned reading is kept, the
        // re-sharer is then denied access he holds through the owner's grant.
        expect(await canRead(fx.a.seats[1].userId, file.path)).toBe(true);
        expect(await canRead(fx.a.seats[0].userId, file.path)).toBe(true);
    }, 60_000);

    it('does not leak the re-shared item to the other team', async () => {
        const file = await reshareIntoOwnTeam();

        expect(await canRead(fx.b.seats[0].userId, file.path)).toBe(false);
        expect(await canRead(fx.outsider.userId, file.path)).toBe(false);
    }, 60_000);
});
