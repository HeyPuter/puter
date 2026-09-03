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
 * What happens to a subscription when the grant under it is taken away.
 *
 * Two mechanisms, and the tests keep them apart on purpose. The delivery
 * re-check is the backstop: it denies from the next event, on its own, with
 * nothing having to find the row — which is what the session cases prove, since
 * nothing settles those. The settle is the cleanup: it takes the durable rows
 * out of service so a revoked subscription stops costing anything at all.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { EVENTS_COALESCE_WINDOW_MS } from '../../controllers/events/limits.js';
import { SUSPENDED_ROW_TTL_DAYS } from '../../controllers/events/limits.js';
import { makeActor, type Actor } from '../../core/actor.js';
import { runWithContext } from '../../core/context.js';
import {
    createTestUser,
    setupPuterTestEnv,
    type PuterTestEnv,
} from '../../testUtil.js';
import type { IConfig } from '../../types.js';
import type { AclMode } from '../acl/ACLService.js';
import { EVENTS_BACKGROUND_PERMISSION } from './authorization.js';
import type { DeliveryEnvelope } from './EventsService.js';
import { fsAnchorToken } from './subjects.js';

const BOOT_TIMEOUT_MS = 120_000;
const TABLE = 'event_subscriptions';

let env: PuterTestEnv;
let owner: { actor: Actor; username: string; id: number };
let guest: { actor: Actor; username: string; id: number };
let delivered: DeliveryEnvelope[];

const events = () => env.server.services.events;
const fs = () => env.server.services.fs;

const descriptor = (path: string) => ({
    path,
    resolveAncestors: () => fs().getAncestorChain(path),
});

const folder = async (path: string): Promise<string> => {
    await fs().mkdir(owner.id, { path, createMissingParents: true });
    return path;
};

const share = (path: string, mode: AclMode): Promise<unknown> =>
    env.server.services.acl.setUserUser(
        owner.actor,
        guest.actor,
        descriptor(path),
        mode,
    );

const unshare = async (path: string, mode: AclMode): Promise<void> => {
    const entry = await env.server.stores.fsEntry.getEntryByPath(path);
    await env.server.services.permission.revokeUserUserPermission(
        owner.actor,
        guest.username,
        `fs:${entry!.uid}:${mode}`,
    );
};

/**
 * The real user-facing surface: `ShareService`, not the ACL/permission layer
 * it settles on top of. What the settle mechanism actually has to survive is
 * everything this service does around the grant — index-row bookkeeping,
 * authorization, delegate resolution — not just the grant itself.
 */
const shareViaService = (
    path: string,
    recipientUsername: string,
    mode: AclMode,
) =>
    runWithContext({ actor: owner.actor }, () =>
        env.server.services.share.share(owner.actor, {
            path,
            recipient: { username: recipientUsername },
            mode,
        }),
    );

const unshareViaService = (path: string, recipientUsername: string) =>
    runWithContext({ actor: owner.actor }, () =>
        env.server.services.share.unshare(owner.actor, {
            path,
            recipient: { username: recipientUsername },
        }),
    );

/** A second guest, for proving a revoke settles only the holder it named. */
const makeGuest = async (): Promise<{
    actor: Actor;
    username: string;
    id: number;
}> => {
    const username = `settle-guest-${uuidv4().slice(0, 8)}`;
    await createTestUser(env.server, { username, password: 'pw-test-1234' });
    const row = await env.server.stores.user.getByUsername(username);
    return {
        actor: makeActor({ user: row as never }),
        username,
        id: row!.id,
    };
};

const uidOf = async (path: string): Promise<string> => {
    const entry = await env.server.stores.fsEntry.getEntryByPath(path);
    return entry!.uid;
};

const write = (path: string): Promise<unknown> =>
    fs().touch(owner.id, { path });

const uniquePath = (base: string) =>
    `${base}/n-${Math.random().toString(36).slice(2, 8)}`;

const settled = (count = 1) =>
    vi.waitFor(() => expect(delivered.length).toBeGreaterThanOrEqual(count), {
        timeout: EVENTS_COALESCE_WINDOW_MS * 12,
        interval: 25,
    });

const quiet = () =>
    new Promise((resolve) =>
        setTimeout(resolve, EVENTS_COALESCE_WINDOW_MS * 3),
    );

const rowOf = async (
    subId: string,
): Promise<{ suspended_at: unknown; suspended_reason: unknown }> => {
    const [row] = await env.server.clients.db.pread(
        `SELECT \`suspended_at\`, \`suspended_reason\` FROM \`${TABLE}\` WHERE \`sub_id\` = ?`,
        [subId],
    );
    return row as { suspended_at: unknown; suspended_reason: unknown };
};

/** Wait for the settle the revoke kicked off on the bus to land. */
const endedNotifications = async (
    userId: number,
): Promise<Array<{ value: unknown }>> =>
    (await env.server.stores.notification.listByUserId(userId, {})).filter(
        (row: { type?: string }) => row.type === 'app.events.ended',
    ) as Array<{ value: unknown }>;

const suspendedRow = (subId: string) =>
    vi.waitFor(
        async () => {
            const row = await rowOf(subId);
            expect(row?.suspended_reason).toBe('permission_revoked');
        },
        { timeout: 5_000, interval: 25 },
    );

/** Whether `path`'s anchor token is watched in its own owner's keyspace. */
const watches = async (
    path: string,
    ownerUserId: number = owner.id,
): Promise<boolean> => {
    const watched = await env.server.stores.eventSubscription.watchedTokens(
        ownerUserId,
        [fsAnchorToken(await uidOf(path))],
    );
    return watched.length > 0;
};

/** An app of the owner's, granted `list` on one folder. */
const makeApp = async (path: string): Promise<Actor> => {
    const uid = `app-${uuidv4()}`;
    await env.server.clients.db.write(
        'INSERT INTO `apps` (`uid`, `name`, `title`, `index_url`, `owner_user_id`) VALUES (?, ?, ?, ?, ?)',
        [uid, uid, uid, `https://${uid}.example/`, owner.id],
    );
    await env.server.services.permission.grantUserAppPermission(
        owner.actor,
        uid,
        `fs:${await uidOf(path)}:list`,
    );
    // Durable rows target the app's worker by default, which takes its own
    // consent.
    await env.server.services.permission.grantUserAppPermission(
        owner.actor,
        uid,
        EVENTS_BACKGROUND_PERMISSION,
    );
    const app = await env.server.stores.app.getByUid(uid);
    return makeActor({
        user: owner.actor.user as never,
        app: { uid, id: app!.id },
    });
};

const clearRows = async () => {
    await env.server.clients.db.write(`DELETE FROM \`${TABLE}\``, []);
    for (const id of [owner.id, guest.id]) {
        events().invalidateUser(id);
        await env.server.stores.eventSubscription.markRegionCold(id);
        await env.server.stores.durableSubscription.warmRegion(id);
    }
    delivered.length = 0;
};

beforeAll(async () => {
    env = await setupPuterTestEnv({
        events: { enabled: true },
        // Seeded accounts carry no email, which the plan machinery reads as a
        // temporary account — and a temporary account holds no durable rows.
        // Plans are not what these cases are about.
        unlimitedMetering: true,
    } as IConfig);

    const ownerRow = await env.server.stores.user.getByUsername(
        env.users.user.username,
    );
    const guestRow = await env.server.stores.user.getByUsername(
        env.users.other.username,
    );
    owner = {
        actor: makeActor({ user: ownerRow as never }),
        username: env.users.user.username,
        id: ownerRow!.id,
    };
    guest = {
        actor: makeActor({ user: guestRow as never }),
        username: env.users.other.username,
        id: guestRow!.id,
    };

    delivered = [];
    events().onDelivered = (envelope) => delivered.push(envelope);
}, BOOT_TIMEOUT_MS);

afterAll(async () => {
    await env?.shutdown();
});

describe('the delivery re-check on its own', () => {
    it('stops a session subscription, and meters nothing, without any settle', async () => {
        await clearRows();
        const path = await folder(`/${owner.username}/backstop-session`);
        await share(path, 'list');
        const sub = (
            await events().subscribe(guest.actor, 'guest-backstop', {
                subject: `fs:${path}`,
            })
        ).sub;

        await write(uniquePath(path));
        await settled();
        expect(delivered.map((d) => d.subId)).toEqual([sub.subId]);

        await unshare(path, 'list');
        delivered.length = 0;

        await write(uniquePath(path));
        await quiet();

        // Nothing reached a subscriber, so the seam metering hangs off saw
        // nothing either — and the row is still exactly where it was, which is
        // what makes this the backstop working alone.
        expect(delivered).toEqual([]);
        const held = await env.server.stores.eventSubscription.listForSocket(
            guest.id,
            'guest-backstop',
        );
        expect(held.map((row) => row.subId)).toEqual([sub.subId]);
    });

    it('answers from cache until the permission generation moves', async () => {
        await clearRows();
        const path = await folder(`/${owner.username}/backstop-cache`);
        await share(path, 'list');
        await events().subscribe(guest.actor, 'guest-cache', {
            subject: `fs:${path}`,
        });

        // Only the guest's own re-check counts: the owner's write is checked
        // as the owner, on its own path into ACL.
        const acl = env.server.services.acl;
        const passThrough = acl.check.bind(acl);
        let checks = 0;
        const spy = vi
            .spyOn(acl, 'check')
            .mockImplementation(async (actor, resource, mode) => {
                if (actor?.user?.id === guest.id) checks++;
                return passThrough(actor, resource, mode);
            });

        // Renames keep the uid, so these are several events about one node —
        // which is what the cache is keyed by, alongside the generation.
        const probe = await fs().touch(owner.id, {
            path: `${path}/probe.txt`,
        });
        try {
            await settled();
            expect(checks).toBe(1);

            delivered.length = 0;
            checks = 0;
            await fs().rename(owner.id, probe, 'probe-again.txt');
            await settled();
            expect(checks).toBe(0);

            // The revoke bumps the permission generation, which is the key the
            // cached answer was filed under.
            await unshare(path, 'list');
            delivered.length = 0;
            checks = 0;
            const renamed = await env.server.stores.fsEntry.getEntryByUuid(
                probe.uuid,
            );
            await fs().rename(owner.id, renamed!, 'probe-once-more.txt');
            await quiet();

            expect(checks).toBe(1);
            expect(delivered).toEqual([]);
        } finally {
            spy.mockRestore();
        }
    });
});

describe('what a revoked grant settles', () => {
    it('suspends the durable rows it was holding up and purges their backlog', async () => {
        await clearRows();
        const path = await folder(`/${owner.username}/settle-durable`);
        await share(path, 'list');
        const sub = (
            await events().subscribeDurable(guest.actor, {
                subject: `fs:${path}`,
                delivery: 'single',
                handlerName: 'onChange',
            })
        ).sub;

        await write(uniquePath(path));
        await vi.waitFor(
            async () =>
                expect(
                    await env.server.stores.pendingDelivery.depth(sub.subId),
                ).toBeGreaterThan(0),
            { timeout: 5_000, interval: 25 },
        );
        expect(await watches(path)).toBe(true);

        await unshare(path, 'list');
        await suspendedRow(sub.subId);

        expect(await watches(path)).toBe(false);
        // A revoked backlog names paths its holder just lost the right to see.
        expect(await env.server.stores.pendingDelivery.depth(sub.subId)).toBe(
            0,
        );

        delivered.length = 0;
        await write(uniquePath(path));
        await quiet();
        expect(delivered).toEqual([]);
    });

    it('tells the holder their subscription ended, and why', async () => {
        await clearRows();
        const path = await folder(`/${owner.username}/settle-notified`);
        await share(path, 'list');
        const sub = (
            await events().subscribeDurable(guest.actor, {
                subject: `fs:${path}`,
            })
        ).sub;

        await unshare(path, 'list');
        await suspendedRow(sub.subId);

        const ended = await vi.waitFor(
            async () => {
                const rows = await env.server.stores.notification.listByUserId(
                    guest.id,
                    {},
                );
                const match = rows.find(
                    (row: { type?: string }) =>
                        row.type === 'app.events.ended',
                );
                expect(match).toBeDefined();
                return match as { audience: string; value: unknown };
            },
            { timeout: 5_000, interval: 25 },
        );

        expect(ended.audience).toBe('app-user');
        expect(ended.value).toMatchObject({
            subject: `fs:${path}`,
            reason: 'permission_revoked',
        });
    });

    it('leaves a share whose mode only changed exactly where it was', async () => {
        await clearRows();
        const path = await folder(`/${owner.username}/settle-upgraded`);
        await share(path, 'list');
        const sub = (
            await events().subscribeDurable(guest.actor, {
                subject: `fs:${path}`,
            })
        ).sub;

        // Widening a share is stored as a grant plus a revoke of the mode it
        // replaces; settling on the revoke alone would end a subscription
        // whose reach just grew.
        await share(path, 'write');
        await quiet();

        expect((await rowOf(sub.subId)).suspended_at).toBeFalsy();
        delivered.length = 0;
        await write(uniquePath(path));
        await settled();
        expect(delivered.map((d) => d.subId)).toEqual([sub.subId]);
    });

    it('does not resume on a re-grant, and a fresh subscribe still works', async () => {
        await clearRows();
        const path = await folder(`/${owner.username}/settle-regrant`);
        await share(path, 'list');
        const stale = (
            await events().subscribeDurable(guest.actor, {
                subject: `fs:${path}`,
            })
        ).sub;

        await unshare(path, 'list');
        await suspendedRow(stale.subId);

        await share(path, 'list');
        delivered.length = 0;
        await write(uniquePath(path));
        await quiet();
        expect(delivered).toEqual([]);

        const fresh = (
            await events().subscribeDurable(guest.actor, {
                subject: `fs:${path}`,
            })
        ).sub;
        delivered.length = 0;
        await write(uniquePath(path));
        await settled();
        expect(delivered.map((d) => d.subId)).toEqual([fresh.subId]);
    });

    it('settles everything an app holds when its access is withdrawn wholesale', async () => {
        await clearRows();
        const one = await folder(`/${owner.username}/settle-app-one`);
        const two = await folder(`/${owner.username}/settle-app-two`);
        const appActor = await makeApp(one);
        await env.server.services.permission.grantUserAppPermission(
            owner.actor,
            appActor.app!.uid,
            `fs:${await uidOf(two)}:list`,
        );

        const held = [
            (await events().subscribeDurable(appActor, { subject: `fs:${one}` }))
                .sub,
            (await events().subscribeDurable(appActor, { subject: `fs:${two}` }))
                .sub,
        ];

        await env.server.services.permission.revokeUserAppAll(
            owner.actor,
            appActor.app!.uid,
        );

        for (const sub of held) await suspendedRow(sub.subId);
        expect(await watches(one)).toBe(false);
        expect(await watches(two)).toBe(false);
    });

    it('settles a subscription when the owner unshares through ShareService', async () => {
        await clearRows();
        const path = await folder(`/${owner.username}/settle-share-service`);
        await shareViaService(path, guest.username, 'list');
        const sub = (
            await events().subscribeDurable(guest.actor, {
                subject: `fs:${path}`,
            })
        ).sub;

        await unshareViaService(path, guest.username);
        await suspendedRow(sub.subId);

        expect(await watches(path)).toBe(false);
        delivered.length = 0;
        await write(uniquePath(path));
        await quiet();
        expect(delivered).toEqual([]);
    });

    it('settles what background consent allowed, and leaves the rest running', async () => {
        await clearRows();
        const path = await folder(`/${owner.username}/settle-background`);
        const appActor = await makeApp(path);

        const background = (
            await events().subscribeDurable(appActor, { subject: `fs:${path}` })
        ).sub;
        // Delivered to a connection and nowhere else, so the consent that just
        // went was never what allowed it.
        const foreground = (
            await events().subscribeDurable(appActor, {
                subject: `fs:${path}`,
                targets: ['socket'],
            })
        ).sub;

        await env.server.services.permission.revokeUserAppPermission(
            owner.actor,
            appActor.app!.uid,
            EVENTS_BACKGROUND_PERMISSION,
        );

        await suspendedRow(background.subId);
        expect((await rowOf(foreground.subId)).suspended_at).toBeFalsy();
    });

    it('settles a subscription when one app permission is revoked, not just all of them', async () => {
        await clearRows();
        const path = await folder(`/${owner.username}/settle-app-single`);
        const appActor = await makeApp(path);
        const sub = (
            await events().subscribeDurable(appActor, { subject: `fs:${path}` })
        ).sub;

        await env.server.services.permission.revokeUserAppPermission(
            owner.actor,
            appActor.app!.uid,
            `fs:${await uidOf(path)}:list`,
        );
        await suspendedRow(sub.subId);

        expect(await watches(path)).toBe(false);
    });

    it('leaves another holder, and an unrelated anchor, out of a revoke', async () => {
        await clearRows();
        const shared = await folder(`/${owner.username}/settle-scope-shared`);
        const otherGuest = await makeGuest();

        await share(shared, 'list');
        const guestSub = (
            await events().subscribeDurable(guest.actor, {
                subject: `fs:${shared}`,
            })
        ).sub;

        await env.server.services.acl.setUserUser(
            owner.actor,
            otherGuest.actor,
            descriptor(shared),
            'list',
        );
        const otherSub = (
            await events().subscribeDurable(otherGuest.actor, {
                subject: `fs:${shared}`,
            })
        ).sub;

        // The guest's own folder has nothing to do with the share about to be
        // revoked — a different anchor, held by the same user. Made as the
        // guest, not `owner`: `folder()` is bound to owner.id, and this path
        // is outside owner's tree.
        const own = `/${guest.username}/settle-scope-own`;
        await fs().mkdir(guest.id, { path: own, createMissingParents: true });
        const ownSub = (
            await events().subscribeDurable(guest.actor, { subject: `fs:${own}` })
        ).sub;

        await unshare(shared, 'list');
        await suspendedRow(guestSub.subId);

        expect((await rowOf(otherSub.subId)).suspended_at).toBeFalsy();
        expect((await rowOf(ownSub.subId)).suspended_at).toBeFalsy();
        // `own` is anchored in the guest's own keyspace, not the owner's.
        expect(await watches(own, guest.id)).toBe(true);
    });

    it('reaps a row that has been suspended past the retention window', async () => {
        await clearRows();
        const path = await folder(`/${owner.username}/settle-reaped`);
        await share(path, 'list');
        const sub = (
            await events().subscribeDurable(guest.actor, {
                subject: `fs:${path}`,
            })
        ).sub;

        await unshare(path, 'list');
        await suspendedRow(sub.subId);

        // Still there the day it is suspended — that is how its holder finds
        // out what happened.
        expect(await events().sweepSuspended()).toBe(0);
        expect(await rowOf(sub.subId)).toBeDefined();

        const aged =
            Math.floor(Date.now() / 1000) -
            (SUSPENDED_ROW_TTL_DAYS + 1) * 24 * 60 * 60;
        await env.server.clients.db.write(
            `UPDATE \`${TABLE}\` SET \`suspended_at\` = ? WHERE \`sub_id\` = ?`,
            [aged, sub.subId],
        );

        expect(await events().sweepSuspended()).toBe(1);
        expect(await rowOf(sub.subId)).toBeUndefined();
    });

    it('tells an app holder once when its access is withdrawn wholesale', async () => {
        await clearRows();
        const one = await folder(`/${owner.username}/settle-once-one`);
        const two = await folder(`/${owner.username}/settle-once-two`);
        const appActor = await makeApp(one);
        await env.server.services.permission.grantUserAppPermission(
            owner.actor,
            appActor.app!.uid,
            `fs:${await uidOf(two)}:list`,
        );
        const held = [
            (await events().subscribeDurable(appActor, { subject: `fs:${one}` }))
                .sub,
            (await events().subscribeDurable(appActor, { subject: `fs:${two}` }))
                .sub,
        ];
        const before = (await endedNotifications(owner.id)).length;

        await env.server.services.permission.revokeUserAppAll(
            owner.actor,
            appActor.app!.uid,
        );
        for (const sub of held) await suspendedRow(sub.subId);
        await quiet();

        const ended = await endedNotifications(owner.id);
        expect(ended).toHaveLength(before + 1);
        expect(ended[0].value).toMatchObject({
            count: 2,
            reason: 'permission_revoked',
        });
        expect(
            (ended[0].value as { subjects: string[] }).subjects.sort(),
        ).toEqual([`fs:${one}`, `fs:${two}`].sort());
    });

    it('settles a row once however many times the same withdrawal is heard', async () => {
        await clearRows();
        const path = await folder(`/${owner.username}/settle-twice`);
        await share(path, 'list');
        const sub = (
            await events().subscribeDurable(guest.actor, {
                subject: `fs:${path}`,
            })
        ).sub;
        const before = (await endedNotifications(guest.id)).length;
        const revocation = {
            holderUserId: guest.id,
            appUid: null,
            permission: `fs:${await uidOf(path)}:list`,
        };

        // The unshare announces once on its own; two more passes race it.
        await unshare(path, 'list');
        const settled = await Promise.all([
            events().settleRevokedGrant(revocation),
            events().settleRevokedGrant(revocation),
        ]);
        await suspendedRow(sub.subId);
        await quiet();

        expect(settled.reduce((sum, n) => sum + n, 0)).toBeLessThanOrEqual(1);
        expect(await endedNotifications(guest.id)).toHaveLength(before + 1);
    });

    it('never fails the revoke when the settle listener throws', async () => {
        await clearRows();
        const path = await folder(`/${owner.username}/settle-listener-throws`);
        await share(path, 'list');

        const boom = vi
            .spyOn(events(), 'settleRevokedGrant')
            .mockRejectedValueOnce(new Error('settle boom'));
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            // The revoke itself — not just the announce — has to come back
            // clean even though the thing listening for it just failed.
            await expect(unshare(path, 'list')).resolves.toBeUndefined();
            await vi.waitFor(() => expect(boom).toHaveBeenCalled(), {
                timeout: 5_000,
                interval: 25,
            });
        } finally {
            boom.mockRestore();
            warn.mockRestore();
        }
    });
});
