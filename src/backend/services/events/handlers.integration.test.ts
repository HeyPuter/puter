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
 * Handlers end to end: who may publish them, what a subscription binding one is
 * held to, and the full removal-suspends / republish-resumes cycle.
 *
 * The context assertions belong here rather than in a store test because the
 * point is what crosses each boundary: a listing never carries values, and one
 * shared handler delivers each subscriber their own.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import {
    EVENTS_COALESCE_WINDOW_MS,
    EVENTS_HANDLER_PUBLISH_BATCH,
    EVENTS_HANDLER_SOURCE_MAX_BYTES,
    EVENTS_SUSPENDED_PENDING_CAP,
    EVENTS_WORKER_SOURCE_MAX_BYTES,
} from '../../controllers/events/limits.js';
import { setupPuterTestEnv, type PuterTestEnv } from '../../testUtil.js';
import { hashContent } from '../../stores/events/EventHandlerStore.js';
import type { IConfig } from '../../types.js';
import { EVENTS_BACKGROUND_PERMISSION } from './authorization.js';
import type { DurableSubscriptionView } from './EventsService.js';
import { RecordingWorkerInvoker } from './workerSeam.js';

const BOOT_TIMEOUT_MS = 120_000;

const SOURCE = 'async ({ event, ctx }) => { await fetch(ctx.url, { method: "POST" }); }';
const NEXT_SOURCE = 'async ({ event, ctx }) => { console.log(event.path, ctx.url); }';

let env: PuterTestEnv;
let userId: number;
let otherUserId: number;
let anchor: string;
let otherAnchor: string;
let appUid: string;
let appToken: string;
let otherAppToken: string;
let foreignAppUid: string;
let foreignAppToken: string;
let worker: RecordingWorkerInvoker;

const events = () => env.server.services.events;
const durable = () => env.server.stores.durableSubscription;
const pending = () => env.server.stores.pendingDelivery;

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

const publish = (token: string, body: object): Promise<ApiResponse> =>
    call('POST', '/events/handlers/publish', token, body);

const seedHandler = async (
    name = 'ingestUpload',
    source = SOURCE,
): Promise<string> => {
    const published = await publish(appToken, { name, source });
    expect(published.status).toBe(200);
    return String(published.body.hash);
};

/**
 * An app owned by `ownerUserId`, granted `list` on each named user's anchor so
 * its token can subscribe there.
 */
const makeApp = async (
    ownerUserId: number,
    grants: Array<{ token: string; path: string }>,
): Promise<{ uid: string; tokens: string[] }> => {
    const uid = `app-${uuidv4()}`;
    await env.server.clients.db.write(
        'INSERT INTO `apps` (`uid`, `name`, `title`, `index_url`, `owner_user_id`) VALUES (?, ?, ?, ?, ?)',
        [uid, uid, uid, `https://${uid}.example/`, ownerUserId],
    );

    const tokens: string[] = [];
    for (const grant of grants) {
        const entry = await env.server.stores.fsEntry.getEntryByPath(grant.path);
        const { actor } = await env.server.services.auth.authenticate(grant.token);
        await env.server.services.permission.grantUserAppPermission(
            actor!,
            uid,
            `fs:${entry!.uid}:list`,
        );
        // Durable rows target the app's worker by default, which takes its own
        // consent.
        await env.server.services.permission.grantUserAppPermission(
            actor!,
            uid,
            EVENTS_BACKGROUND_PERMISSION,
        );
        tokens.push(
            await env.server.services.auth.getUserAppToken(actor!, uid),
        );
    }
    return { uid, tokens };
};

const subscribe = (token: string, body: object): Promise<ApiResponse> =>
    call('POST', '/events/subscribe', token, body);

const listSubscriptions = async (
    token: string,
): Promise<DurableSubscriptionView[]> =>
    (await call('GET', '/events/subscriptions', token))
        .body.items as DurableSubscriptionView[];

const rowOf = (subId: string) => durable().getBySubId(subId);

const touch = (holder: number, path: string) =>
    env.server.services.fs.touch(holder, { path });

beforeAll(async () => {
    env = await setupPuterTestEnv({
        events: { enabled: true },
        // Seeded accounts carry no email, which the plan machinery reads as a
        // temporary account — and a temporary account holds no durable rows.
        // Plans are not what these cases are about.
        unlimitedMetering: true,
    } as IConfig);

    const user = await env.server.stores.user.getByUsername(
        env.users.user.username,
    );
    userId = user!.id;
    const other = await env.server.stores.user.getByUsername(
        env.users.other.username,
    );
    otherUserId = other!.id;

    anchor = `/${env.users.user.username}/handlers`;
    otherAnchor = `/${env.users.other.username}/handlers`;
    await env.server.services.fs.mkdir(userId, {
        path: anchor,
        createMissingParents: true,
    });
    await env.server.services.fs.mkdir(otherUserId, {
        path: otherAnchor,
        createMissingParents: true,
    });

    // One app, owned by `user`, that both accounts have let in.
    const owned = await makeApp(userId, [
        { token: env.users.user.token, path: anchor },
        { token: env.users.other.token, path: otherAnchor },
    ]);
    appUid = owned.uid;
    [appToken, otherAppToken] = owned.tokens;

    // A second app, owned by somebody else, whose token `user` also holds.
    const foreign = await makeApp(otherUserId, [
        { token: env.users.user.token, path: anchor },
    ]);
    foreignAppUid = foreign.uid;
    [foreignAppToken] = foreign.tokens;

    worker = new RecordingWorkerInvoker();
    events().worker = worker;
}, BOOT_TIMEOUT_MS);

afterAll(async () => {
    await env?.shutdown();
});

beforeEach(async () => {
    await env.server.clients.db.write('DELETE FROM `event_handlers`', []);
    for (const row of await durable().listActiveForHolder(userId, null))
        await durable().remove(row);
    await env.server.clients.db.write('DELETE FROM `event_subscriptions`', []);
    await env.server.stores.eventSubscription.rebuildDurable(userId, []);
    await env.server.stores.eventSubscription.rebuildDurable(otherUserId, []);
    worker.recorded.length = 0;
});

describe('who may publish a handler', () => {
    it('lets an app token publish into its own app', async () => {
        const published = await publish(appToken, {
            name: 'ingestUpload',
            source: SOURCE,
        });

        expect(published.status).toBe(200);
        expect(published.body).toMatchObject({
            name: 'ingestUpload',
            hash: hashContent(SOURCE),
            outcome: 'created',
            resumed: 0,
        });
        expect(published.body.source).toBeUndefined();
    });

    it('lets an account session publish by naming an app it owns', async () => {
        const published = await publish(env.users.user.token, {
            appUid,
            name: 'ingestUpload',
            source: SOURCE,
        });
        expect(published.status).toBe(200);
    });

    it('refuses an account session that names no app', async () => {
        const refused = await publish(env.users.user.token, {
            name: 'ingestUpload',
            source: SOURCE,
        });

        expect(refused.status).toBe(400);
        expect(refused.body.code).toBe('events_handler_app_required');
    });

    it('refuses an app token whose app its user does not own', async () => {
        const refused = await publish(foreignAppToken, {
            name: 'ingestUpload',
            source: SOURCE,
        });

        expect(refused.status).toBe(403);
        expect(refused.body.code).toBe('events_handler_forbidden');
    });

    it('refuses an account session naming an app it does not own', async () => {
        const refused = await publish(env.users.user.token, {
            appUid: foreignAppUid,
            name: 'ingestUpload',
            source: SOURCE,
        });

        expect(refused.status).toBe(403);
        expect(refused.body.code).toBe('events_handler_forbidden');
    });

    it('refuses an app token reaching into another app`s namespace', async () => {
        const refused = await publish(appToken, {
            appUid: foreignAppUid,
            name: 'ingestUpload',
            source: SOURCE,
        });

        expect(refused.status).toBe(403);
        expect(refused.body.code).toBe('events_handler_forbidden');
    });
});

describe('publishing a set', () => {
    it('takes a build step`s handlers in one call', async () => {
        const published = await call(
            'POST',
            '/events/handlers/publishAll',
            appToken,
            {
                handlers: [
                    { name: 'ingestUpload', source: SOURCE },
                    { name: 'indexDocument', source: NEXT_SOURCE },
                ],
            },
        );

        expect(published.status).toBe(200);
        expect(
            (published.body.handlers as Array<{ name: string }>).map(
                (row) => row.name,
            ),
        ).toEqual(['ingestUpload', 'indexDocument']);
    });

    it('stops at the item it cannot publish rather than reporting success', async () => {
        await seedHandler();

        const refused = await call(
            'POST',
            '/events/handlers/publishAll',
            appToken,
            {
                handlers: [
                    { name: 'indexDocument', source: NEXT_SOURCE },
                    { name: 'ingestUpload', source: NEXT_SOURCE },
                ],
            },
        );

        expect(refused.status).toBe(409);
        expect(refused.body.code).toBe('events_handler_conflict');
        // The item before the conflict landed; the caller is told where it
        // stopped rather than being left to guess.
        const listed = await call('GET', '/events/handlers/list', appToken);
        expect(
            (listed.body.handlers as Array<{ name: string }>).map((h) => h.name),
        ).toContain('indexDocument');
    });
});

describe('the total-source cap', () => {
    it(
        'refuses a publish that would push the app past the size cap',
        { timeout: 30_000 },
        async () => {
            // Every handler at the per-handler max: the fewest handlers that
            // can reach the total cap.
            const bigSource = 'x'.repeat(EVENTS_HANDLER_SOURCE_MAX_BYTES);
            const names = Array.from(
                { length: EVENTS_WORKER_SOURCE_MAX_BYTES / EVENTS_HANDLER_SOURCE_MAX_BYTES },
                (_, i) => `big${i}`,
            );

            for (let i = 0; i < names.length; i += EVENTS_HANDLER_PUBLISH_BATCH) {
                const batch = names
                    .slice(i, i + EVENTS_HANDLER_PUBLISH_BATCH)
                    .map((name) => ({ name, source: bigSource }));
                const res = await call(
                    'POST',
                    '/events/handlers/publishAll',
                    appToken,
                    { handlers: batch },
                );
                expect(res.status).toBe(200);
            }

            // Sitting exactly at the cap; one more handler of any size, at all,
            // pushes the set over it.
            const refused = await publish(appToken, {
                name: 'overflow',
                source: 'async () => {}',
            });
            expect(refused.status).toBe(413);
            expect(refused.body.code).toBe('events_worker_too_large');

            // Replacing an existing name is judged on the new total with that
            // name's own bytes backed out first, not added on top of them —
            // same size, different content, so it must not double-count.
            const replace = await publish(appToken, {
                name: 'big0',
                source: 'y'.repeat(EVENTS_HANDLER_SOURCE_MAX_BYTES),
                replace: true,
            });
            expect(replace.status).toBe(200);
        },
    );
});

describe('listing handlers', () => {
    it('reports names and hashes and never the source', async () => {
        await seedHandler();

        const listed = await call('GET', '/events/handlers/list', appToken);

        expect(listed.status).toBe(200);
        expect(listed.body.handlers).toEqual([
            {
                name: 'ingestUpload',
                hash: hashContent(SOURCE),
                updatedAt: expect.any(Number),
                subscriptions: 0,
            },
        ]);
    });
});

describe('binding a subscription to a handler', () => {
    it('binds a name the app has published', async () => {
        await seedHandler();

        const created = await subscribe(appToken, {
            subject: `fs:${anchor}`,
            delivery: 'single',
            handlerName: 'ingestUpload',
            targets: ['worker'],
        });

        expect(created.status).toBe(200);
        expect(created.body.handlerName).toBe('ingestUpload');
    });

    it('refuses a name the app never published', async () => {
        const refused = await subscribe(appToken, {
            subject: `fs:${anchor}`,
            delivery: 'single',
            handlerName: 'ingestUpload',
            targets: ['worker'],
        });

        expect(refused.status).toBe(404);
        expect(refused.body.code).toBe('events_handler_not_found');
        expect(await durable().listActiveForHolder(userId, appUid)).toEqual([]);
    });

    it('binds an inline body whose hash is what is published', async () => {
        const hash = await seedHandler();

        const created = await subscribe(appToken, {
            subject: `fs:${anchor}`,
            delivery: 'single',
            handlerName: 'ingestUpload',
            handlerHash: hash,
            targets: ['worker'],
        });

        expect(created.status).toBe(200);
    });

    it('refuses an inline body that is not what is published', async () => {
        await seedHandler();

        const refused = await subscribe(appToken, {
            subject: `fs:${anchor}`,
            delivery: 'single',
            handlerName: 'ingestUpload',
            handlerHash: hashContent(NEXT_SOURCE),
            targets: ['worker'],
        });

        expect(refused.status).toBe(409);
        expect(refused.body.code).toBe('events_handler_hash_mismatch');
        expect(await durable().listActiveForHolder(userId, appUid)).toEqual([]);
    });

    it('still needs a name for a subscription owed to one consumer', async () => {
        const refused = await subscribe(appToken, {
            subject: `fs:${anchor}`,
            delivery: 'single',
            targets: ['worker'],
        });

        expect(refused.status).toBe(400);
        expect(refused.body.code).toBe('events_handler_required');
    });
});

describe('the handler lifecycle', () => {
    const bind = async (): Promise<string> => {
        await seedHandler();
        const created = await subscribe(appToken, {
            subject: `fs:${anchor}`,
            delivery: 'single',
            handlerName: 'ingestUpload',
            targets: ['worker'],
        });
        expect(created.status).toBe(200);
        return String(created.body.subId);
    };

    it('deletes outright a name nothing is bound to', async () => {
        await seedHandler();

        const removed = await call(
            'POST',
            '/events/handlers/remove',
            appToken,
            { name: 'ingestUpload' },
        );

        expect(removed.body).toMatchObject({ removed: true, suspended: 0 });
        const listed = await call('GET', '/events/handlers/list', appToken);
        expect(listed.body.handlers).toEqual([]);
    });

    it('suspends dependents, then resumes them when the name comes back', async () => {
        const subId = await bind();

        const removed = await call(
            'POST',
            '/events/handlers/remove',
            appToken,
            { name: 'ingestUpload' },
        );
        expect(removed.body).toMatchObject({ removed: true, suspended: 1 });

        const suspended = await rowOf(subId);
        expect(suspended).toMatchObject({
            suspendedReason: 'handler_not_found',
        });
        expect(suspended!.suspendedAt).toBeGreaterThan(0);
        // Out of every watched set, so no event under the anchor reaches it.
        expect(
            await env.server.stores.eventSubscription.getForTokens(userId, [
                suspended!.token,
            ]),
        ).toEqual([]);

        const republished = await publish(appToken, {
            name: 'ingestUpload',
            source: NEXT_SOURCE,
        });
        expect(republished.body).toMatchObject({
            outcome: 'created',
            resumed: 1,
        });

        const resumed = await rowOf(subId);
        expect(resumed).toMatchObject({
            suspendedAt: null,
            suspendedReason: null,
        });
        // Back in the watched set, and the generation moved so every other
        // region rebuilds rather than staying blind to it.
        expect(
            (
                await env.server.stores.eventSubscription.getForTokens(userId, [
                    resumed!.token,
                ])
            ).map((row) => row.subId),
        ).toEqual([subId]);
    });

    it('shows the suspension and its reason in the holder`s listing', async () => {
        const subId = await bind();
        await call('POST', '/events/handlers/remove', appToken, {
            name: 'ingestUpload',
        });

        const listed = await listSubscriptions(appToken);
        expect(listed.find((row) => row.subId === subId)).toMatchObject({
            suspendedReason: 'handler_not_found',
        });
    });

    it('counts a suspended dependent as still bound to the name', async () => {
        await bind();
        await call('POST', '/events/handlers/remove', appToken, {
            name: 'ingestUpload',
        });
        await publish(appToken, { name: 'ingestUpload', source: NEXT_SOURCE });

        const listed = await call('GET', '/events/handlers/list', appToken);
        expect(listed.body.handlers).toEqual([
            expect.objectContaining({ name: 'ingestUpload', subscriptions: 1 }),
        ]);
    });

    it('trims the backlog a suspension holds and drops it when the hold lapses', async () => {
        const subId = await bind();

        for (let i = 0; i < EVENTS_SUSPENDED_PENDING_CAP + 5; i++) {
            await pending().enqueue(subId, {
                id: `event-${i}`,
                subject: `fs:${anchor}`,
                op: 'write',
                uid: 'node',
                path: `${anchor}/f-${i}.txt`,
                self: true,
                ts: Date.now(),
                seq: 0,
            });
        }
        expect(await pending().depth(subId)).toBeGreaterThan(
            EVENTS_SUSPENDED_PENDING_CAP,
        );

        await call('POST', '/events/handlers/remove', appToken, {
            name: 'ingestUpload',
        });

        // Trimmed to the reduced cap, with one gap marker taking the place of
        // what went.
        expect(await pending().depth(subId)).toBe(EVENTS_SUSPENDED_PENDING_CAP);

        // The sweeper only enforces the deadline once it has passed.
        await events().sweepPending();
        expect(await pending().depth(subId)).toBe(EVENTS_SUSPENDED_PENDING_CAP);

        await pending().hold(subId, EVENTS_SUSPENDED_PENDING_CAP, -1);
        await events().sweepPending();

        // Everything held went, and one marker says so rather than the
        // subscription reading the silence as "nothing happened".
        expect(await pending().depth(subId)).toBe(1);
        const claimed = await pending().claim(subId);
        expect(claimed?.event).toMatchObject({
            op: 'gap',
            reason: 'suspended_backlog_expired',
        });
    });

    it('hands over the backlog a hold kept once the handler is republished', async () => {
        const subId = await bind();

        await pending().enqueue(subId, {
            id: 'held-1',
            subject: `fs:${anchor}`,
            op: 'write',
            uid: 'node',
            path: `${anchor}/held.txt`,
            self: true,
            ts: Date.now(),
            seq: 0,
        });

        await call('POST', '/events/handlers/remove', appToken, {
            name: 'ingestUpload',
        });
        // Under the reduced cap, so held rather than dropped.
        expect(await pending().depth(subId)).toBe(1);

        await publish(appToken, { name: 'ingestUpload', source: NEXT_SOURCE });

        // `releaseHold` lifts the reduced cap and `resumeSubscriptions` drains
        // what survived it — the held event reaches the handler rather than
        // sitting there until something else asks for it. (The recording
        // stub never reports `settled`, so the entry's lease stays open
        // rather than the depth dropping to zero — that half is covered by
        // `singleDelivery.test.ts`'s settle case.)
        await vi.waitFor(
            () =>
                expect(
                    worker.recorded.some(
                        (call) =>
                            call.subId === subId &&
                            (call.event as { id?: string }).id === 'held-1',
                    ),
                ).toBe(true),
            { timeout: EVENTS_COALESCE_WINDOW_MS * 20, interval: 25 },
        );
    });

    it('delivers again end to end once a republish resumes it', async () => {
        const subId = await bind();

        await call('POST', '/events/handlers/remove', appToken, {
            name: 'ingestUpload',
        });
        expect(await rowOf(subId)).toMatchObject({
            suspendedReason: 'handler_not_found',
        });

        const republished = await publish(appToken, {
            name: 'ingestUpload',
            source: NEXT_SOURCE,
        });
        expect(republished.body).toMatchObject({ resumed: 1 });
        expect(await rowOf(subId)).toMatchObject({ suspendedAt: null });

        // Tokens re-cached and the generation moved, per the test above; the
        // full cycle also means a *new* write reaches the handler again,
        // exactly as it would have before the handler was ever removed.
        await touch(userId, `${anchor}/after-resume.txt`);

        await vi.waitFor(
            () =>
                expect(
                    worker.recorded.some((call) => call.subId === subId),
                ).toBe(true),
            { timeout: EVENTS_COALESCE_WINDOW_MS * 20, interval: 25 },
        );
    });

    it('does not resume a subscription a withdrawn grant stopped', async () => {
        const subId = await bind();
        const row = await rowOf(subId);
        await events().suspendSubscriptions([row!], 'permission_revoked');

        await call('POST', '/events/handlers/remove', appToken, {
            name: 'ingestUpload',
        });
        const republished = await publish(appToken, {
            name: 'ingestUpload',
            source: SOURCE,
        });

        expect(republished.body.resumed).toBe(0);
        expect(await rowOf(subId)).toMatchObject({
            suspendedReason: 'permission_revoked',
        });
    });

    it('purges the backlog of a withdrawn grant instead of holding it', async () => {
        const subId = await bind();
        await pending().enqueue(subId, {
            id: 'event-1',
            subject: `fs:${anchor}`,
            op: 'write',
            uid: 'node',
            path: `${anchor}/f.txt`,
            self: true,
            ts: Date.now(),
            seq: 0,
        });

        const row = await rowOf(subId);
        await events().suspendSubscriptions([row!], 'permission_revoked');

        expect(await pending().depth(subId)).toBe(0);
    });

    it('suspends and resumes one row for the reasons the delivery path raises', async () => {
        const subId = await bind();

        expect(await events().suspendForNoCredit(subId)).toBe(true);
        expect(await rowOf(subId)).toMatchObject({
            suspendedReason: 'no_credit',
        });
        // Already out of service, so nothing to do a second time.
        expect(await events().suspendForNoCredit(subId)).toBe(false);

        expect(await events().resumeForCredit(userId)).toBe(1);
        expect(await rowOf(subId)).toMatchObject({ suspendedAt: null });

        expect(await events().suspendForFailures(subId)).toBe(true);
        expect(await rowOf(subId)).toMatchObject({
            suspendedReason: 'failures',
        });
        // A credit restore does not lift a suspension it did not cause.
        expect(await events().resumeForCredit(userId)).toBe(0);
    });

    it('puts a row a failing handler stopped back in service on a republish', async () => {
        const subId = await bind();
        await events().suspendForFailures(subId);

        // New source under the name is the fix for a handler that could not
        // take its deliveries, so it is what brings its subscriptions back.
        const republished = await call('POST', '/events/handlers/publish', appToken, {
            name: 'ingestUpload',
            source: NEXT_SOURCE,
            replace: true,
        });

        expect(republished.body.resumed).toBe(1);
        expect(await rowOf(subId)).toMatchObject({
            suspendedAt: null,
            suspendedReason: null,
        });
    });
});

describe('the context a subscription carries', () => {
    it('reports its key names and a hash, never its values', async () => {
        await seedHandler();
        const created = await subscribe(appToken, {
            subject: `fs:${anchor}`,
            delivery: 'single',
            handlerName: 'ingestUpload',
            targets: ['worker'],
            context: { url: 'https://ingest.example/secret-token', retries: 3 },
        });
        expect(created.status).toBe(200);

        const [listed] = await listSubscriptions(appToken);
        expect(listed.contextKeys).toEqual(['retries', 'url']);
        expect(listed.contextHash).toMatch(/^[0-9a-f]{64}$/);
        expect(JSON.stringify(listed)).not.toContain('secret-token');
    });

    it('has neither for a subscription that carries none', async () => {
        await seedHandler();
        await subscribe(appToken, {
            subject: `fs:${anchor}`,
            delivery: 'single',
            handlerName: 'ingestUpload',
            targets: ['worker'],
        });

        const [listed] = await listSubscriptions(appToken);
        expect(listed.contextKeys).toBeNull();
        expect(listed.contextHash).toBeNull();
    });

    it('refuses one past the cap', async () => {
        await seedHandler();
        const refused = await subscribe(appToken, {
            subject: `fs:${anchor}`,
            delivery: 'single',
            handlerName: 'ingestUpload',
            targets: ['worker'],
            context: { blob: 'x'.repeat(5000) },
        });

        expect(refused.status).toBe(413);
        expect(refused.body.code).toBe('events_context_too_large');
    });

    it('delivers each subscriber their own against one shared handler', async () => {
        await seedHandler();

        const mine = await subscribe(appToken, {
            subject: `fs:${anchor}`,
            delivery: 'single',
            handlerName: 'ingestUpload',
            targets: ['worker'],
            context: { url: 'https://mine.example' },
        });
        const theirs = await subscribe(otherAppToken, {
            subject: `fs:${otherAnchor}`,
            delivery: 'single',
            handlerName: 'ingestUpload',
            targets: ['worker'],
            context: { url: 'https://theirs.example' },
        });
        expect(mine.status).toBe(200);
        expect(theirs.status).toBe(200);

        await touch(userId, `${anchor}/mine.txt`);
        await touch(otherUserId, `${otherAnchor}/theirs.txt`);

        await vi.waitFor(
            () => expect(worker.recorded.length).toBeGreaterThanOrEqual(2),
            { timeout: EVENTS_COALESCE_WINDOW_MS * 20, interval: 25 },
        );

        const forSub = (subId: unknown) =>
            worker.recorded.find((call) => call.subId === subId);

        expect(forSub(mine.body.subId)).toMatchObject({
            handlerName: 'ingestUpload',
            appUid,
            context: JSON.stringify({ url: 'https://mine.example' }),
        });
        expect(forSub(theirs.body.subId)).toMatchObject({
            handlerName: 'ingestUpload',
            appUid,
            context: JSON.stringify({ url: 'https://theirs.example' }),
        });
    });
});
