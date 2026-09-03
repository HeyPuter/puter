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
 * Durable subscriptions end to end: the routes that create and revoke them, who
 * each credential shape may see, and what a write costs once one exists.
 *
 * The cost assertions are the point of the whole cache. A subscription made
 * here is deliverable here without the table, and a region that has never seen
 * the user pays for the table exactly once.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import {
    EVENTS_COALESCE_WINDOW_MS,
    EVENTS_DURABLE_SUBSCRIPTIONS_PER_APP,
    EVENTS_SUBSCRIBE_LIMIT,
} from '../../controllers/events/limits.js';
import { DEFAULT_FREE_SUBSCRIPTION } from '../metering/consts.js';
import { makeActor } from '../../core/actor.js';
import { setupPuterTestEnv, type PuterTestEnv } from '../../testUtil.js';
import type { IConfig } from '../../types.js';
import { appSocketRoom } from '../socket/SocketService.js';
import { EVENTS_BACKGROUND_PERMISSION } from './authorization.js';
import type { DeliveryEnvelope } from './EventsService.js';

const BOOT_TIMEOUT_MS = 120_000;
const TABLE = 'event_subscriptions';

let env: PuterTestEnv;
let userId: number;
let username: string;
let anchor: string;
let appOneUid: string;
let appOneToken: string;
let appTwoUid: string;
let appTwoToken: string;
let appOneAccessToken: string;
let delivered: DeliveryEnvelope[];

const events = () => env.server.services.events;
const fs = () => env.server.services.fs;

interface ApiResponse {
    status: number;
    body: Record<string, unknown>;
}

const call = async (
    method: 'GET' | 'POST',
    path: string,
    token: string,
    body?: object,
): Promise<ApiResponse> => {
    const response = await fetch(new URL(path, env.apiOrigin), {
        method,
        headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return {
        status: response.status,
        body: (await response.json()) as Record<string, unknown>,
    };
};

const subscribe = (token: string, body: object = {}): Promise<ApiResponse> =>
    call('POST', '/events/subscribe', token, { subject: `fs:${anchor}`, ...body });

const listSubscriptions = (
    token: string,
    query = '',
): Promise<ApiResponse> =>
    call('GET', `/events/subscriptions${query}`, token);

const unsubscribe = (token: string, subId: string): Promise<ApiResponse> =>
    call('POST', '/events/unsubscribe', token, { subId });

const subIdsOf = (response: ApiResponse): string[] =>
    (response.body.items as Array<{ subId: string }>).map((row) => row.subId);

/**
 * An app the user has granted `list` on the shared anchor, and consent to run
 * its handler in the background — which durable rows target by default.
 */
const makeApp = async (
    options: { background?: boolean } = {},
): Promise<{ uid: string; token: string }> => {
    const uid = `app-${uuidv4()}`;
    await env.server.clients.db.write(
        'INSERT INTO `apps` (`uid`, `name`, `title`, `index_url`, `owner_user_id`) VALUES (?, ?, ?, ?, ?)',
        [uid, uid, uid, `https://${uid}.example/`, userId],
    );
    const entry = await env.server.stores.fsEntry.getEntryByPath(anchor);
    const actor = await env.server.services.auth.authenticate(
        env.users.user.token,
    );
    await env.server.services.permission.grantUserAppPermission(
        actor.actor!,
        uid,
        `fs:${entry!.uid}:list`,
    );
    if (options.background !== false)
        await env.server.services.permission.grantUserAppPermission(
            actor.actor!,
            uid,
            EVENTS_BACKGROUND_PERMISSION,
        );
    return {
        uid,
        token: await env.server.services.auth.getUserAppToken(actor.actor!, uid),
    };
};

/**
 * Table reads the block performed, counted where the driver sees them. On a
 * single-node engine `pread` is `read`, so one query would otherwise be counted
 * at both — the guard makes the count the number of statements, not of frames.
 */
const countTableReads = async (run: () => Promise<void>): Promise<number> => {
    const db = env.server.clients.db;
    const passThroughRead = db.read.bind(db);
    const passThroughPread = db.pread.bind(db);
    let reads = 0;
    let insidePread = false;

    const pread = vi.spyOn(db, 'pread').mockImplementation(async (q, p) => {
        if (q.includes(TABLE)) reads++;
        insidePread = true;
        try {
            return await passThroughPread(q, p);
        } finally {
            insidePread = false;
        }
    });
    const read = vi.spyOn(db, 'read').mockImplementation(async (q, p) => {
        if (q.includes(TABLE) && !insidePread) reads++;
        return passThroughRead(q, p);
    });
    try {
        await run();
        return reads;
    } finally {
        read.mockRestore();
        pread.mockRestore();
    }
};

// The coalesce window runs on real time, so a delivery from one test can land
// after the next has begun. Every wait names the path it is waiting for.
const pathOf = (envelope: DeliveryEnvelope): string =>
    (envelope.event as { path?: string }).path ?? '';
const deliveryOf = (path: string) =>
    delivered.find((envelope) => pathOf(envelope) === path);
const settle = (path: string) =>
    vi.waitFor(() => expect(deliveryOf(path)).toBeDefined(), {
        timeout: EVENTS_COALESCE_WINDOW_MS * 12,
        interval: 25,
    });

const quiet = () =>
    new Promise((resolve) =>
        setTimeout(resolve, EVENTS_COALESCE_WINDOW_MS * 3),
    );

beforeAll(async () => {
    env = await setupPuterTestEnv({
        events: { enabled: true },
        // Seeded accounts carry no email, which the plan machinery reads as a
        // temporary account — and a temporary account holds no durable rows.
        // Plans are not what these cases are about.
        unlimitedMetering: true,
    } as IConfig);
    username = env.users.user.username;
    const user = await env.server.stores.user.getByUsername(username);
    userId = user!.id;

    anchor = `/${username}/durable`;
    await fs().mkdir(userId, { path: anchor, createMissingParents: true });

    ({ uid: appOneUid, token: appOneToken } = await makeApp());
    ({ uid: appTwoUid, token: appTwoToken } = await makeApp());

    const appActor = await env.server.services.auth.authenticate(appOneToken);
    const entry = await env.server.stores.fsEntry.getEntryByPath(anchor);
    appOneAccessToken = await env.server.services.auth.createAccessToken(
        appActor.actor!,
        [[`fs:${entry!.uid}:list`]],
        { label: 'durable' },
    );

    delivered = [];
    events().onDelivered = (envelope) => delivered.push(envelope);
}, BOOT_TIMEOUT_MS);

afterAll(async () => {
    await env?.shutdown();
});

/**
 * Start each case from a known state on both layers: no rows, this process
 * holding no answer, and the region rebuilt from the now-empty table so it is
 * warm and correct rather than merely empty.
 */
const clearRows = async () => {
    await env.server.clients.db.write(`DELETE FROM \`${TABLE}\``, []);
    events().invalidateUser(userId);
    await env.server.stores.eventSubscription.markRegionCold(userId);
    await env.server.stores.durableSubscription.warmRegion(userId);
};

describe('creating a durable subscription over HTTP', () => {
    it('returns the row a client needs to revoke it later', async () => {
        await clearRows();
        const created = await subscribe(env.users.user.token);

        expect(created.status).toBe(200);
        expect(created.body).toMatchObject({
            subject: `fs:${anchor}`,
            delivery: 'broadcast',
            // No app, so no events worker to target — see the null-app
            // suite below.
            targets: ['socket'],
            appUid: null,
        });
        expect(created.body.context).toBeUndefined();
    });

    it('registers a subscription owed to one consumer', async () => {
        await clearRows();
        const created = await subscribe(env.users.user.token, {
            delivery: 'single',
            handlerName: 'onWrite',
        });

        expect(created.status).toBe(200);
        expect(created.body).toMatchObject({
            delivery: 'single',
            handlerName: 'onWrite',
            targets: ['socket'],
        });
    });

    it('refuses one owed to a consumer it cannot name', async () => {
        const refused = await subscribe(env.users.user.token, {
            delivery: 'single',
        });

        expect(refused.status).toBe(400);
        expect(refused.body.code).toBe('events_handler_required');
    });

    it('refuses one owed to a device notification', async () => {
        const refused = await subscribe(env.users.user.token, {
            delivery: 'single',
            handlerName: 'onWrite',
            targets: ['push'],
        });

        expect(refused.status).toBe(400);
        expect(refused.body.code).toBe('invalid_targets');
    });

    it('refuses a `worker` target from an account session naming no app', async () => {
        // Exactly one events worker per app: an account session has none, so
        // asking for the worker target explicitly is refused rather than
        // silently dropped — silently dropping it would leave the caller
        // thinking background delivery was configured when it never could be.
        const refused = await subscribe(env.users.user.token, {
            delivery: 'single',
            handlerName: 'onWrite',
            targets: ['socket', 'worker'],
        });

        expect(refused.status).toBe(400);
        expect(refused.body.code).toBe('invalid_targets');
    });

    it('refuses background delivery an app has no consent for', async () => {
        // An app of its own, so nothing it holds includes the consent.
        const { token } = await makeApp({ background: false });

        const refused = await call('POST', '/events/subscribe', token, {
            subject: `fs:${anchor}`,
            delivery: 'single',
            handlerName: 'onWrite',
            targets: ['worker'],
        });

        expect(refused.status).toBe(403);
        expect(refused.body.code).toBe('events_background_consent_required');
        // Refused before the handler is even looked up: consent comes first.
        expect(refused.body.message).toContain('events:background');
    });

    it('requires consent for the default targets an app row gets, even with none named', async () => {
        // An app of its own, so nothing it holds includes the consent.
        const { token } = await makeApp({ background: false });

        // No `targets` at all: an app row defaults to `['socket', 'worker']`,
        // and that default still needs the consent — the gate runs on the
        // resolved targets, not only on an explicit ask for `worker`.
        const refused = await call('POST', '/events/subscribe', token, {
            subject: `fs:${anchor}`,
        });

        expect(refused.status).toBe(403);
        expect(refused.body.code).toBe('events_background_consent_required');
    });

    it('needs no consent for a subscription only a connection hears', async () => {
        const { token } = await makeApp({ background: false });

        const created = await call('POST', '/events/subscribe', token, {
            subject: `fs:${anchor}`,
            targets: ['socket'],
        });

        expect(created.status).toBe(200);
        expect(created.body.targets).toEqual(['socket']);
    });

    it('refuses a target outside the known set', async () => {
        const refused = await subscribe(env.users.user.token, {
            targets: ['socket', 'carrier-pigeon'],
        });

        expect(refused.status).toBe(400);
        expect(refused.body.code).toBe('invalid_targets');
    });

    it('refuses an app`s `single` subscription with no worker to fall back to', async () => {
        const refused = await subscribe(appOneToken, {
            delivery: 'single',
            handlerName: 'onWrite',
            targets: ['socket'],
        });

        expect(refused.status).toBe(400);
        expect(refused.body.code).toBe('invalid_targets');
    });

    it('refuses an expiry in the past', async () => {
        const refused = await subscribe(env.users.user.token, {
            expiresAt: Math.floor(Date.now() / 1000) - 60,
        });

        expect(refused.status).toBe(400);
        expect(refused.body.code).toBe('invalid_expires_at');
    });

    it('answers a subject it cannot read as absent', async () => {
        const refused = await call('POST', '/events/subscribe', appOneToken, {
            subject: `fs:/${username}/not-granted`,
        });

        expect(refused.status).toBe(404);
        expect(refused.body.code).toBe('subject_does_not_exist');
    });
});

describe('what each credential sees and removes', () => {
    it('confines an app to its own rows and lets the account see across them', async () => {
        await clearRows();
        const mine = (await subscribe(appOneToken)).body.subId as string;
        const theirs = (await subscribe(appTwoToken)).body.subId as string;
        const account = (await subscribe(env.users.user.token)).body
            .subId as string;

        expect(subIdsOf(await listSubscriptions(appOneToken))).toEqual([mine]);
        expect(subIdsOf(await listSubscriptions(appTwoToken))).toEqual([
            theirs,
        ]);
        // An access token an app issued acts as that app, one hop through the
        // issuer — which is what the whole scope keys on.
        expect(subIdsOf(await listSubscriptions(appOneAccessToken))).toEqual([
            mine,
        ]);

        for (const wide of [env.users.user.token, env.users.user.apiToken])
            expect(subIdsOf(await listSubscriptions(wide)).sort()).toEqual(
                [mine, theirs, account].sort(),
            );
    });

    it('answers another app`s subscription id as absent', async () => {
        await clearRows();
        const mine = (await subscribe(appOneToken)).body.subId as string;

        const refused = await unsubscribe(appTwoToken, mine);
        expect(refused.status).toBe(404);
        expect(refused.body.code).toBe('subscription_does_not_exist');
        expect(subIdsOf(await listSubscriptions(appOneToken))).toEqual([mine]);
    });

    it('answers an id that never existed the same way', async () => {
        const refused = await unsubscribe(
            env.users.user.token,
            `${appOneUid}#${uuidv4()}`,
        );
        expect(refused.status).toBe(404);
        expect(refused.body.code).toBe('subscription_does_not_exist');
    });

    it('lets the account remove what an app left behind', async () => {
        await clearRows();
        const theirs = (await subscribe(appTwoToken)).body.subId as string;
        expect(appTwoUid).not.toBe(appOneUid);

        const removed = await unsubscribe(env.users.user.token, theirs);

        expect(removed.status).toBe(200);
        expect(subIdsOf(await listSubscriptions(env.users.user.token))).toEqual(
            [],
        );
    });

    it('pages the listing and totals the scope, not the page', async () => {
        await clearRows();
        for (let i = 0; i < 3; i++) await subscribe(env.users.user.token);

        const first = await listSubscriptions(
            env.users.user.token,
            '?limit=2&includeTotal=true',
        );
        expect(first.body.items).toHaveLength(2);
        expect(first.body.total).toBe(3);
        expect(first.body.cursor).toBeDefined();

        const second = await listSubscriptions(
            env.users.user.token,
            `?limit=2&cursor=${encodeURIComponent(String(first.body.cursor))}`,
        );
        expect(second.body.items).toHaveLength(1);
        expect(second.body.cursor).toBeUndefined();
        expect(second.body.total).toBeUndefined();
    });
});

describe('what a write costs once a durable row exists', () => {
    it('delivers straight after subscribe without reading the table', async () => {
        await clearRows();
        const created = await subscribe(env.users.user.token);
        delivered.length = 0;

        const path = `${anchor}/warm-${uuidv4().slice(0, 8)}.txt`;
        const reads = await countTableReads(async () => {
            await fs().touch(userId, { path });
            await settle(path);
        });

        expect(reads).toBe(0);
        expect(deliveryOf(path)?.subId).toBe(created.body.subId);
    });

    it('rebuilds a cold region from the table once, then stops reading it', async () => {
        await clearRows();
        const created = await subscribe(env.users.user.token);

        // A region that has never seen this user: nothing cached anywhere.
        // Targeted rather than `flushall`: this shares a Redis instance (and
        // an `ev:g` counter) with every other test in the process, and a
        // global flush would reset it out from under their own generation
        // bookkeeping too.
        await env.server.clients.redis.del(
            `ev:w:{${userId}}`,
            `ev:dw:{${userId}}`,
            `ev:dm:{${userId}}`,
        );
        events().invalidateUser(userId);
        delivered.length = 0;

        const coldPath = `${anchor}/cold-${uuidv4().slice(0, 8)}.txt`;
        const cold = await countTableReads(async () => {
            await fs().touch(userId, { path: coldPath });
            await settle(coldPath);
        });
        expect(cold).toBe(1);
        expect(deliveryOf(coldPath)?.subId).toBe(created.body.subId);

        const warmPath = `${anchor}/again-${uuidv4().slice(0, 8)}.txt`;
        const warm = await countTableReads(async () => {
            await fs().touch(userId, { path: warmPath });
            await settle(warmPath);
        });
        expect(warm).toBe(0);
    });

    it('evicts a row a peer region removed, once its bump arrives', async () => {
        await clearRows();
        const created = await subscribe(env.users.user.token);
        delivered.length = 0;
        const before = `${anchor}/pre-peer-${uuidv4().slice(0, 8)}.txt`;
        await fs().touch(userId, { path: before });
        await settle(before);
        expect(deliveryOf(before)?.subId).toBe(created.body.subId);

        // A peer region settling the row: the primary loses it, but this
        // region is never told directly — only the bump such a removal would
        // broadcast is simulated, over the real event bus rather than a
        // direct call into the store.
        await env.server.clients.db.write(
            `DELETE FROM \`${TABLE}\` WHERE \`sub_id\` = ?`,
            [created.body.subId],
        );
        const generation =
            await env.server.stores.eventSubscription.getGeneration(userId);
        delivered.length = 0;

        const after = `${anchor}/post-peer-${uuidv4().slice(0, 8)}.txt`;
        const reads = await countTableReads(async () => {
            await env.server.clients.event.emitAndWait(
                'outer.pubsub.events.generationBumped',
                { userId, generation: generation + 1, durable: true },
                { from_outside: true },
            );
            await fs().touch(userId, { path: after });
            await quiet();
        });

        expect(reads).toBe(1); // the bump alone forced exactly one rebuild
        expect(deliveryOf(after)).toBeUndefined();
    });

    it('does not re-read the table for a peer`s session bump', async () => {
        await clearRows();
        const created = await subscribe(env.users.user.token);
        const generation =
            await env.server.stores.eventSubscription.getGeneration(userId);
        delivered.length = 0;

        // A session subscribe in another region touches only that region's
        // Redis; the table this region cached from is unchanged.
        const path = `${anchor}/peer-session-${uuidv4().slice(0, 8)}.txt`;
        const reads = await countTableReads(async () => {
            await env.server.clients.event.emitAndWait(
                'outer.pubsub.events.generationBumped',
                { userId, generation: generation + 1, durable: false },
                { from_outside: true },
            );
            await fs().touch(userId, { path });
            await settle(path);
        });

        expect(reads).toBe(0);
        expect(deliveryOf(path)?.subId).toBe(created.body.subId);
    });

    it('stops delivering once the subscription is revoked', async () => {
        await clearRows();
        const created = await subscribe(env.users.user.token);
        await unsubscribe(env.users.user.token, created.body.subId as string);
        delivered.length = 0;

        const path = `${anchor}/revoked-${uuidv4().slice(0, 8)}.txt`;
        await fs().touch(userId, { path });
        await quiet();

        expect(deliveryOf(path)).toBeUndefined();
    });

    it('stops delivering once the subscription is swept', async () => {
        await clearRows();
        await subscribe(env.users.user.token, {
            expiresAt: Math.floor(Date.now() / 1000) + 3600,
        });
        await env.server.clients.db.write(
            `UPDATE \`${TABLE}\` SET \`expires_at\` = ?`,
            [Math.floor(Date.now() / 1000) - 1],
        );

        await expect(events().sweepExpired()).resolves.toBe(1);
        delivered.length = 0;

        const path = `${anchor}/swept-${uuidv4().slice(0, 8)}.txt`;
        await fs().touch(userId, { path });
        await quiet();

        expect(deliveryOf(path)).toBeUndefined();
    });
});

describe('where a durable delivery is addressed', () => {
    it('sends an app`s row to the app`s own room', async () => {
        await clearRows();
        await subscribe(appOneToken);
        const send = vi.spyOn(env.server.services.socket, 'send');
        delivered.length = 0;

        const path = `${anchor}/app-${uuidv4().slice(0, 8)}.txt`;
        await fs().touch(userId, { path });
        await settle(path);

        expect(send).toHaveBeenCalledWith(
            { room: appSocketRoom(userId, appOneUid) },
            'events.delivery',
            expect.objectContaining({ subId: expect.any(String) }),
        );
        send.mockRestore();
    });

    it('sends a session`s row to the account`s own room', async () => {
        await clearRows();
        await subscribe(env.users.user.token);
        const send = vi.spyOn(env.server.services.socket, 'send');
        delivered.length = 0;

        const path = `${anchor}/session-${uuidv4().slice(0, 8)}.txt`;
        await fs().touch(userId, { path });
        await settle(path);

        expect(send).toHaveBeenCalledWith(
            { room: String(userId) },
            'events.delivery',
            expect.objectContaining({ subId: expect.any(String) }),
        );
        send.mockRestore();
    });
});

describe('a durable row`s match filter', () => {
    it('filters deliveries the same way a session subscription`s would', async () => {
        await clearRows();
        const created = await subscribe(env.users.user.token, {
            subject: `fs:${anchor}/only-this.txt`,
        });
        delivered.length = 0;

        await fs().touch(userId, { path: `${anchor}/not-this.txt` });
        await quiet();
        expect(deliveryOf(`${anchor}/not-this.txt`)).toBeUndefined();

        await fs().touch(userId, { path: `${anchor}/only-this.txt` });
        await settle(`${anchor}/only-this.txt`);
        expect(deliveryOf(`${anchor}/only-this.txt`)?.subId).toBe(
            created.body.subId,
        );
    });
});

describe('a durable row across a share', () => {
    it('stops delivering the moment the share is revoked', async () => {
        await clearRows();
        const ownerRow = await env.server.stores.user.getByUsername(username);
        const guestRow = await env.server.stores.user.getByUsername(
            env.users.other.username,
        );
        const ownerActor = makeActor({ user: ownerRow as never });
        const guestActor = makeActor({ user: guestRow as never });

        const sharedPath = `${anchor}/shared-with-guest`;
        await fs().mkdir(userId, {
            path: sharedPath,
            createMissingParents: true,
        });
        await env.server.services.acl.setUserUser(
            ownerActor,
            guestActor,
            {
                path: sharedPath,
                resolveAncestors: () => fs().getAncestorChain(sharedPath),
            },
            'list',
        );

        const created = await subscribe(env.users.other.token, {
            subject: `fs:${sharedPath}`,
        });
        delivered.length = 0;

        await fs().touch(userId, { path: `${sharedPath}/first.txt` });
        await settle(`${sharedPath}/first.txt`);
        expect(deliveryOf(`${sharedPath}/first.txt`)?.subId).toBe(
            created.body.subId,
        );

        const sharedEntry =
            await env.server.stores.fsEntry.getEntryByPath(sharedPath);
        await env.server.services.permission.revokeUserUserPermission(
            ownerActor,
            env.users.other.username,
            `fs:${sharedEntry!.uid}:list`,
        );
        delivered.length = 0;

        // The re-check refuses it at once; the settle then takes the row out
        // of service behind it.
        await fs().touch(userId, { path: `${sharedPath}/second.txt` });
        await quiet();

        expect(deliveryOf(`${sharedPath}/second.txt`)).toBeUndefined();
    });
});

describe('with events switched off', () => {
    let off: PuterTestEnv;

    beforeAll(async () => {
        off = await setupPuterTestEnv();
    }, BOOT_TIMEOUT_MS);

    afterAll(async () => {
        await off?.shutdown();
    });

    const offCall = async (
        method: 'GET' | 'POST',
        path: string,
        body?: object,
    ): Promise<ApiResponse> => {
        const response = await fetch(new URL(path, off.apiOrigin), {
            method,
            headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${off.users.user.token}`,
            },
            ...(body ? { body: JSON.stringify(body) } : {}),
        });
        return {
            status: response.status,
            body: (await response.json()) as Record<string, unknown>,
        };
    };

    it('refuses every verb with one code', async () => {
        for (const attempt of [
            offCall('POST', '/events/subscribe', {
                subject: `fs:/${off.users.user.username}`,
            }),
            offCall('GET', '/events/subscriptions'),
            offCall('POST', '/events/unsubscribe', { subId: 'user#nope' }),
        ]) {
            const response = await attempt;
            expect(response.status).toBe(503);
            expect(response.body.code).toBe('events_disabled');
        }
    });
});

/**
 * The tiering the rest of this file opts out of. Seeded accounts carry no
 * email, which is exactly what the plan machinery reads as a temporary
 * account — so this block boots with plans left on and gives the account an
 * email when it wants to be a registered one.
 */
describe('what a plan lets an account hold', () => {
    let tiered: PuterTestEnv;
    let tieredUserId: number;
    let tieredAnchor: string;
    let tieredApp: { uid: string; token: string };

    const tieredCall = async (
        path: string,
        token: string,
        body: object,
    ): Promise<ApiResponse> => {
        const response = await fetch(new URL(path, tiered.apiOrigin), {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(body),
        });
        return {
            status: response.status,
            body: (await response.json()) as Record<string, unknown>,
        };
    };

    const subscribeTiered = (token: string) =>
        tieredCall('/events/subscribe', token, { subject: `fs:${tieredAnchor}` });

    /**
     * Move the account between the plans the caps are written against: an
     * address on file is what tells them apart.
     */
    const setEmail = async (email: string | null) => {
        await tiered.server.stores.user.update(tieredUserId, { email });
        const user = await tiered.server.stores.user.getById(tieredUserId);
        tiered.server.services.metering.invalidateActorSubscription(user!.uuid);
    };

    beforeAll(async () => {
        tiered = await setupPuterTestEnv({
            events: { enabled: true },
        } as IConfig);
        const user = await tiered.server.stores.user.getByUsername(
            tiered.users.user.username,
        );
        tieredUserId = user!.id;

        tieredAnchor = `/${tiered.users.user.username}/tiered`;
        await tiered.server.services.fs.mkdir(tieredUserId, {
            path: tieredAnchor,
            createMissingParents: true,
        });

        const uid = `app-${uuidv4()}`;
        await tiered.server.clients.db.write(
            'INSERT INTO `apps` (`uid`, `name`, `title`, `index_url`, `owner_user_id`) VALUES (?, ?, ?, ?, ?)',
            [uid, uid, uid, `https://${uid}.example/`, tieredUserId],
        );
        const entry =
            await tiered.server.stores.fsEntry.getEntryByPath(tieredAnchor);
        const actor = await tiered.server.services.auth.authenticate(
            tiered.users.user.token,
        );
        await tiered.server.services.permission.grantUserAppPermission(
            actor.actor!,
            uid,
            `fs:${entry!.uid}:list`,
        );
        // A durable app row targets the worker by default, so the caps are only
        // reachable once the background consent behind that target is given.
        await tiered.server.services.permission.grantUserAppPermission(
            actor.actor!,
            uid,
            EVENTS_BACKGROUND_PERMISSION,
        );
        tieredApp = {
            uid,
            token: await tiered.server.services.auth.getUserAppToken(
                actor.actor!,
                uid,
            ),
        };
    }, BOOT_TIMEOUT_MS);

    afterAll(async () => {
        await tiered?.shutdown();
    });

    it('refuses a temporary account outright — it has session subscriptions', async () => {
        await setEmail(null);

        const refused = await subscribeTiered(tiered.users.user.token);

        expect(refused.status).toBe(403);
        expect(refused.body.code).toBe('events_durable_requires_account');
    });

    it('holds a free account to the free per-app cap', async () => {
        await setEmail(`${tiered.users.user.username}@example.invalid`);
        const cap =
            EVENTS_DURABLE_SUBSCRIPTIONS_PER_APP.bySubscription[
                DEFAULT_FREE_SUBSCRIPTION
            ];

        // Both servers in this file share the process-wide Redis mock, so this
        // user id's call budget already carries the other server's subscribes.
        await tiered.server.clients.redis.del(
            `rate:${EVENTS_SUBSCRIBE_LIMIT.scope}:${tieredUserId}`,
        );
        for (let i = 0; i < cap; i++)
            expect((await subscribeTiered(tieredApp.token)).status).toBe(200);

        const refused = await subscribeTiered(tieredApp.token);
        expect(refused.status).toBe(429);
        expect(refused.body.code).toBe('events_subscription_limit');

        // The account itself is nowhere near its own cap, so its own session
        // may still subscribe.
        expect((await subscribeTiered(tiered.users.user.token)).status).toBe(200);
    });
});
