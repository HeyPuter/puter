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
 * KV subjects against the real write path.
 *
 * The unit suite drives `dispatchKv` directly; this pins what only the wiring
 * can get wrong — whether a `kv.set` through the driver reaches a subscriber at
 * all, whether a durable KV row survives the region cache being rebuilt, and
 * whether the cross-app gate settles when the grant behind it goes.
 */

import { v4 as uuidv4 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { EVENTS_COALESCE_WINDOW_MS } from '../../controllers/events/limits.js';
import { runWithContext } from '../../core/context.js';
import { setupPuterTestEnv, type PuterTestEnv } from '../../testUtil.js';
import type { IConfig } from '../../types.js';
import { appDataPermission } from '../permission/appDataScopes.js';
import { EVENTS_BACKGROUND_PERMISSION } from './authorization.js';
import type { DeliveryEnvelope } from './EventsService.js';

const BOOT_TIMEOUT_MS = 120_000;
const SOCKET_ID = 'kv-integration-socket';
const TABLE = 'event_subscriptions';

let env: PuterTestEnv;
let userId: number;
let ownAppUid: string;
let ownAppToken: string;
let otherAppUid: string;
let delivered: DeliveryEnvelope[];

const events = () => env.server.services.events;

const settle = () =>
    vi.waitFor(() => expect(delivered.length).toBeGreaterThan(0), {
        timeout: EVENTS_COALESCE_WINDOW_MS * 12,
        interval: 25,
    });

const quiet = () =>
    new Promise((resolve) => setTimeout(resolve, EVENTS_COALESCE_WINDOW_MS * 3));

/** An app owned by the test user, registered the way the app store sees one. */
const makeApp = async (metadata?: object): Promise<string> => {
    const uid = `app-${uuidv4()}`;
    await env.server.clients.db.write(
        'INSERT INTO `apps` (`uid`, `name`, `title`, `index_url`, `owner_user_id`, `metadata`) VALUES (?, ?, ?, ?, ?, ?)',
        [
            uid,
            uid,
            uid,
            `https://${uid}.example/`,
            userId,
            metadata ? JSON.stringify(metadata) : null,
        ],
    );
    return uid;
};

const actorFor = async (token: string) =>
    (await env.server.services.auth.authenticate(token)).actor!;

/** Flip an app's data sharing off, cache included. */
const stopSharing = async (uid: string): Promise<void> => {
    await env.server.clients.db.write(
        'UPDATE `apps` SET `metadata` = ? WHERE `uid` = ?',
        [JSON.stringify({ share_app_data: false }), uid],
    );
    await env.server.stores.app.invalidateByUid(uid);
};

/** `kv.set` as a caller makes it: through the driver, as this app. */
const kvSet = async (
    token: string,
    key: string,
    value: unknown,
    optConfig?: object,
): Promise<void> => {
    const actor = await actorFor(token);
    await runWithContext({ actor }, () =>
        env.server.drivers.kvStore.set({
            key,
            value,
            ...(optConfig ? { optConfig } : {}),
        }),
    );
};

const subscribe = async (subject: string, token: string) => {
    const actor = await actorFor(token);
    return (await events().subscribe(actor, SOCKET_ID, { subject })).sub;
};

const subscribeDurable = async (subject: string, token: string) => {
    const actor = await actorFor(token);
    return (await events().subscribeDurable(actor, { subject })).sub;
};

const clearRows = async () => {
    await env.server.clients.db.write(`DELETE FROM \`${TABLE}\``, []);
    events().invalidateUser(userId);
    await env.server.stores.eventSubscription.markRegionCold(userId);
    await env.server.stores.durableSubscription.warmRegion(userId);
};

beforeAll(async () => {
    env = await setupPuterTestEnv({
        events: { enabled: true, crossAppKv: true },
        // Seeded accounts carry no email, which the plan machinery reads as a
        // temporary account — and a temporary account holds no durable rows.
        unlimitedMetering: true,
    } as IConfig);
    const user = await env.server.stores.user.getByUsername(
        env.users.user.username,
    );
    userId = user!.id;

    const userActor = await actorFor(env.users.user.token);
    ownAppUid = await makeApp();
    otherAppUid = await makeApp();
    ownAppToken = await env.server.services.auth.getUserAppToken(
        userActor,
        ownAppUid,
    );
    // Durable rows target the app's worker by default, which takes its own
    // consent.
    await env.server.services.permission.grantUserAppPermission(
        userActor,
        ownAppUid,
        EVENTS_BACKGROUND_PERMISSION,
    );

    delivered = [];
    events().onDelivered = (envelope) => delivered.push(envelope);
}, BOOT_TIMEOUT_MS);

afterAll(async () => {
    await env?.shutdown();
});

describe('a kv write reaches its subscribers', () => {
    it('delivers a write to the app`s own namespace', async () => {
        const sub = await subscribe(`kv:${ownAppUid}:cart:*`, ownAppToken);
        delivered.length = 0;

        await kvSet(ownAppToken, 'cart:items', [1, 2]);
        await settle();

        expect(delivered).toHaveLength(1);
        expect(delivered[0].subId).toBe(sub.subId);
        expect(delivered[0].event).toMatchObject({
            subject: `kv:${ownAppUid}:cart:items`,
            op: 'set',
            key: 'cart:items',
        });
    });

    it('leaves a key outside the prefix alone', async () => {
        await subscribe(`kv:${ownAppUid}:cart:*`, ownAppToken);
        delivered.length = 0;

        await kvSet(ownAppToken, 'basket:items', [1]);
        await quiet();

        expect(delivered).toEqual([]);
    });

    it('keys the watched set on the namespace`s user', async () => {
        const anchor = await subscribe(`kv:${ownAppUid}:cart`, ownAppToken);
        expect(anchor.anchor).toEqual({ uid: ownAppUid, path: 'cart' });

        const user = await env.server.stores.user.getById(userId);
        await expect(
            env.server.stores.eventSubscription.watchedTokens(userId, [
                `k#${user!.uuid}#${ownAppUid}#cart`,
            ]),
        ).resolves.toHaveLength(1);
    });
});

describe('a durable kv subscription', () => {
    it('survives the region cache being rebuilt from the table', async () => {
        await clearRows();
        const sub = await subscribeDurable(
            `kv:${ownAppUid}:orders:*`,
            ownAppToken,
        );

        // Forget everything this region knows, so the next dispatch has to
        // rebuild the row from the table and re-derive its owner.
        events().invalidateUser(userId);
        await env.server.stores.eventSubscription.markRegionCold(userId);
        await env.server.clients.redis.del(`ev:w:{${userId}}`);
        delivered.length = 0;

        await kvSet(ownAppToken, 'orders:1', { total: 3 });
        await settle();

        expect(delivered[0].subId).toBe(sub.subId);
        expect(delivered[0].event).toMatchObject({ key: 'orders:1' });
    });

    it('lists back the fully-qualified subject it stored', async () => {
        await clearRows();
        await subscribeDurable('kv:profile', ownAppToken);

        const page = await events().listDurable(await actorFor(ownAppToken));
        expect(page.items).toHaveLength(1);
        expect(page.items[0].subject).toBe(`kv:${ownAppUid}:profile`);
    });
});

describe('the cross-app gate against real grants', () => {
    const grantRead = async (targetAppUid: string) => {
        const userActor = await actorFor(env.users.user.token);
        await env.server.services.permission.grantUserAppPermission(
            userActor,
            ownAppUid,
            appDataPermission(targetAppUid, 'kv', 'read'),
        );
    };

    const revokeRead = async (targetAppUid: string) => {
        const userActor = await actorFor(env.users.user.token);
        await env.server.services.permission.revokeUserAppPermission(
            userActor,
            ownAppUid,
            appDataPermission(targetAppUid, 'kv', 'read'),
        );
    };

    it('refuses a namespace the user never granted', async () => {
        await expect(
            subscribe(`kv:${otherAppUid}:cart`, ownAppToken),
        ).rejects.toMatchObject({ legacyCode: 'forbidden' });
    });

    it('delivers once the grant is in place', async () => {
        await clearRows();
        await grantRead(otherAppUid);
        const sub = await subscribe(`kv:${otherAppUid}:cart:*`, ownAppToken);
        delivered.length = 0;

        // Written into the other app's namespace by the same user, which is
        // what a cross-app subscription is watching.
        await kvSet(env.users.user.token, 'cart:items', [7], {
            appUuid: otherAppUid,
        });
        await settle();

        expect(delivered[0].subId).toBe(sub.subId);
        await revokeRead(otherAppUid);
    });

    it('settles a durable row when the grant is withdrawn', async () => {
        await clearRows();
        await grantRead(otherAppUid);
        const sub = await subscribeDurable(
            `kv:${otherAppUid}:cart:*`,
            ownAppToken,
        );

        await revokeRead(otherAppUid);
        await vi.waitFor(
            async () => {
                const row =
                    await env.server.stores.durableSubscription.getBySubId(
                        sub.subId,
                    );
                expect(row?.suspendedReason).toBe('permission_revoked');
            },
            { timeout: 5000, interval: 50 },
        );

        delivered.length = 0;
        await kvSet(env.users.user.token, 'cart:items', [8], {
            appUuid: otherAppUid,
        });
        await quiet();
        expect(delivered).toEqual([]);
    });

    it('stops an existing row when the target stops sharing its data', async () => {
        await clearRows();
        const closedAppUid = await makeApp();
        await grantRead(closedAppUid);
        await subscribe(`kv:${closedAppUid}:cart:*`, ownAppToken);

        await stopSharing(closedAppUid);
        delivered.length = 0;

        await kvSet(env.users.user.token, 'cart:items', [9], {
            appUuid: closedAppUid,
        });
        await quiet();
        expect(delivered).toEqual([]);

        // And nothing new may be made against it either.
        await expect(
            subscribe(`kv:${closedAppUid}:orders`, ownAppToken),
        ).rejects.toMatchObject({ legacyCode: 'forbidden' });
        await revokeRead(closedAppUid);
    });
});

describe('the writer never pays for the subscriber', () => {
    it('completes the write when the dispatcher throws', async () => {
        const dispatch = vi
            .spyOn(events(), 'dispatchKv')
            .mockImplementation(() => {
                throw new Error('dispatcher is down');
            });

        try {
            await expect(
                kvSet(ownAppToken, 'still-written', 1),
            ).resolves.toBeUndefined();
        } finally {
            dispatch.mockRestore();
        }
    });
});
