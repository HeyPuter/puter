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

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeActor, type Actor } from '../../core/actor.js';
import { runWithContext } from '../../core/context.js';
import { setupTwoTeams, type TwoTeams } from '../../testFixtures/twoTeams.js';

describe('sharing: delegate withdrawing grants through an app', () => {
    let fx: TwoTeams;

    beforeAll(async () => {
        fx = await setupTwoTeams();
    }, 180_000);

    afterAll(async () => {
        await fx?.shutdown();
    });

    const server = () => fx.env.server;

    const actorOf = async (userId: number): Promise<Actor> => {
        const user = await server().stores.user.getById(userId);
        return makeActor({ user: user! });
    };

    const makeFile = async (ownerId: number) => {
        const owner = await server().stores.user.getById(ownerId);
        const uid = crypto.randomUUID();
        const name = `secscan05-${uid.slice(0, 8)}.txt`;
        const path = `/${owner!.username}/${name}`;
        await server().clients.db.write(
            'INSERT INTO `fsentries` (`uuid`, `name`, `path`, `user_id`, `is_dir`, `modified`) VALUES (?, ?, ?, ?, ?, ?)',
            [
                uid,
                name,
                path,
                ownerId,
                server().clients.db.booleanValue(false),
                Math.floor(Date.now() / 1000),
            ],
        );
        return { uid, path, name };
    };

    const makeApp = async (ownerId: number) =>
        server().stores.app.create(
            {
                name: `secscan05-app-${crypto.randomUUID().slice(0, 8)}`,
                title: 'Shared tool',
                index_url: `https://secscan05-${crypto.randomUUID()}.test/`,
            },
            { ownerUserId: ownerId },
        );

    /** The user hands the app `permission` and gets the app's token back. */
    const appTokenFor = async (
        userId: number,
        appUid: string,
        permission: string,
    ) => {
        const actor = await actorOf(userId);
        await runWithContext({ actor }, () =>
            server().services.permission.grantUserAppPermission(
                actor,
                appUid,
                permission,
            ),
        );
        return server().services.auth.getUserAppToken(actor, appUid);
    };

    const canRead = async (userId: number, path: string) =>
        server().services.acl.check(
            await actorOf(userId),
            server().services.acl.fsDescriptor(path),
            'read',
        );

    it("preserves the owner's team share when a delegate revokes through an app", async () => {
        const owner = fx.a.owner;
        const seat = fx.a.seats[0];
        const delegate = fx.outsider;
        const file = await makeFile(owner.userId);
        const app = await makeApp(owner.userId);

        const ownerAppToken = await appTokenFor(
            owner.userId,
            app.uid,
            `fs:${file.uid}:read`,
        );
        const teamShare = await fx.call('POST', '/share', ownerAppToken, {
            recipients: [{ team: fx.a.uid }],
            items: [{ uid: file.uid }],
            mode: 'read',
        });
        expect(teamShare.status).toBe(200);
        expect((await teamShare.json()).status).toBe('success');

        const delegation = await fx.call('POST', '/share', owner.token, {
            recipients: [delegate.username],
            items: [{ uid: file.uid }],
            mode: 'manage',
        });
        expect((await delegation.json()).status).toBe('success');
        expect(await canRead(seat.userId, file.path)).toBe(true);

        const revokeTeam = (token: string) =>
            fx.call('POST', '/share/revoke', token, {
                recipients: [{ team: fx.a.uid }],
                items: [{ uid: file.uid }],
            });

        const direct = await revokeTeam(delegate.token);
        expect(direct.status).toBe(200);
        expect((await direct.json()).revoked).toBe(0);
        expect(await canRead(seat.userId, file.path)).toBe(true);

        const delegateAppToken = await appTokenFor(
            delegate.userId,
            app.uid,
            `fs:${file.uid}:read`,
        );
        const viaApp = await revokeTeam(delegateAppToken);
        expect(viaApp.status).toBe(200);
        expect((await viaApp.json()).revoked).toBe(0);

        expect(await canRead(seat.userId, file.path)).toBe(true);
        const listed = await server().services.share.listSharesOf(
            await actorOf(owner.userId),
            { uid: file.uid },
        );
        expect(listed.some((share) => share.holderTeam)).toBe(true);
    });
});
