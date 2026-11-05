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
 * User-scope handlers on the publish side: who may publish into a user's own
 * scope, the inline create that names a handler by its source, what stays off
 * the primary and the broadcast bus, isolation from app scope and from other
 * users, and the caps and rent unit a scope counts as.
 */

import {
    afterAll,
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    onTestFinished,
    vi,
} from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import * as rateLimit from '../../core/http/middleware/rateLimit.js';
import { HttpError } from '../../core/http/HttpError.js';
import {
    EVENTS_HANDLER_PUBLISH_LIMIT,
    EVENTS_HANDLER_SOURCE_MAX_BYTES,
    EVENTS_USER_HANDLERS_PER_SCOPE,
    EVENTS_USER_SCOPE_SOURCE_MAX_BYTES,
} from '../../controllers/events/limits.js';
import {
    appHandlerScope,
    hashContent,
    type HandlerScope,
} from '../../stores/events/EventHandlerStore.js';
import { setupPuterTestEnv, type PuterTestEnv } from '../../testUtil.js';
import type { IConfig } from '../../types.js';
import {
    DEFAULT_FREE_SUBSCRIPTION,
    DEFAULT_TEMP_SUBSCRIPTION,
} from '../metering/consts.js';
import { EVENTS_BACKGROUND_PERMISSION } from './authorization.js';
import type { DurableSubscriptionView } from './EventsService.js';

const BOOT_TIMEOUT_MS = 120_000;

const SOURCE =
    'async ({ event, ctx }) => { await fetch(ctx.url, { method: "POST" }); }';
const OTHER_SOURCE =
    'async ({ event, ctx }) => { console.log(event.path, ctx.url); }';

let env: PuterTestEnv;
let userId: number;
let otherUserId: number;
let anchor: string;
let otherAnchor: string;
let appUid: string;
/** App sessions of the two users in the app `user` owns. */
let userToken: string;
let otherToken: string;
let foreignAppUid: string;
let foreignAppToken: string;

const events = () => env.server.services.events;
const store = () => env.server.stores.eventHandler;
const userScope = (holder: number, uid = appUid): HandlerScope => ({
    appUid: uid,
    holder,
});

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

const publishUser = (token: string, name: string, source: string, extra = {}) =>
    call('POST', '/events/handlers/publish', token, {
        scope: 'user',
        name,
        source,
        ...extra,
    });
const publishApp = (token: string, name: string, source: string, extra = {}) =>
    call('POST', '/events/handlers/publish', token, { name, source, ...extra });
const removeUser = (token: string, name: string) =>
    call('POST', '/events/handlers/remove', token, { scope: 'user', name });
const listUser = (token: string) =>
    call('GET', '/events/handlers/list?scope=user', token);
const subscribe = (token: string, body: object) =>
    call('POST', '/events/subscribe', token, body);

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
        const entry = await env.server.stores.fsEntry.getEntryByPath(
            grant.path,
        );
        const { actor } = await env.server.services.auth.authenticate(
            grant.token,
        );
        await env.server.services.permission.grantUserAppPermission(
            actor!,
            uid,
            `fs:${entry!.uid}:list`,
        );
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

const actorOf = async (token: string) =>
    (await env.server.services.auth.authenticate(token)).actor!;

const scopedTokenFrom = async (token: string): Promise<string> => {
    const actor = await actorOf(token);
    const entry = await env.server.stores.fsEntry.getEntryByPath(anchor);
    return env.server.services.auth.createAccessToken(
        actor,
        [[`fs:${entry!.uid}:list`]],
        { label: 'user-handlers-scope' },
    );
};

/** The plan and rented-unit counts a cap test runs against. */
const holding = (
    plan: string,
    held: { workers?: number; scopes?: number; owned?: number },
) => {
    vi.spyOn(
        env.server.services.metering,
        'getActorSubscription',
    ).mockResolvedValue({ id: plan } as never);
    vi.spyOn(
        env.server.stores.subdomain,
        'countByUserIdAndPrefix',
    ).mockResolvedValue(held.workers ?? 0);
    vi.spyOn(store(), 'countUserScopesWithHandlersForUser').mockResolvedValue(
        held.scopes ?? 0,
    );
    vi.spyOn(store(), 'countAppsWithHandlersForOwner').mockResolvedValue(
        held.owned ?? 0,
    );
};

let publishSpends: number;
let creates: Array<{
    appUid: string;
    scope: string;
    userId: number | undefined;
}>;
let destroys: Array<{
    appUid: string;
    scope: string;
    userId: number | undefined;
}>;

beforeAll(async () => {
    env = await setupPuterTestEnv({
        events: { enabled: true, userHandlers: true },
        unlimitedMetering: true,
    } as IConfig);

    userId = (await env.server.stores.user.getByUsername(
        env.users.user.username,
    ))!.id;
    otherUserId = (await env.server.stores.user.getByUsername(
        env.users.other.username,
    ))!.id;

    anchor = `/${env.users.user.username}/userhandlers`;
    otherAnchor = `/${env.users.other.username}/userhandlers`;
    await env.server.services.fs.mkdir(userId, {
        path: anchor,
        createMissingParents: true,
    });
    await env.server.services.fs.mkdir(otherUserId, {
        path: otherAnchor,
        createMissingParents: true,
    });

    const owned = await makeApp(userId, [
        { token: env.users.user.token, path: anchor },
        { token: env.users.other.token, path: otherAnchor },
    ]);
    appUid = owned.uid;
    [userToken, otherToken] = owned.tokens;

    const foreign = await makeApp(otherUserId, [
        { token: env.users.user.token, path: anchor },
    ]);
    foreignAppUid = foreign.uid;
    [foreignAppToken] = foreign.tokens;

    env.server.clients.event.on('events.worker.create', (_key, event) => {
        creates.push({
            appUid: event.appUid,
            scope: event.scope,
            userId: event.actor.user.id,
        });
    });
    env.server.clients.event.on('events.worker.destroy', (_key, event) => {
        destroys.push({
            appUid: event.appUid,
            scope: event.scope,
            userId: event.actor.user.id,
        });
    });
}, BOOT_TIMEOUT_MS);

afterAll(async () => {
    await env?.shutdown();
});

beforeEach(async () => {
    // Through the store, which also drops the cached sets a raw delete leaves.
    for (const uid of [appUid, foreignAppUid]) await store().deleteForApp(uid);
    await env.server.clients.db.write('DELETE FROM `event_subscriptions`', []);
    await env.server.stores.eventSubscription.rebuildDurable(userId, []);
    await env.server.stores.eventSubscription.rebuildDurable(otherUserId, []);
    creates = [];
    destroys = [];
    publishSpends = 0;
    // The publish window is 60 a minute per user and this file publishes far
    // more; what it counts is how often a call spent from it.
    vi.spyOn(rateLimit, 'checkRateLimit').mockImplementation(async (key) => {
        if (String(key).startsWith(EVENTS_HANDLER_PUBLISH_LIMIT.scope))
            publishSpends += 1;
        return true;
    });
    (events() as unknown as { config: IConfig }).config.events!.userHandlers =
        true;
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('who may publish into a user scope', () => {
    it('lets an app session publish into its own user scope', async () => {
        const published = await publishUser(userToken, 'daily', SOURCE);

        expect(published.status).toBe(200);
        expect(published.body).toMatchObject({
            name: 'daily',
            hash: hashContent(SOURCE),
            outcome: 'created',
        });
        expect(
            await store().getByName(userScope(userId), 'daily'),
        ).toMatchObject({ sourceHash: hashContent(SOURCE) });
        // Nothing reaches the app's own set.
        expect(await store().listForApp(appHandlerScope(appUid))).toEqual([]);
    });

    it('lets a user who does not own the app publish into their scope', async () => {
        const published = await publishUser(otherToken, 'daily', SOURCE);
        expect(published.status).toBe(200);
        expect(
            await store().getByName(userScope(otherUserId), 'daily'),
        ).not.toBe(null);
    });

    it('refuses a scoped access token, including one the app issued', async () => {
        for (const token of [
            await scopedTokenFrom(env.users.user.token),
            await scopedTokenFrom(userToken),
        ]) {
            const refused = await publishUser(token, 'daily', SOURCE, {
                appUid,
            });
            expect(refused.status).toBe(403);
            expect(refused.body.code).toBe('events_handler_forbidden');
        }
    });

    it('refuses a session with no app and a request naming no app of its own', async () => {
        const refused = await publishUser(
            env.users.user.token,
            'daily',
            SOURCE,
            {
                appUid,
            },
        );
        expect(refused.status).toBe(403);
        expect(refused.body.code).toBe('events_handler_forbidden');
    });

    it('refuses a request naming another app than the caller`s', async () => {
        const refused = await publishUser(userToken, 'daily', SOURCE, {
            appUid: foreignAppUid,
        });
        expect(refused.status).toBe(403);
        expect(refused.body.code).toBe('events_handler_forbidden');
    });

    it('refuses a guest', async () => {
        vi.spyOn(
            env.server.services.metering,
            'getActorSubscription',
        ).mockResolvedValue({ id: DEFAULT_TEMP_SUBSCRIPTION } as never);
        const refused = await publishUser(userToken, 'daily', SOURCE);
        expect(refused.status).toBe(403);
        expect(refused.body.code).toBe('events_handler_forbidden');
    });

    it('refuses a session with an unresolved app', async () => {
        const actor = { ...(await actorOf(userToken)) };
        delete (actor as { effectiveApp?: unknown }).effectiveApp;
        await expect(
            events().publishHandler(actor, {
                scope: 'user',
                name: 'daily',
                source: SOURCE,
            }),
        ).rejects.toMatchObject({ legacyCode: 'events_handler_forbidden' });
    });

    it('still requires owner equality for app scope', async () => {
        const refused = await publishApp(otherToken, 'daily', SOURCE);
        expect(refused.status).toBe(403);
        expect(refused.body.code).toBe('events_handler_forbidden');
        expect((await publishApp(userToken, 'daily', SOURCE)).status).toBe(200);
    });

    it('rejects a scope that is neither app nor user', async () => {
        const refused = await call(
            'POST',
            '/events/handlers/publish',
            userToken,
            {
                scope: 'team',
                name: 'daily',
                source: SOURCE,
            },
        );
        expect(refused.status).toBe(400);
    });

    it('reserves `@` names for what the server mints from a source', async () => {
        const refused = await publishUser(
            userToken,
            `@${'a'.repeat(64)}`,
            SOURCE,
        );
        expect(refused.status).toBe(400);
        expect(refused.body.code).toBe('events_handler_name_invalid');

        const matching = await publishUser(
            userToken,
            `@${hashContent(SOURCE)}`,
            SOURCE,
        );
        expect(matching.status).toBe(200);
    });
});

describe('credit and the worker lifecycle', () => {
    it('answers 402 with no balance, and still lets the user list and remove', async () => {
        expect((await publishUser(userToken, 'daily', SOURCE)).status).toBe(
            200,
        );

        vi.spyOn(
            env.server.services.metering,
            'hasAnyUsageCached',
        ).mockResolvedValue(false);

        const refused = await publishUser(userToken, 'other', OTHER_SOURCE);
        expect(refused.status).toBe(402);
        expect(refused.body.code).toBe('insufficient_funds');
        expect((await listUser(userToken)).status).toBe(200);
        expect((await removeUser(userToken, 'daily')).status).toBe(200);
    });

    it('fires events.worker.create once for the 0 to 1, as the holder', async () => {
        await publishUser(otherToken, 'daily', SOURCE);
        await publishUser(otherToken, 'again', OTHER_SOURCE);

        expect(creates).toEqual([
            { appUid, scope: 'user', userId: otherUserId },
        ]);
    });

    it('fires events.worker.destroy on the last removal, as the holder', async () => {
        await publishUser(otherToken, 'daily', SOURCE);
        await publishUser(otherToken, 'again', OTHER_SOURCE);

        await removeUser(otherToken, 'daily');
        expect(destroys).toEqual([]);
        await removeUser(otherToken, 'again');
        expect(destroys).toEqual([
            { appUid, scope: 'user', userId: otherUserId },
        ]);
    });

    it('tags an app-scope lifecycle event with the app scope and its owner', async () => {
        await publishApp(userToken, 'daily', SOURCE);
        expect(creates).toEqual([{ appUid, scope: 'app', userId }]);
    });
});

describe('inline create', () => {
    const inline = (token: string, source: string) =>
        subscribe(token, {
            subject: `fs:${anchor}`,
            queue: true,
            handlerSource: source,
            context: { url: 'https://hooks.example/abc' },
        });

    const dbCalls = () => {
        const db = env.server.clients.db;
        const spies = [
            vi.spyOn(db, 'pread'),
            vi.spyOn(db, 'read'),
            vi.spyOn(db, 'write'),
            vi.spyOn(db, 'insert'),
        ];
        return () => spies.reduce((sum, spy) => sum + spy.mock.calls.length, 0);
    };

    it('publishes `@<hash>` into the caller`s scope and binds the row to it', async () => {
        const created = await inline(userToken, SOURCE);

        expect(created.status).toBe(200);
        const name = `@${hashContent(SOURCE)}`;
        expect(created.body).toMatchObject({
            handlerName: name,
            handlerScope: 'user',
        });
        expect(await store().getByName(userScope(userId), name)).toMatchObject({
            source: SOURCE,
        });
        const row = await env.server.stores.durableSubscription.getBySubId(
            String(created.body.subId),
        );
        expect(row).toMatchObject({ handlerName: name, handlerScope: 'user' });
        expect(await store().listForApp(appHandlerScope(appUid))).toEqual([]);
    });

    it('binds a broadcast row too, and refuses neither handler nor source for a queue', async () => {
        const created = await subscribe(userToken, {
            subject: `fs:${anchor}`,
            handlerSource: SOURCE,
        });
        expect(created.status).toBe(200);

        const refused = await subscribe(userToken, {
            subject: `fs:${anchor}`,
            queue: true,
        });
        expect(refused.status).toBe(400);
        expect(refused.body.code).toBe('events_handler_required');
    });

    it('refuses a body that sends both a handlerName and a handlerSource', async () => {
        const refused = await subscribe(userToken, {
            subject: `fs:${anchor}`,
            handlerName: 'daily',
            handlerSource: SOURCE,
        });
        expect(refused.status).toBe(400);
    });

    it('answers a repeat of the same code from the cached set with no database work and no budget', async () => {
        const actor = await actorOf(userToken);

        // The first create writes; the next one warms the cache.
        await events().ensureInlineHandler(actor, appUid, SOURCE);
        await events().ensureInlineHandler(actor, appUid, SOURCE);

        const primaryBefore = publishSpends;
        const calls = dbCalls();
        const again = await events().ensureInlineHandler(actor, appUid, SOURCE);

        expect(again).toEqual({
            name: `@${hashContent(SOURCE)}`,
            hash: hashContent(SOURCE),
            scope: 'user',
        });
        expect(calls()).toBe(0);
        expect(publishSpends).toBe(primaryBefore);
    });

    describe('reusing a handler the sweep could collect', () => {
        const DAY = 24 * 60 * 60;
        const name = `@${hashContent(SOURCE)}`;
        const ageHandler = (seconds: number) =>
            env.server.clients.db.write(
                'UPDATE `event_user_handlers` SET `updated_at` = ? WHERE `app_uid` = ? AND `name` = ?',
                [Math.floor(Date.now() / 1000) - seconds, appUid, name],
            );
        const updatedAt = async () =>
            (await store().getByName(userScope(userId), name))?.updatedAt;
        const bound = async (subId: string) =>
            (await env.server.stores.durableSubscription.getBySubId(subId))
                ?.handlerName;

        it('touches an old handler once on the primary before binding to it', async () => {
            const actor = await actorOf(userToken);
            await events().ensureInlineHandler(actor, appUid, SOURCE);
            await ageHandler(DAY - 60);
            await store().cachedSetForApp(userScope(userId));
            const writes = vi.spyOn(env.server.clients.db, 'write');

            const created = await inline(userToken, SOURCE);

            const touches = writes.mock.calls.filter(([sql]) =>
                String(sql).startsWith('UPDATE `event_user_handlers`'),
            );
            expect(touches).toHaveLength(1);
            expect(
                Math.floor(Date.now() / 1000) - (await updatedAt())!,
            ).toBeLessThan(60);
            // The sweep can no longer take it.
            expect(await events().sweepUnboundUserHandlers()).toBe(0);
            expect(await bound(String(created.body.subId))).toBe(name);
            expect(await store().getByName(userScope(userId), name)).not.toBe(
                null,
            );
        });

        it('publishes again when the sweep collected it after the cache check', async () => {
            const actor = await actorOf(userToken);
            await events().ensureInlineHandler(actor, appUid, SOURCE);
            await ageHandler(2 * DAY);
            await store().cachedSetForApp(userScope(userId));
            const real = store().cachedSetForApp.bind(store());
            const check = vi
                .spyOn(store(), 'cachedSetForApp')
                .mockImplementationOnce(async (...args) => {
                    const set = await real(...args);
                    // Collected between the check and the insert.
                    await events().sweepUnboundUserHandlers();
                    return set;
                });

            const created = await inline(userToken, SOURCE);

            expect(check).toHaveBeenCalled();
            expect(created.status).toBe(200);
            expect(await store().getByName(userScope(userId), name)).not.toBe(
                null,
            );
            expect(await bound(String(created.body.subId))).toBe(name);
        });

        it('leaves a fresh handler read- and write-free', async () => {
            const actor = await actorOf(userToken);
            await events().ensureInlineHandler(actor, appUid, SOURCE);
            await events().ensureInlineHandler(actor, appUid, SOURCE);
            const calls = dbCalls();

            await events().ensureInlineHandler(actor, appUid, SOURCE);

            expect(calls()).toBe(0);
        });
    });

    it('reads the primary and spends the budget once for the first create in an empty scope', async () => {
        const actor = await actorOf(userToken);
        const calls = dbCalls();

        await events().ensureInlineHandler(actor, appUid, SOURCE);

        expect(calls()).toBeGreaterThan(0);
        expect(publishSpends).toBe(1);
    });

    it('treats a create that lost the unique-index race as unchanged', async () => {
        const actor = await actorOf(userToken);
        const real = store().publish.bind(store());
        vi.spyOn(store(), 'publish').mockImplementationOnce(async (input) => {
            await real(input);
            throw new HttpError(409, 'different source published', {
                legacyCode: 'events_handler_conflict',
            });
        });

        await expect(
            events().ensureInlineHandler(actor, appUid, SOURCE),
        ).resolves.toMatchObject({ name: `@${hashContent(SOURCE)}` });
    });

    it('does not hide a conflict whose published source differs', async () => {
        const actor = await actorOf(userToken);
        vi.spyOn(store(), 'publish').mockRejectedValueOnce(
            new HttpError(409, 'different source published', {
                legacyCode: 'events_handler_conflict',
            }),
        );
        await expect(
            events().ensureInlineHandler(actor, appUid, SOURCE),
        ).rejects.toMatchObject({ legacyCode: 'events_handler_conflict' });
    });

    it('lets concurrent identical creates both succeed, leaving one handler', async () => {
        const [a, b, c] = await Promise.all([
            inline(userToken, SOURCE),
            inline(userToken, SOURCE),
            inline(userToken, SOURCE),
        ]);

        expect([a.status, b.status, c.status]).toEqual([200, 200, 200]);
        expect(await store().countForApp(userScope(userId))).toBe(1);
    });

    it('leaves the handler behind when the row create fails past it', async () => {
        const refused = await subscribe(userToken, {
            subject: 'fs:/nowhere/at/all',
            queue: true,
            handlerSource: SOURCE,
        });
        expect(refused.status).not.toBe(200);
        // The subject failed to resolve first, so nothing was published.
        expect(await store().countForApp(userScope(userId))).toBe(0);

        vi.spyOn(
            env.server.stores.durableSubscription,
            'create',
        ).mockRejectedValueOnce(
            new HttpError(429, 'quota', { legacyCode: 'too_many_requests' }),
        );
        const quota = await inline(userToken, SOURCE);
        expect(quota.status).toBe(429);
        expect(await store().countForApp(userScope(userId))).toBe(1);
    });

    it('resumes rows suspended for a missing handler when it is created again', async () => {
        const created = await inline(userToken, SOURCE);
        const subId = String(created.body.subId);
        const name = `@${hashContent(SOURCE)}`;

        await removeUser(userToken, name);
        const suspended =
            await env.server.stores.durableSubscription.getBySubId(subId);
        expect(suspended?.suspendedReason).toBe('handler_not_found');

        await inline(userToken, SOURCE);
        const resumed =
            await env.server.stores.durableSubscription.getBySubId(subId);
        expect(resumed?.suspendedAt).toBeNull();
    });

    it('suspends the rows bound to a scope that is destroyed', async () => {
        const created = await inline(userToken, SOURCE);
        const destroyed = await call(
            'POST',
            '/events/workers/destroy',
            userToken,
            { scope: 'user' },
        );

        expect(destroyed.body).toMatchObject({ removed: 1, suspended: 1 });
        const row = await env.server.stores.durableSubscription.getBySubId(
            String(created.body.subId),
        );
        expect(row?.suspendedReason).toBe('handler_not_found');
    });

    it('refuses an inline create from an account session, a scoped token and a guest', async () => {
        for (const token of [
            env.users.user.token,
            await scopedTokenFrom(userToken),
        ]) {
            const refused = await inline(token, SOURCE);
            expect(refused.status).toBeGreaterThanOrEqual(400);
            expect(refused.status).toBeLessThan(500);
        }
        vi.spyOn(
            env.server.services.metering,
            'getActorSubscription',
        ).mockResolvedValue({ id: DEFAULT_TEMP_SUBSCRIPTION } as never);
        expect((await inline(userToken, SOURCE)).status).toBeGreaterThanOrEqual(
            400,
        );
        expect(await store().countForApp(userScope(userId))).toBe(0);
    });

    it('answers 402 with no balance only when it has to publish', async () => {
        const actor = await actorOf(userToken);
        await events().ensureInlineHandler(actor, appUid, SOURCE);
        await events().ensureInlineHandler(actor, appUid, SOURCE);
        vi.spyOn(
            env.server.services.metering,
            'hasAnyUsageCached',
        ).mockResolvedValue(false);

        await expect(
            events().ensureInlineHandler(actor, appUid, SOURCE),
        ).resolves.toBeDefined();
        await expect(
            events().ensureInlineHandler(actor, appUid, OTHER_SOURCE),
        ).rejects.toMatchObject({ statusCode: 402 });
    });
});

describe('peer broadcast', () => {
    const cacheUpdates = (emit: ReturnType<typeof vi.spyOn>) =>
        emit.mock.calls.filter(
            (args) =>
                args[0] === 'outer.cacheUpdate' &&
                (args[1] as { cacheKey: string[] }).cacheKey.some((key) =>
                    key.startsWith(`eventHandlers:uset:${appUid}:${userId}`),
                ),
        );

    it('sends nothing for an inline insert, and one event each for a remove and a named publish', async () => {
        const emit = vi.spyOn(env.server.clients.event, 'emit');
        const actor = await actorOf(userToken);

        await events().ensureInlineHandler(actor, appUid, SOURCE);
        expect(cacheUpdates(emit)).toHaveLength(0);

        await removeUser(userToken, `@${hashContent(SOURCE)}`);
        expect(cacheUpdates(emit)).toHaveLength(1);

        await publishUser(userToken, 'named', OTHER_SOURCE);
        expect(cacheUpdates(emit)).toHaveLength(2);
    });

    it('still clears this region`s cache on an inline insert', async () => {
        const actor = await actorOf(userToken);
        await events().ensureInlineHandler(actor, appUid, SOURCE);
        await events().ensureInlineHandler(actor, appUid, SOURCE);
        // Warm: the set is cached for the one handler.
        const second = await events().ensureInlineHandler(
            actor,
            appUid,
            OTHER_SOURCE,
        );
        expect(
            (
                await store().cachedSetForApp(userScope(userId), {
                    handlerName: second.name,
                })
            ).map((handler) => handler.name),
        ).toContain(second.name);
    });
});

describe('scope isolation', () => {
    it('keeps one user from listing, binding to or removing another`s handler', async () => {
        await publishUser(userToken, 'mine', SOURCE);

        expect((await listUser(otherToken)).body.handlers).toEqual([]);
        expect((await listUser(userToken)).body.handlers).toEqual([
            expect.objectContaining({ name: 'mine' }),
        ]);

        await expect(
            events().assertHandlerBinding(appUid, 'mine', null, {
                holder: otherUserId,
            }),
        ).rejects.toMatchObject({ legacyCode: 'events_handler_not_found' });
        await expect(
            events().assertHandlerBinding(appUid, 'mine', null, {
                holder: userId,
            }),
        ).resolves.toBeUndefined();

        const removed = await removeUser(otherToken, 'mine');
        expect(removed.body).toMatchObject({ removed: false });
        expect(await store().getByName(userScope(userId), 'mine')).not.toBe(
            null,
        );

        const bound = await subscribe(otherToken, {
            subject: `fs:${otherAnchor}`,
            handlerName: 'mine',
            handlerScope: 'user',
        });
        expect(bound.status).toBe(404);
        expect(bound.body.code).toBe('events_handler_not_found');
    });

    it('never resolves an app-scope handler for a user binding, or the reverse', async () => {
        await publishApp(userToken, 'shared-name', SOURCE);
        await publishUser(userToken, 'user-only', OTHER_SOURCE);

        const userBindingOfAppName = await subscribe(userToken, {
            subject: `fs:${anchor}`,
            handlerName: 'shared-name',
            handlerScope: 'user',
        });
        expect(userBindingOfAppName.status).toBe(404);

        const appBindingOfUserName = await subscribe(userToken, {
            subject: `fs:${anchor}`,
            handlerName: 'user-only',
        });
        expect(appBindingOfUserName.status).toBe(404);

        await expect(
            events().assertHandlerBinding(appUid, 'user-only', null),
        ).rejects.toMatchObject({ legacyCode: 'events_handler_not_found' });
        await expect(
            events().assertHandlerBinding(appUid, 'shared-name', null, {
                holder: userId,
            }),
        ).rejects.toMatchObject({ legacyCode: 'events_handler_not_found' });
    });

    it('binds a named user handler to the caller`s scope, hash checked', async () => {
        await publishUser(userToken, 'daily', SOURCE);

        const bound = await subscribe(userToken, {
            subject: `fs:${anchor}`,
            handlerName: 'daily',
            handlerScope: 'user',
            queue: true,
        });
        expect(bound.status).toBe(200);
        expect(bound.body).toMatchObject({
            handlerName: 'daily',
            handlerScope: 'user',
        });

        const wrongHash = await subscribe(userToken, {
            subject: `fs:${anchor}`,
            handlerName: 'daily',
            handlerScope: 'user',
            handlerHash: 'a'.repeat(64),
        });
        expect(wrongHash.status).toBe(409);
        expect(wrongHash.body.code).toBe('events_handler_hash_mismatch');
    });

    it('keeps app-scope and user-scope dependents apart on removal', async () => {
        await publishApp(userToken, 'same', SOURCE);
        await publishUser(userToken, 'same', OTHER_SOURCE);
        const appRow = await subscribe(userToken, {
            subject: `fs:${anchor}`,
            handlerName: 'same',
        });
        const userRow = await subscribe(userToken, {
            subject: `fs:${anchor}`,
            handlerName: 'same',
            handlerScope: 'user',
        });
        expect(appRow.status).toBe(200);
        expect(userRow.status).toBe(200);
        const rows = env.server.stores.durableSubscription;

        // Removing the app's name leaves the user's binding in service.
        const appRemoval = await call(
            'POST',
            '/events/handlers/remove',
            userToken,
            {
                name: 'same',
            },
        );
        expect(appRemoval.body).toMatchObject({ removed: true, suspended: 1 });
        expect(
            (await rows.getBySubId(String(appRow.body.subId)))?.suspendedReason,
        ).toBe('handler_not_found');
        expect(
            (await rows.getBySubId(String(userRow.body.subId)))?.suspendedAt,
        ).toBeNull();

        // And the reverse: removing the user's leaves a republished app row.
        await publishApp(userToken, 'same', SOURCE);
        expect(
            (await rows.getBySubId(String(appRow.body.subId)))?.suspendedAt,
        ).toBeNull();
        const userRemoval = await removeUser(userToken, 'same');
        expect(userRemoval.body).toMatchObject({ removed: true, suspended: 1 });
        expect(
            (await rows.getBySubId(String(appRow.body.subId)))?.suspendedAt,
        ).toBeNull();
        expect(
            (await rows.getBySubId(String(userRow.body.subId)))
                ?.suspendedReason,
        ).toBe('handler_not_found');
    });

    it('resumes only the user scope`s rows when a user republishes the name', async () => {
        await publishUser(userToken, 'same', SOURCE);
        const userRow = await subscribe(userToken, {
            subject: `fs:${anchor}`,
            handlerName: 'same',
            handlerScope: 'user',
        });
        await removeUser(userToken, 'same');
        const rows = env.server.stores.durableSubscription;
        expect(
            (await rows.getBySubId(String(userRow.body.subId)))
                ?.suspendedReason,
        ).toBe('handler_not_found');

        // An app-scope publish of the same name does not bring it back.
        await publishApp(userToken, 'same', SOURCE);
        expect(
            (await rows.getBySubId(String(userRow.body.subId)))
                ?.suspendedReason,
        ).toBe('handler_not_found');

        const republished = await publishUser(userToken, 'same', SOURCE);
        expect(republished.body.resumed).toBe(1);
    });
});

describe('with the flag off', () => {
    beforeEach(() => {
        (
            events() as unknown as { config: IConfig }
        ).config.events!.userHandlers = false;
    });

    it('refuses a user-scope publish and an inline create', async () => {
        const publishRefused = await publishUser(userToken, 'daily', SOURCE);
        expect(publishRefused.status).toBe(503);
        expect(publishRefused.body.code).toBe('events_user_handlers_disabled');

        const inlineRefused = await subscribe(userToken, {
            subject: `fs:${anchor}`,
            queue: true,
            handlerSource: SOURCE,
        });
        expect(inlineRefused.status).toBe(503);
        expect(inlineRefused.body.code).toBe('events_user_handlers_disabled');

        const namedRefused = await subscribe(userToken, {
            subject: `fs:${anchor}`,
            handlerName: 'daily',
            handlerScope: 'user',
        });
        expect(namedRefused.status).toBe(503);
        expect(await store().countForApp(userScope(userId))).toBe(0);
    });

    it('does not apply the rented-unit cap to an owner`s first app publish', async () => {
        holding(DEFAULT_FREE_SUBSCRIPTION, {
            workers: 16,
            scopes: 16,
            owned: 16,
        });
        expect((await publishApp(userToken, 'daily', SOURCE)).status).toBe(200);
    });

    it('leaves app scope alone, and lets a user remove what they hold', async () => {
        expect((await publishApp(userToken, 'daily', SOURCE)).status).toBe(200);

        await store().publish({
            scope: userScope(userId),
            name: 'held',
            source: SOURCE,
        });
        expect((await removeUser(userToken, 'held')).body).toMatchObject({
            removed: true,
        });
    });
});

describe('caps', () => {
    it('refuses the handler past the per-scope count', async () => {
        for (let i = 0; i < EVENTS_USER_HANDLERS_PER_SCOPE; i++)
            expect(
                (await publishUser(userToken, `h${i}`, `${SOURCE} // ${i}`))
                    .status,
            ).toBe(200);

        const refused = await publishUser(userToken, 'one-more', OTHER_SOURCE);
        expect(refused.status).toBe(429);
        expect(refused.body.code).toBe('events_handler_limit');

        // Another user's scope in the same app is a scope of its own.
        expect((await publishUser(otherToken, 'h0', SOURCE)).status).toBe(200);
    });

    it('refuses a scope whose handlers together exceed the combined size', async () => {
        const padded = (i: number) =>
            `async () => { /* ${i} ${'x'.repeat(EVENTS_HANDLER_SOURCE_MAX_BYTES - 1024)} */ }`;
        const fits = Math.floor(
            EVENTS_USER_SCOPE_SOURCE_MAX_BYTES /
                (EVENTS_HANDLER_SOURCE_MAX_BYTES - 1000),
        );
        for (let i = 0; i < fits; i++)
            expect(
                (await publishUser(userToken, `big${i}`, padded(i))).status,
            ).toBe(200);

        const refused = await publishUser(userToken, 'bigger', padded(99));
        expect(refused.status).toBe(413);
        expect(refused.body.code).toBe('events_worker_too_large');

        // The cap is per scope.
        expect((await publishUser(otherToken, 'big0', padded(0))).status).toBe(
            200,
        );
    });

    it('holds one handler to the shared per-handler size', async () => {
        const refused = await publishUser(
            userToken,
            'huge',
            `async () => { /* ${'x'.repeat(EVENTS_HANDLER_SOURCE_MAX_BYTES)} */ }`,
        );
        expect(refused.status).toBe(413);
        expect(refused.body.code).toBe('events_handler_too_large');
    });

    it('spends the shared publish budget on a user-scope publish', async () => {
        await publishUser(userToken, 'daily', SOURCE);
        expect(publishSpends).toBe(1);
    });
});

describe('rented-unit cap', () => {
    const refusedAsLimit = (response: ApiResponse) => {
        expect(response.status).toBe(403);
        expect(response.body.code).toBe('forbidden');
    };

    it('refuses a free user the 17th unit, whichever source filled the 16', async () => {
        for (const held of [
            { workers: 16 },
            { scopes: 16 },
            { owned: 16 },
            { workers: 6, scopes: 5, owned: 5 },
        ]) {
            holding(DEFAULT_FREE_SUBSCRIPTION, held);
            refusedAsLimit(await publishUser(userToken, 'daily', SOURCE));
            const inline = await subscribe(userToken, {
                subject: `fs:${anchor}`,
                queue: true,
                handlerSource: SOURCE,
            });
            refusedAsLimit(inline);
            // The app's first handler is a unit as well.
            refusedAsLimit(await publishApp(userToken, 'daily', SOURCE));
            vi.restoreAllMocks();
            // restoreAllMocks drops the publish spy too.
            vi.spyOn(rateLimit, 'checkRateLimit').mockResolvedValue(true);
        }
        expect(await store().countForApp(userScope(userId))).toBe(0);
        expect(await store().countForApp(appHandlerScope(appUid))).toBe(0);
    });

    it('admits the 16th unit for a free user', async () => {
        holding(DEFAULT_FREE_SUBSCRIPTION, {
            workers: 10,
            scopes: 3,
            owned: 2,
        });
        expect((await publishUser(userToken, 'daily', SOURCE)).status).toBe(
            200,
        );
    });

    it('refuses a paid user the 101st unit and admits the 100th', async () => {
        holding('paid-plan', { workers: 90, scopes: 5, owned: 5 });
        refusedAsLimit(await publishUser(userToken, 'daily', SOURCE));

        vi.restoreAllMocks();
        vi.spyOn(rateLimit, 'checkRateLimit').mockResolvedValue(true);
        holding('paid-plan', { workers: 90, scopes: 5, owned: 4 });
        expect((await publishUser(userToken, 'daily', SOURCE)).status).toBe(
            200,
        );
    });

    it('never counts a publish into an existing scope as a new unit', async () => {
        await publishUser(userToken, 'first', SOURCE);
        await publishApp(userToken, 'first', SOURCE);

        holding(DEFAULT_FREE_SUBSCRIPTION, {
            workers: 16,
            scopes: 16,
            owned: 16,
        });
        expect(
            (await publishUser(userToken, 'second', OTHER_SOURCE)).status,
        ).toBe(200);
        expect((await publishUser(userToken, 'first', SOURCE)).status).toBe(
            200,
        );
        expect(
            (await publishApp(userToken, 'second', OTHER_SOURCE)).status,
        ).toBe(200);
        const inline = await subscribe(userToken, {
            subject: `fs:${anchor}`,
            queue: true,
            handlerSource: 'async () => { /* inline */ }',
        });
        expect(inline.status).toBe(200);
    });

    it('counts a batch`s first handler once, not once per item', async () => {
        holding(DEFAULT_FREE_SUBSCRIPTION, { workers: 15 });
        vi.mocked(
            store().countUserScopesWithHandlersForUser,
        ).mockImplementation(async () =>
            store().countForApp(userScope(userId)),
        );
        const batch = await call(
            'POST',
            '/events/handlers/publishAll',
            userToken,
            {
                scope: 'user',
                handlers: [
                    { name: 'a', source: SOURCE },
                    { name: 'b', source: OTHER_SOURCE },
                ],
            },
        );
        expect(batch.status).toBe(200);
    });
});

describe('subscription views', () => {
    it('reports `handlerScope` only on a user-scope row', async () => {
        await publishApp(userToken, 'app-handler', SOURCE);
        const appRow = await subscribe(userToken, {
            subject: `fs:${anchor}`,
            handlerName: 'app-handler',
        });
        const inline = await subscribe(userToken, {
            subject: `fs:${anchor}`,
            handlerSource: SOURCE,
        });

        const listed = (await call('GET', '/events/subscriptions', userToken))
            .body.items as DurableSubscriptionView[];
        const byId = new Map(listed.map((item) => [item.subId, item]));
        expect(
            byId.get(String(appRow.body.subId))?.handlerScope,
        ).toBeUndefined();
        expect(byId.get(String(inline.body.subId))?.handlerScope).toBe('user');
    });
});

describe('firing a user-scope row', () => {
    const inlineQueue = async () => {
        const created = await subscribe(userToken, {
            subject: `fs:${anchor}`,
            queue: true,
            handlerSource: SOURCE,
        });
        expect(created.status).toBe(200);
        return String(created.body.subId);
    };
    const withSeam = () => {
        const invoke = vi.fn().mockResolvedValue({ outcome: 'settled' });
        const previous = events().worker;
        events().worker = { invoke } as never;
        onTestFinished(() => {
            events().worker = previous;
        });
        return invoke;
    };
    const touchAnchor = async () => {
        await env.server.services.fs.touch(userId, {
            path: `${anchor}/${uuidv4()}.txt`,
        });
        await new Promise((resolve) => setTimeout(resolve, 300));
    };

    it('hands the seam the row with its scope and the handler it is bound to', async () => {
        const subId = await inlineQueue();
        const invoke = withSeam();

        await touchAnchor();

        expect(invoke).toHaveBeenCalledTimes(1);
        expect(invoke.mock.calls[0][0]).toMatchObject({
            subId,
            holderUserId: userId,
            appUid,
            handlerName: `@${hashContent(SOURCE)}`,
            handlerScope: 'user',
        });
    });

    it('leaves an app-scope row without a scope on its invocation', async () => {
        await publishApp(userToken, 'app-handler', SOURCE);
        await subscribe(userToken, {
            subject: `fs:${anchor}`,
            queue: true,
            handlerName: 'app-handler',
        });
        const invoke = withSeam();

        await touchAnchor();

        expect(invoke).toHaveBeenCalledTimes(1);
        expect(invoke.mock.calls[0][0].handlerScope).toBeUndefined();
    });

    it('leaves a delivery owed, unsuspended, with the flag off', async () => {
        const subId = await inlineQueue();
        const invoke = withSeam();
        (
            events() as unknown as { config: IConfig }
        ).config.events!.userHandlers = false;

        await touchAnchor();

        expect(invoke).not.toHaveBeenCalled();
        const row =
            await env.server.stores.durableSubscription.getBySubId(subId);
        expect(row?.suspendedAt).toBeNull();
        expect(await env.server.stores.pendingDelivery.depth(subId)).toBe(1);
    });
});

describe('a user-scope row with the flag off and no credit', () => {
    const rowOf = (subId: string) =>
        env.server.stores.durableSubscription.getBySubId(subId);
    const setup = async (delivery: 'queue' | 'broadcast') => {
        const created = await subscribe(userToken, {
            subject: `fs:${anchor}`,
            ...(delivery === 'queue' ? { queue: true } : {}),
            handlerSource: SOURCE,
        });
        expect(created.status).toBe(200);
        const appRow = await subscribe(userToken, {
            subject: `fs:${anchor}`,
            ...(delivery === 'queue' ? { queue: true } : {}),
            handlerName: 'app-handler',
        });
        (
            events() as unknown as { config: IConfig }
        ).config.events!.userHandlers = false;
        vi.spyOn(
            env.server.services.metering,
            'hasAnyUsageCached',
        ).mockResolvedValue(false);
        return {
            subId: String(created.body.subId),
            appSubId: String(appRow.body.subId),
        };
    };
    const touchAnchor = async () => {
        await env.server.services.fs.touch(userId, {
            path: `${anchor}/${uuidv4()}.txt`,
        });
        await new Promise((resolve) => setTimeout(resolve, 400));
    };

    it('suspends nothing, bills nothing and reaches no client for a queued row', async () => {
        await publishApp(userToken, 'app-handler', SOURCE);
        const { subId, appSubId } = await setup('queue');
        const meter = vi.spyOn(
            env.server.services.metering,
            'bufferIncrementUsages',
        );
        const socket = env.server.services.socket;
        vi.spyOn(socket, 'has').mockReturnValue(true);
        const send = vi.spyOn(socket, 'send');

        await touchAnchor();

        expect((await rowOf(subId))?.suspendedAt).toBeNull();
        expect(meter).not.toHaveBeenCalled();
        expect(send).not.toHaveBeenCalledWith(
            expect.anything(),
            expect.anything(),
            expect.objectContaining({ subId }),
        );
        expect(await env.server.stores.pendingDelivery.depth(subId)).toBe(1);
        // An app-scope row is judged as ever.
        expect((await rowOf(appSubId))?.suspendedReason).toBe('no_credit');
    });

    it('delivers nothing and bills nothing for a broadcast row', async () => {
        await publishApp(userToken, 'app-handler', SOURCE);
        const { subId } = await setup('broadcast');
        const meter = vi.spyOn(
            env.server.services.metering,
            'bufferIncrementUsages',
        );
        const send = vi.spyOn(env.server.services.socket, 'send');

        await touchAnchor();

        expect((await rowOf(subId))?.suspendedAt).toBeNull();
        expect(meter).not.toHaveBeenCalled();
        expect(send).not.toHaveBeenCalledWith(
            expect.anything(),
            expect.anything(),
            expect.objectContaining({ subId }),
        );
    });

    it('lets a schedule run on a user scope skip the credit gate', async () => {
        const { subId } = await setup('queue');
        expect(
            await events().chargeableForSchedule(userId, appUid, subId, 'user'),
        ).toBe(true);
        expect((await rowOf(subId))?.suspendedAt).toBeNull();
        expect(
            await events().chargeableForSchedule(userId, appUid, subId),
        ).toBe(false);
    });
});

describe('suspension notices', () => {
    it('tells the holder, and not the app`s developer, when their handler is removed under a row', async () => {
        const notify = vi.spyOn(env.server.services.notification, 'notify');
        await publishUser(otherToken, 'watcher', SOURCE);
        const created = await subscribe(otherToken, {
            subject: `fs:${otherAnchor}`,
            queue: true,
            handlerName: 'watcher',
            handlerScope: 'user',
        });
        expect(created.status).toBe(200);

        await removeUser(otherToken, 'watcher');

        await vi.waitFor(() =>
            expect(notify).toHaveBeenCalledWith(
                [otherUserId],
                expect.objectContaining({ handler: 'watcher' }),
                expect.objectContaining({
                    type: 'app.events.handler_suspended',
                    appUid,
                }),
            ),
        );
        expect(
            notify.mock.calls.some(
                ([, , options]) =>
                    (options as { type?: string }).type ===
                    'app.events.suspended',
            ),
        ).toBe(false);
        // The developer owns the app and is a different user from the holder.
        expect(
            notify.mock.calls.some(([recipients]) =>
                (recipients as number[]).includes(userId),
            ),
        ).toBe(false);
    });

    it('still tells the developer for a removed app-scope handler', async () => {
        const notify = vi.spyOn(env.server.services.notification, 'notify');
        await publishApp(userToken, 'app-watcher', SOURCE);
        await subscribe(otherToken, {
            subject: `fs:${otherAnchor}`,
            queue: true,
            handlerName: 'app-watcher',
        });

        await call('POST', '/events/handlers/remove', userToken, {
            name: 'app-watcher',
        });

        await vi.waitFor(() =>
            expect(notify).toHaveBeenCalledWith(
                [userId],
                expect.objectContaining({ handler: 'app-watcher' }),
                expect.objectContaining({ type: 'app.events.suspended' }),
            ),
        );
    });
});

describe('the unbound handler sweep', () => {
    const DAY = 24 * 60 * 60;
    const age = (scope: HandlerScope, name: string, seconds: number) => {
        const table =
            scope.holder === 0 ? 'event_handlers' : 'event_user_handlers';
        return env.server.clients.db.write(
            `UPDATE \`${table}\` SET \`updated_at\` = ? WHERE \`app_uid\` = ? AND \`name\` = ?`,
            [Math.floor(Date.now() / 1000) - seconds, scope.appUid, name],
        );
    };
    const names = async (scope: HandlerScope) =>
        (await store().listForApp(scope)).map((handler) => handler.name);

    it('deletes an unbound handler past a day, and keeps a younger one', async () => {
        await publishUser(userToken, 'old', SOURCE);
        await publishUser(userToken, 'young', OTHER_SOURCE);
        await age(userScope(userId), 'old', DAY + 60);
        await age(userScope(userId), 'young', DAY - 600);

        expect(
            await events().sweepUnboundUserHandlers(),
        ).toBeGreaterThanOrEqual(1);

        expect(await names(userScope(userId))).toEqual(['young']);
    });

    it('keeps a handler a row is bound to, including a suspended one', async () => {
        const created = await subscribe(userToken, {
            subject: `fs:${anchor}`,
            queue: true,
            handlerSource: SOURCE,
        });
        const name = String(created.body.handlerName);
        const row = (await env.server.stores.durableSubscription.getBySubId(
            String(created.body.subId),
        ))!;
        await events().suspendSubscriptions([row], 'failures');
        await age(userScope(userId), name, 3 * DAY);

        await events().sweepUnboundUserHandlers();

        expect(await names(userScope(userId))).toEqual([name]);

        // Once nothing is bound to it, it goes.
        await env.server.clients.db.write(
            'DELETE FROM `event_subscriptions` WHERE `sub_id` = ?',
            [row.subId],
        );
        await events().sweepUnboundUserHandlers();
        expect(await names(userScope(userId))).toEqual([]);
    });

    it('leaves app-scope handlers alone, however old', async () => {
        await publishApp(userToken, 'app-old', SOURCE);
        await age(appHandlerScope(appUid), 'app-old', 30 * DAY);

        await events().sweepUnboundUserHandlers();

        expect(await names(appHandlerScope(appUid))).toEqual(['app-old']);
    });

    it('drops the cached set of a scope it deleted from', async () => {
        await publishUser(userToken, 'old', SOURCE);
        // Warm the scope's cached set.
        await store().cachedSetForApp(userScope(userId));
        await age(userScope(userId), 'old', 2 * DAY);

        await events().sweepUnboundUserHandlers();

        expect(
            await store().cachedSetForApp(userScope(userId), {
                handlerName: 'old',
            }),
        ).toEqual([]);
    });

    it('stops when its signal is aborted', async () => {
        await publishUser(userToken, 'old', SOURCE);
        await age(userScope(userId), 'old', 2 * DAY);
        const controller = new AbortController();
        controller.abort();

        expect(await events().sweepUnboundUserHandlers(controller.signal)).toBe(
            0,
        );
        expect(await names(userScope(userId))).toEqual(['old']);
    });

    it('is registered as a fleet job', () => {
        expect(() =>
            env.server.services.jobs.register('events.userHandlers.gc', {
                every: 1000,
                scope: 'fleet',
                run: async () => {},
            }),
        ).toThrow('already registered');
    });
});

describe('cached rows written by a node without scope markers', () => {
    const sub = () => env.server.stores.eventSubscription;
    const keyOf = (row: { ownerUserId: number; token: string }) =>
        `ev:t:{${row.ownerUserId}}:${row.token}`;
    const dbReads = () => {
        const db = env.server.clients.db;
        const spies = [vi.spyOn(db, 'read'), vi.spyOn(db, 'pread')];
        return () => spies.reduce((sum, spy) => sum + spy.mock.calls.length, 0);
    };
    /** What an older node leaves in the cache: the row with no scope at all. */
    const asOldNodeCached = async (subId: string) => {
        const row =
            (await env.server.stores.durableSubscription.getBySubId(subId))!;
        const { handlerScope: _scope, ...bare } = row;
        void _scope;
        await env.server.clients.redis.hset(
            keyOf(row),
            subId,
            JSON.stringify(bare),
        );
        return row;
    };

    it('resolves an unmarked user row as user scope, and marks the entry', async () => {
        const created = await subscribe(userToken, {
            subject: `fs:${anchor}`,
            queue: true,
            handlerSource: SOURCE,
        });
        const subId = String(created.body.subId);
        const row = await asOldNodeCached(subId);

        const [read] = await sub().getForTokens(row.ownerUserId, [row.token]);
        expect(read).toMatchObject({ subId, handlerScope: 'user' });
        expect('sc' in read).toBe(false);

        const stored = JSON.parse(
            (await env.server.clients.redis.hget(keyOf(row), subId))!,
        );
        expect(stored).toMatchObject({ sc: 1, handlerScope: 'user' });
    });

    it('resolves an unmarked app row as app scope', async () => {
        await publishApp(userToken, 'app-handler', SOURCE);
        const created = await subscribe(userToken, {
            subject: `fs:${anchor}`,
            queue: true,
            handlerName: 'app-handler',
        });
        const subId = String(created.body.subId);
        const row = await asOldNodeCached(subId);

        const [read] = await sub().getForTokens(row.ownerUserId, [row.token]);
        expect(read.handlerScope).toBeUndefined();
        const stored = JSON.parse(
            (await env.server.clients.redis.hget(keyOf(row), subId))!,
        );
        expect(stored.sc).toBe(1);
    });

    it('reads nothing extra once every cached row is marked', async () => {
        const created = await subscribe(userToken, {
            subject: `fs:${anchor}`,
            queue: true,
            handlerSource: SOURCE,
        });
        const row = (await env.server.stores.durableSubscription.getBySubId(
            String(created.body.subId),
        ))!;
        await sub().cacheDurable([row]);
        const reads = dbReads();

        const [read] = await sub().getForTokens(row.ownerUserId, [row.token]);
        const again = await sub().getForTokens(row.ownerUserId, [row.token], {
            perToken: 5,
        });

        expect(read.handlerScope).toBe('user');
        expect(again[0].handlerScope).toBe('user');
        expect(reads()).toBe(0);
    });

    it('drops a cached entry no table row backs, paying the lookup once', async () => {
        const created = await subscribe(userToken, {
            subject: `fs:${anchor}`,
            queue: true,
            handlerSource: SOURCE,
        });
        const row = (await env.server.stores.durableSubscription.getBySubId(
            String(created.body.subId),
        ))!;
        const ghost = { ...row, subId: `ghost-${uuidv4()}` };
        const { handlerScope: _scope, ...bare } = ghost;
        void _scope;
        await env.server.clients.redis.hset(
            keyOf(row),
            ghost.subId,
            JSON.stringify(bare),
        );
        const reads = dbReads();

        const first = await sub().getForTokens(row.ownerUserId, [row.token]);
        const afterFirst = reads();
        const second = await sub().getForTokens(row.ownerUserId, [row.token]);

        expect(first.map((r) => r.subId)).not.toContain(ghost.subId);
        expect(second.map((r) => r.subId)).not.toContain(ghost.subId);
        expect(afterFirst).toBeGreaterThan(0);
        expect(reads()).toBe(afterFirst);
        expect(
            await env.server.clients.redis.hget(keyOf(row), ghost.subId),
        ).toBe(null);
    });

    it('fails the read like a database outage, returning no row as app scope', async () => {
        const created = await subscribe(userToken, {
            subject: `fs:${anchor}`,
            queue: true,
            handlerSource: SOURCE,
        });
        const subId = String(created.body.subId);
        const row = await asOldNodeCached(subId);
        const db = env.server.clients.db;
        const down = new Error('db down');
        const read = vi.spyOn(db, 'read').mockRejectedValue(down);
        const pread = vi.spyOn(db, 'pread').mockRejectedValue(down);
        const invoke = vi.fn();
        const previous = events().worker;
        events().worker = { invoke } as never;
        onTestFinished(() => {
            events().worker = previous;
        });

        await expect(
            sub().getForTokens(row.ownerUserId, [row.token]),
        ).rejects.toThrow('db down');
        await expect(
            sub().getForTokens(row.ownerUserId, [row.token], { perToken: 5 }),
        ).rejects.toThrow('db down');
        expect(invoke).not.toHaveBeenCalled();

        // Once the table answers, the entry resolves as the user row it is.
        read.mockRestore();
        pread.mockRestore();
        const [again] = await sub().getForTokens(row.ownerUserId, [row.token]);
        expect(again.handlerScope).toBe('user');
    });

    it('does not bring back a row dropped while it was being resolved', async () => {
        const created = await subscribe(userToken, {
            subject: `fs:${anchor}`,
            queue: true,
            handlerSource: SOURCE,
        });
        const subId = String(created.body.subId);
        const row = await asOldNodeCached(subId);
        const real = env.server.clients.db.read.bind(env.server.clients.db);
        vi.spyOn(env.server.clients.db, 'read').mockImplementation(
            async (...args) => {
                await env.server.clients.redis.hdel(keyOf(row), subId);
                return real(...args);
            },
        );

        await sub().getForTokens(row.ownerUserId, [row.token]);

        expect(await env.server.clients.redis.hget(keyOf(row), subId)).toBe(
            null,
        );
    });
});

void foreignAppToken;
