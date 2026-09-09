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

import {
    afterAll,
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import type { Actor } from '../../core/actor';
import {
    setupTwoTeams,
    type TwoTeams,
} from '../../testFixtures/twoTeams.js';

/**
 * A team share names no holder, so every map in `notifyShared` used to skip
 * it and the call succeeded having told nobody. The failure mode is silence:
 * the share is created, resolves and lists correctly, and nothing errors. Only
 * a test that counts notifications catches it.
 */
describe('announcing a team share', () => {
    let fx: TwoTeams;

    const actorFor = async (userId: number): Promise<Actor> => {
        const user = await fx.env.server.stores.user.getById(userId);
        return { user } as unknown as Actor;
    };

    const makeFile = async (ownerId: number) => {
        const uid = crypto.randomUUID();
        const name = `n_${uid.slice(0, 8)}.txt`;
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
        return path;
    };

    /** Share and announce, the way `ShareController` does on the response path. */
    const shareAndNotify = async (
        issuerId: number,
        path: string,
        recipient: Record<string, string>,
    ) => {
        const actor = await actorFor(issuerId);
        const share = await fx.env.server.services.share.share(actor, {
            path,
            recipient,
            mode: 'read',
        } as never);
        await fx.env.server.services.shareNotification.notifyShared(actor, [
            share,
        ]);
        return share;
    };

    const notificationsFor = async (userId: number) => {
        const rows = await fx.env.server.stores.notification.listByUserId(
            userId,
            { filter: 'unacknowledged' },
        );
        return rows as unknown as Array<{ value?: unknown }>;
    };

    const titlesFor = async (userId: number): Promise<string[]> =>
        (await notificationsFor(userId)).map((row) => {
            const value = (
                typeof row.value === 'string'
                    ? JSON.parse(row.value)
                    : (row.value ?? {})
            ) as { title?: string };
            return value.title ?? '';
        });

    let sent: Array<{ to: string; subject: string }>;

    beforeAll(async () => {
        fx = await setupTwoTeams({
            // A transport must exist for the service to try at all; `sendRaw`
            // is spied, so nothing leaves the process.
            email: {
                from: '"Puter (test)" <no-reply@puter.localhost>',
                host: '127.0.0.1',
                port: 1,
            },
            // Digests flush almost at once rather than after a real minute.
            share_notify_limits: { emailBatchSeconds: 0.05 },
        } as never);
    }, 180_000);

    beforeEach(() => {
        sent = [];
        vi.spyOn(fx.env.server.clients.email, 'sendRaw').mockImplementation(
            async (options: { to: string; subject: string }) => {
                sent.push({ to: options.to, subject: options.subject });
                return null;
            },
        );
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    afterAll(async () => {
        await fx?.shutdown();
    });

    it('tells every member of the team', async () => {
        const path = await makeFile(fx.a.owner.userId);
        await shareAndNotify(fx.a.owner.userId, path, { team: fx.a.uid });

        for (const seat of fx.a.seats) {
            const titles = await titlesFor(seat.userId);
            expect(titles.length).toBeGreaterThan(0);
        }
    });

    it('does not tell the issuer about their own share', async () => {
        const before = (await notificationsFor(fx.a.owner.userId)).length;
        const path = await makeFile(fx.a.owner.userId);
        await shareAndNotify(fx.a.owner.userId, path, { team: fx.a.uid });

        expect((await notificationsFor(fx.a.owner.userId)).length).toBe(before);
    });

    it('does not tell members of a team it was not shared with', async () => {
        const before = await Promise.all(
            fx.b.seats.map(async (s) => (await notificationsFor(s.userId)).length),
        );
        const path = await makeFile(fx.a.owner.userId);
        await shareAndNotify(fx.a.owner.userId, path, { team: fx.a.uid });

        const after = await Promise.all(
            fx.b.seats.map(async (s) => (await notificationsFor(s.userId)).length),
        );
        expect(after).toEqual(before);
    });

    it('does not retroactively tell a member who joins afterwards', async () => {
        const path = await makeFile(fx.a.owner.userId);
        await shareAndNotify(fx.a.owner.userId, path, { team: fx.a.uid });

        // The outsider joins after the announcement; the scan will resolve the
        // grant for them, but announcements describe a moment, not a state.
        const team = await fx.env.server.stores.team.getByUid(fx.a.uid);
        await fx.env.server.stores.team.addMember(
            fx.a.uid,
            fx.outsider.userId,
            { orgOwned: false },
        );
        expect(team).toBeTruthy();

        expect(await titlesFor(fx.outsider.userId)).toHaveLength(0);
    });

    it('emails every member too, not just the in-app notification', async () => {
        const path = await makeFile(fx.a.owner.userId);
        await shareAndNotify(fx.a.owner.userId, path, { team: fx.a.uid });

        // The digest is held briefly, so wait for the flush rather than the
        // queueing -- asserting too early passes for the wrong reason.
        await vi.waitFor(
            () => {
                for (const seat of fx.a.seats) {
                    expect(
                        sent.some((mail) => mail.to === `${seat.username}@test.local`),
                    ).toBe(true);
                }
            },
            { timeout: 10_000, interval: 100 },
        );

        // And nobody outside the team was mailed about it. Checked against
        // team B's owner, who never joins A -- the `outsider` is admitted
        // to A by the test above, so by here they are a member.
        expect(
            sent.some((mail) => mail.to.includes(fx.b.owner.username)),
        ).toBe(false);
    });

    it('does not announce to a member who blocked the sharer', async () => {
        // A member nobody has notified yet, so a new row is detectable. Reusing
        // a seat would not be: a second share *folds* into its open
        // notification, leaving the row count unchanged either way.
        const username = `blk_${Math.random().toString(36).slice(2, 9)}`;
        const fresh = await fx.env.server.stores.user.create({
            username,
            uuid: crypto.randomUUID(),
            password: null,
            email: `${username}@test.local`,
        });
        await fx.env.server.stores.team.addMember(fx.a.uid, fresh.id, {
            orgOwned: false,
        });
        const blocker = { userId: fresh.id, username };
        const other = fx.a.seats[1];
        await fx.env.server.stores.userBlock.create(
            blocker.userId,
            fx.a.owner.userId,
        );

        const before = (await notificationsFor(blocker.userId)).length;
        expect(before).toBe(0);
        const path = await makeFile(fx.a.owner.userId);
        await shareAndNotify(fx.a.owner.userId, path, { team: fx.a.uid });

        // The grant is one row against the group so it still reaches them; the
        // contact the block refuses is the telling.
        //
        // Asserted on notifications rather than mail: by this point in the file
        // the per-pair interruption budget is spent, so no digest opens and an
        // email assertion would pass for the wrong reason. Notifications are
        // still written when the budget is spent -- that is the documented
        // split between what it says and whether it may interrupt.
        expect((await notificationsFor(blocker.userId)).length).toBe(before);
        expect(
            (await notificationsFor(other.userId)).length,
        ).toBeGreaterThan(0);

        await fx.env.server.stores.userBlock.deleteByPair(
            blocker.userId,
            fx.a.owner.userId,
        );
    });

    it('reads the member list once however many items are shared', async () => {
        const spy = vi.spyOn(
            fx.env.server.stores.team,
            'listMemberIdsByGroupId',
        );
        const actor = await actorFor(fx.a.owner.userId);
        const paths = [
            await makeFile(fx.a.owner.userId),
            await makeFile(fx.a.owner.userId),
            await makeFile(fx.a.owner.userId),
        ];
        const created = [];
        for (const path of paths) {
            created.push(
                await fx.env.server.services.share.share(actor, {
                    path,
                    recipient: { team: fx.a.uid },
                    mode: 'read',
                }),
            );
        }
        spy.mockClear();

        await fx.env.server.services.shareNotification.notifyShared(
            actor,
            created,
        );

        // One team, so one read -- not one per item.
        expect(spy).toHaveBeenCalledTimes(1);
    });
    it('checks block state once per team, not once per item', async () => {
        const spy = vi.spyOn(fx.env.server.stores.userBlock, 'isBlocked');
        const actor = await actorFor(fx.a.owner.userId);
        const created = [];
        for (let i = 0; i < 3; i++) {
            created.push(
                await fx.env.server.services.share.share(actor, {
                    path: await makeFile(fx.a.owner.userId),
                    recipient: { team: fx.a.uid },
                    mode: 'read',
                }),
            );
        }
        spy.mockClear();

        await fx.env.server.services.shareNotification.notifyShared(
            actor,
            created,
        );

        // Block state is per (member, issuer) pair -- constant across the items
        // in one call, so 3 items must not triple the queries.
        const team = await fx.env.server.stores.team.getByUid(fx.a.uid);
        const members = await fx.env.server.stores.team.listMemberIdsByGroupId(
            team.id,
        );
        expect(spy.mock.calls.length).toBeLessThanOrEqual(members.length);
    });
});
