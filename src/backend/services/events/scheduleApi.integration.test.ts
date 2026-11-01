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
 * The schedule routes end to end: create, list, read and remove over HTTP, who
 * each credential may see, every refusal a create can answer, the budgets they
 * share with the subscription verbs, and when a schedule says it runs next.
 */

import {
    afterAll,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import {
    EVENTS_LIST_LIMIT,
    EVENTS_SCHEDULE_FIRE_BUDGET_PER_APP,
    EVENTS_SCHEDULE_SCAN_CONCURRENCY,
    EVENTS_SCHEDULE_SCAN_QUEUE,
    EVENTS_SCHEDULES_PER_APP,
    EVENTS_SUBSCRIBE_LIMIT,
    EVENTS_UNSUBSCRIBE_LIMIT,
    limitFor,
} from '../../controllers/events/limits.js';
import type { Actor } from '../../core/actor.js';
import { checkRateLimit } from '../../core/http/middleware/rateLimit.js';
import { DURABLE_CONTEXT_MAX_BYTES } from '../../stores/events/DurableSubscriptionStore.js';
import { hashContent } from '../../stores/events/EventHandlerStore.js';
import type { RouteRateLimit } from '../../core/http/types.js';
import { actorPlanId } from '../metering/enforcement.js';
import { cronFirstAtOrAfter, scanCron } from './scheduleCron.js';
import { spreadOffsetMs } from './scheduleSlots.js';
import {
    bootScheduleHarness,
    seedSchedules,
    SCHEDULE_TEST_HANDLER,
    type ScheduleHarness,
} from './scheduleTestUtil.js';

const BOOT_TIMEOUT_MS = 120_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

let harness: ScheduleHarness;
let userId: number;
let otherUserId: number;
let sessionToken: string;
let session: Actor;
let app: { uid: string; token: string };

interface ApiResponse {
    status: number;
    body: Record<string, unknown>;
}

const server = () => harness.env.server;
const db = () => server().clients.db;

const call = async (
    method: 'GET' | 'POST',
    path: string,
    token: string,
    body?: object,
): Promise<ApiResponse> => {
    const response = await fetch(new URL(path, harness.env.apiOrigin), {
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

const create = (token: string, body: object): Promise<ApiResponse> =>
    call('POST', '/events/schedules', token, body);

const createEvery = (token: string, extra: object = {}) =>
    create(token, {
        every: '1h',
        handlerName: SCHEDULE_TEST_HANDLER,
        ...extra,
    });

const list = (token: string, query = ''): Promise<ApiResponse> =>
    call('GET', `/events/schedules${query}`, token);

const get = (token: string, scheduleId: string): Promise<ApiResponse> =>
    call('GET', `/events/schedules/${encodeURIComponent(scheduleId)}`, token);

const remove = (token: string, scheduleId: unknown): Promise<ApiResponse> =>
    call('POST', '/events/schedules/remove', token, { scheduleId });

const idsOf = (response: ApiResponse): string[] =>
    (response.body.items as Array<{ scheduleId: string }>).map(
        (item) => item.scheduleId,
    );

/** An app of the user's, consented to and with the test handler published. */
const makeApp = async (): Promise<{ uid: string; token: string }> => {
    const { uid } = await harness.makeApp();
    return {
        uid,
        token: await server().services.auth.getUserAppToken(session, uid),
    };
};

/**
 * A token scoped to reading the user's home folder, issued by `issuer`. An app
 * issuer is granted that read first, since it can only pass on what it holds.
 */
const scopedToken = async (issuer: Actor): Promise<string> => {
    const home = await server().stores.fsEntry.getEntryByPath(
        `/${harness.env.users.user.username}`,
    );
    const permission = `fs:${home!.uid}:read`;
    if (issuer.effectiveApp)
        await server().services.permission.grantUserAppPermission(
            session,
            issuer.effectiveApp.uid,
            permission,
        );
    return server().services.auth.createAccessToken(issuer, [[permission]], {
        label: 'schedules',
    });
};

const subIdOf = async (scheduleId: string): Promise<string> => {
    const row = await server().stores.schedule.get(
        server().services.schedule.namespace,
        scheduleId,
    );
    return row!.subId!;
};

const resetBudget = (limit: RouteRateLimit) =>
    server().clients.redis.del(`rate:${limit.scope}:${userId}`);

/** Spend a per-user window down to its last call. */
const spendAllButOne = async (limit: RouteRateLimit) => {
    for (let i = 0; i < limit.limit - 1; i++)
        await checkRateLimit(
            `${limit.scope}:${userId}`,
            limit.limit,
            limit.window,
        );
};

const scheduleConfig = () =>
    (
        server().services.schedule as unknown as {
            config: { events: { schedules: { enabled: boolean } } };
        }
    ).config.events.schedules;

beforeAll(async () => {
    harness = await bootScheduleHarness();
    userId = harness.userId;
    sessionToken = harness.env.users.user.token;
    session = (await server().services.auth.authenticate(sessionToken)).actor!;
    const other = await server().stores.user.getByUsername(
        harness.env.users.other.username,
    );
    otherUserId = other!.id;
    app = await makeApp();
}, BOOT_TIMEOUT_MS);

afterAll(async () => {
    vi.useRealTimers();
    await harness?.shutdown();
});

beforeEach(async () => {
    await db().write('DELETE FROM `event_schedules`', []);
    await db().write('DELETE FROM `event_subscriptions`', []);
    for (const limit of [
        EVENTS_SUBSCRIBE_LIMIT,
        EVENTS_UNSUBSCRIBE_LIMIT,
        EVENTS_LIST_LIMIT,
    ])
        await resetBudget(limit);
});

describe('creating a schedule', () => {
    it('answers an `every` schedule with its definition and first run', async () => {
        const before = Date.now();
        const created = await createEvery(app.token, {
            context: { team: 'design' },
        });

        expect(created.status).toBe(200);
        const body = created.body;
        expect(body).toMatchObject({
            kind: 'recurring',
            appUid: app.uid,
            handlerName: SCHEDULE_TEST_HANDLER,
            contextKeys: ['team'],
            every: HOUR,
            cron: null,
            tz: 'UTC',
            endsAt: null,
            state: 'active',
            suspendedReason: null,
            endReason: null,
            endedAt: null,
        });
        expect(body.scheduleId).toMatch(/^[0-9a-f-]{36}$/);
        expect(body.contextHash).toBe(hashContent('{"team":"design"}'));
        // Values never come back.
        expect(body.context).toBeUndefined();
        // No startAt: the first run is one interval after create.
        expect(body.nextRunAt).toBe(body.startAt);
        expect(body.startAt as number).toBeGreaterThan(before + HOUR - 1000);
        expect(body.startAt as number).toBeLessThanOrEqual(
            Date.now() + HOUR + 1000,
        );
    });

    it('answers a cron schedule in its time zone', async () => {
        const created = await create(app.token, {
            cron: '0 9 * * 1-5',
            tz: 'America/New_York',
            handlerName: SCHEDULE_TEST_HANDLER,
        });

        expect(created.status).toBe(200);
        const body = created.body;
        expect(body).toMatchObject({
            kind: 'recurring',
            every: null,
            cron: '0 9 * * 1-5',
            tz: 'America/New_York',
        });
        expect(body.nextRunAt).toBe(
            cronFirstAtOrAfter(
                '0 9 * * 1-5',
                'America/New_York',
                body.createdAt as number,
            ),
        );
        const local = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/New_York',
            weekday: 'short',
            hour: '2-digit',
            minute: '2-digit',
            hourCycle: 'h23',
        }).format(new Date(body.nextRunAt as number));
        expect(local).toMatch(/^(Mon|Tue|Wed|Thu|Fri) 09:00$/);
    });

    it('answers a one-shot at its time, rounded up to the second', async () => {
        const at = Date.now() + 10 * 60_000 + 250;
        const created = await create(app.token, {
            at,
            handlerName: SCHEDULE_TEST_HANDLER,
        });

        expect(created.status).toBe(200);
        const rounded = Math.ceil(at / 1000) * 1000;
        expect(created.body).toMatchObject({
            kind: 'once',
            every: null,
            cron: null,
            startAt: rounded,
            endsAt: rounded,
            nextRunAt: rounded,
            state: 'active',
        });
    });

    it('runs an aligned schedule from its next slot, never a back-fill', async () => {
        const created = await createEvery(app.token, {
            every: '1d',
            startAt: '2026-01-01T00:00:00Z',
        });

        expect(created.status).toBe(200);
        const next = created.body.nextRunAt as number;
        const createdAt = created.body.createdAt as number;
        expect(next % DAY).toBe(0);
        expect(next).toBeGreaterThanOrEqual(createdAt);
        expect(next - createdAt).toBeLessThanOrEqual(DAY);
    });

    it('takes the handler source it names, and refuses another', async () => {
        const handler = await server().stores.eventHandler.getByName(
            app.uid,
            SCHEDULE_TEST_HANDLER,
        );
        const bound = await createEvery(app.token, {
            handlerHash: handler!.sourceHash,
        });
        expect(bound.status).toBe(200);

        const refused = await createEvery(app.token, {
            handlerHash: hashContent('something else'),
        });
        expect(refused.status).toBe(409);
        expect(refused.body.code).toBe('events_handler_hash_mismatch');
    });
});

describe('what a create refuses', () => {
    const refusals: Array<[string, object, number, string]> = [
        [
            'more than one kind',
            { every: '1h', cron: '0 * * * *' },
            400,
            'events_schedule_invalid',
        ],
        ['no kind', {}, 400, 'events_schedule_invalid'],
        [
            'a cron extension',
            { cron: '0 0 L * *' },
            400,
            'events_schedule_invalid',
        ],
        [
            'a tz without cron',
            { every: '1h', tz: 'UTC' },
            400,
            'events_schedule_invalid',
        ],
        [
            'a zone-less time',
            { at: '2027-01-01T10:00' },
            400,
            'events_schedule_invalid',
        ],
        [
            'maxRuns out of range',
            { every: '1h', maxRuns: 100_001 },
            400,
            'events_schedule_invalid',
        ],
        [
            'a cron that never runs',
            { cron: '0 0 30 2 *' },
            400,
            'events_schedule_never_fires',
        ],
        [
            'an end before the first run',
            { every: '1h', expiresAt: '2026-01-01' },
            400,
            'events_schedule_never_fires',
        ],
        [
            'an interval under the plan minimum',
            { every: '30s' },
            400,
            'events_schedule_too_frequent',
        ],
        [
            'a context over the cap',
            {
                every: '1h',
                context: { blob: 'x'.repeat(DURABLE_CONTEXT_MAX_BYTES) },
            },
            413,
            'events_context_too_large',
        ],
    ];

    for (const [what, body, status, code] of refusals)
        it(`answers ${what} with ${code}`, async () => {
            const response = await create(app.token, {
                handlerName: SCHEDULE_TEST_HANDLER,
                ...body,
            });
            expect(response.status).toBe(status);
            expect(response.body.code).toBe(code);
        });

    it('needs a handler name, and one that is published', async () => {
        const unnamed = await create(app.token, { every: '1h' });
        expect(unnamed.status).toBe(400);
        expect(unnamed.body.code).toBe('events_handler_required');

        const missing = await createEvery(app.token, {
            handlerName: 'missing',
        });
        expect(missing.status).toBe(404);
        expect(missing.body.code).toBe('events_handler_not_found');
    });

    it('needs an app, not the account', async () => {
        const refused = await createEvery(sessionToken);
        expect(refused.status).toBe(403);
        expect(refused.body.code).toBe('events_schedule_app_required');
    });

    it('refuses a scoped token, even one the app issued', async () => {
        const appActor = (await server().services.auth.authenticate(app.token))
            .actor!;
        const scoped = await scopedToken(appActor);
        const refused = await createEvery(scoped);
        expect(refused.status).toBe(403);
        expect(refused.body.code).toBe('events_durable_requires_account');
    });

    it('needs the holder`s background consent for the app', async () => {
        const unconsented = await makeApp();
        await server().services.permission.revokeUserAppPermission(
            session,
            unconsented.uid,
            'events:background',
        );
        const refused = await createEvery(unconsented.token);
        expect(refused.status).toBe(403);
        expect(refused.body.code).toBe('events_background_consent_required');
    });

    it('holds an app to its schedule count, however many race for the last slot', async () => {
        const plan = await actorPlanId(server().services.metering, session);
        const cap = limitFor(EVENTS_SCHEDULES_PER_APP, plan);
        await seedSchedules(server(), {
            namespace: server().services.schedule.namespace,
            region: server().services.schedule.region,
            holderUserId: userId,
            appUid: app.uid,
            count: cap - 1,
            startAt: Date.now() + DAY,
            everyMs: DAY,
            createdAt: Date.now(),
        });

        const results = await Promise.all(
            Array.from({ length: 5 }, () =>
                createEvery(app.token, { every: '1d' }),
            ),
        );
        // Each recounts after its insert, so a race may leave the slot empty
        // but never fills it twice.
        const won = results.filter((r) => r.status === 200);
        expect(won.length).toBeLessThanOrEqual(1);
        for (const r of results.filter((r) => r.status !== 200)) {
            expect(r.status).toBe(429);
            expect(r.body.code).toBe('events_schedule_limit');
        }
        const [live] = await db().read(
            'SELECT COUNT(*) AS `n` FROM `event_schedules` ' +
                'WHERE `app_uid` = ? AND `deleted_at` IS NULL',
            [app.uid],
        );
        expect(Number(live.n)).toBe(cap - 1 + won.length);

        const over = await createEvery(app.token, { every: '1d' });
        if (won.length === 1) {
            expect(over.status).toBe(429);
            expect(over.body.code).toBe('events_schedule_limit');
        } else expect(over.status).toBe(200);
    });

    it('holds an app to its fire budget', async () => {
        const plan = await actorPlanId(server().services.metering, session);
        const budget = limitFor(EVENTS_SCHEDULE_FIRE_BUDGET_PER_APP, plan);
        // Every minute is 60 runs an hour, stored ×1000.
        await seedSchedules(server(), {
            namespace: server().services.schedule.namespace,
            region: server().services.schedule.region,
            holderUserId: userId,
            appUid: app.uid,
            count: Math.floor(budget / 60_000),
            startAt: Date.now() + HOUR,
            everyMs: 60_000,
            createdAt: Date.now(),
        });

        const refused = await createEvery(app.token);
        expect(refused.status).toBe(429);
        expect(refused.body.code).toBe('events_schedule_budget');
    });

    it('answers busy while too many cron checks are queued', async () => {
        const from = Date.now();
        // `nth` skips the result cache, so each one walks; on a loaded runner
        // the queue behind the gate takes seconds to drain.
        const fills = Array.from(
            {
                length:
                    EVENTS_SCHEDULE_SCAN_CONCURRENCY +
                    EVENTS_SCHEDULE_SCAN_QUEUE,
            },
            () => scanCron('*/2 * * * *', 'UTC', from, { nth: 10_000 }),
        );
        try {
            const refused = await create(app.token, {
                cron: '17 */3 * * *',
                handlerName: SCHEDULE_TEST_HANDLER,
            });
            expect(refused.status).toBe(503);
            expect(refused.body.code).toBe('events_schedule_busy');
        } finally {
            await Promise.allSettled(fills);
        }
    }, 60_000);
});

describe('a plan`s schedules', () => {
    const metering = () =>
        server().services.metering as unknown as {
            config: { unlimitedMetering?: boolean };
            invalidateActorSubscription: (uuid: string) => void;
        };

    const withPlans = async (
        email: string | null,
        run: () => Promise<void>,
    ): Promise<void> => {
        const user = await server().stores.user.getById(userId);
        const saved = metering().config.unlimitedMetering;
        metering().config.unlimitedMetering = false;
        await server().stores.user.update(userId, { email });
        metering().invalidateActorSubscription(user!.uuid);
        try {
            await run();
        } finally {
            metering().config.unlimitedMetering = saved;
            await server().stores.user.update(userId, {
                email: (user as { email?: string | null }).email ?? null,
            });
            metering().invalidateActorSubscription(user!.uuid);
        }
    };

    it('refuses a temporary account', async () => {
        await withPlans(null, async () => {
            const refused = await createEvery(app.token);
            expect(refused.status).toBe(403);
            expect(refused.body.code).toBe('events_durable_requires_account');
        });
    });

    it('holds a free account to its own minimum interval', async () => {
        await withPlans(`${uuidv4()}@example.invalid`, async () => {
            const refused = await createEvery(app.token, { every: '5m' });
            expect(refused.status).toBe(400);
            expect(refused.body.code).toBe('events_schedule_too_frequent');

            const cron = await create(app.token, {
                cron: '*/5 * * * *',
                handlerName: SCHEDULE_TEST_HANDLER,
            });
            expect(cron.status).toBe(400);
            expect(cron.body.code).toBe('events_schedule_too_frequent');

            const allowed = await createEvery(app.token, { every: '15m' });
            expect(allowed.status).toBe(200);
        });
    });
});

describe('listing and reading schedules', () => {
    it('confines an app to its own and lets the account see across apps', async () => {
        const second = await makeApp();
        const mine = (await createEvery(app.token)).body.scheduleId as string;
        const theirs = (await createEvery(second.token)).body
            .scheduleId as string;

        expect(idsOf(await list(app.token))).toEqual([mine]);
        expect(idsOf(await list(second.token))).toEqual([theirs]);
        expect(idsOf(await list(sessionToken))).toEqual([mine, theirs]);
    });

    it('pages with a cursor and totals the scope, not the page', async () => {
        const ids: string[] = [];
        for (let i = 0; i < 3; i++)
            ids.push((await createEvery(app.token)).body.scheduleId as string);

        const first = await list(app.token, '?limit=2&includeTotal=true');
        expect(first.status).toBe(200);
        expect(idsOf(first)).toEqual(ids.slice(0, 2));
        expect(first.body.total).toBe(3);
        expect(typeof first.body.cursor).toBe('string');

        const second = await list(
            app.token,
            `?limit=2&cursor=${encodeURIComponent(first.body.cursor as string)}`,
        );
        expect(idsOf(second)).toEqual(ids.slice(2));
        expect(second.body.cursor).toBeUndefined();
        expect(second.body.total).toBeUndefined();
    });

    it('reads one by id, as the list reports it', async () => {
        const created = (await createEvery(app.token)).body;
        const read = await get(app.token, created.scheduleId as string);
        expect(read.status).toBe(200);
        expect(read.body).toEqual(created);
        const [listed] = (await list(app.token)).body.items as unknown[];
        expect(listed).toEqual(created);
    });

    it('answers another app`s, another holder`s, an unknown and a malformed id alike', async () => {
        const second = await makeApp();
        const theirs = (await createEvery(second.token)).body
            .scheduleId as string;
        const othersRow = await harness.createSchedule(
            { uid: app.uid },
            { holderUserId: otherUserId },
        );

        for (const id of [theirs, othersRow.uid, uuidv4(), 'not-an-id']) {
            const read = await get(app.token, id);
            expect(read.status).toBe(404);
            expect(read.body.code).toBe('events_schedule_not_found');
        }
        // The account sees its own apps' schedules, never another holder's.
        expect((await get(sessionToken, theirs)).status).toBe(200);
        expect((await get(sessionToken, othersRow.uid)).status).toBe(404);
    });

    it('shows a scoped token none of them', async () => {
        const created = (await createEvery(app.token)).body
            .scheduleId as string;
        const scoped = await scopedToken(session);

        const listed = await list(scoped);
        expect(listed.status).toBe(200);
        expect(listed.body.items).toEqual([]);
        expect((await get(scoped, created)).status).toBe(404);
        expect((await remove(scoped, created)).status).toBe(404);
        expect((await get(app.token, created)).body.state).toBe('active');
    });
});

describe('when a schedule runs next', () => {
    it('moves to the next slot once a slot`s spread has passed', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        try {
            const created = (await createEvery(app.token)).body;
            const id = created.scheduleId as string;
            const first = created.nextRunAt as number;
            const offset = spreadOffsetMs(id, 'recurring', HOUR);

            vi.setSystemTime(first + offset);
            expect((await get(app.token, id)).body.nextRunAt).toBe(first);

            vi.setSystemTime(first + offset + 1);
            expect((await get(app.token, id)).body.nextRunAt).toBe(
                first + HOUR,
            );
        } finally {
            vi.useRealTimers();
        }
    });

    it('says nothing while suspended, and why', async () => {
        const id = (await createEvery(app.token)).body.scheduleId as string;
        await server().services.events.suspendForNoCredit(await subIdOf(id));

        const read = await get(app.token, id);
        expect(read.body).toMatchObject({
            state: 'suspended',
            suspendedReason: 'no_credit',
            nextRunAt: null,
            endReason: null,
        });
    });

    it('says nothing once ended, and why', async () => {
        const id = (await createEvery(app.token, { maxRuns: 2 })).body
            .scheduleId as string;
        const row = await server().stores.schedule.get(
            server().services.schedule.namespace,
            id,
        );
        await server().stores.schedule.end([row!], 'ended');

        const read = await get(app.token, id);
        expect(read.body).toMatchObject({
            state: 'ended',
            endReason: 'ended',
            nextRunAt: null,
            handlerName: null,
        });
        expect(read.body.endedAt).toEqual(expect.any(Number));
    });

    it('reports a one-shot`s end as its only run', async () => {
        const at = Date.now() + HOUR;
        const created = await create(app.token, {
            at,
            handlerName: SCHEDULE_TEST_HANDLER,
        });
        expect(created.body.endsAt).toBe(created.body.startAt);
        expect(created.body.nextRunAt).toBe(created.body.startAt);
    });
});

describe('removing a schedule', () => {
    it('ends it, keeps it listed with why, and answers a second remove as absent', async () => {
        const id = (await createEvery(app.token)).body.scheduleId as string;

        const removed = await remove(app.token, id);
        expect(removed.status).toBe(200);
        expect(removed.body).toEqual({});

        const read = await get(app.token, id);
        expect(read.body).toMatchObject({
            state: 'ended',
            endReason: 'removed',
            nextRunAt: null,
        });
        expect(idsOf(await list(app.token))).toEqual([id]);

        const again = await remove(app.token, id);
        expect(again.status).toBe(404);
        expect(again.body.code).toBe('events_schedule_not_found');
    });

    it('lets the account remove what an app left behind, but not another app', async () => {
        const second = await makeApp();
        const id = (await createEvery(app.token)).body.scheduleId as string;

        const foreign = await remove(second.token, id);
        expect(foreign.status).toBe(404);
        expect(foreign.body.code).toBe('events_schedule_not_found');

        expect((await remove(sessionToken, id)).status).toBe(200);
    });

    it('answers ids it cannot hold as absent', async () => {
        for (const id of [uuidv4(), 'nope', 42, undefined]) {
            const response = await remove(app.token, id);
            expect(response.status).toBe(404);
            expect(response.body.code).toBe('events_schedule_not_found');
        }
    });

    it('refuses a delayed send that has started', async () => {
        const [id] = await seedSchedules(server(), {
            namespace: server().services.schedule.namespace,
            region: server().services.schedule.region,
            holderUserId: userId,
            appUid: app.uid,
            count: 1,
            startAt: Date.now() + HOUR,
            everyMs: HOUR,
            createdAt: Date.now(),
            deferred: true,
        });
        await db().write(
            "UPDATE `event_schedules` SET `state` = 'sending' WHERE `uid` = ?",
            [id],
        );

        const refused = await remove(app.token, id);
        expect(refused.status).toBe(409);
        expect(refused.body.code).toBe('events_schedule_sending');
    });
});

describe('the subscription verbs on a schedule`s row', () => {
    it('refuse to change its context', async () => {
        const id = (await createEvery(app.token)).body.scheduleId as string;
        const refused = await call(
            'POST',
            '/events/subscriptions/update',
            app.token,
            { subId: await subIdOf(id), context: { team: 'other' } },
        );
        expect(refused.status).toBe(400);
        expect(refused.body.code).toBe('events_schedule_immutable');
    });

    it('refuse to unsubscribe it', async () => {
        const id = (await createEvery(app.token)).body.scheduleId as string;
        const refused = await call('POST', '/events/unsubscribe', app.token, {
            subId: await subIdOf(id),
        });
        expect(refused.status).toBe(404);
        expect(refused.body.code).toBe('events_schedule_not_found');
        expect((await get(app.token, id)).body.state).toBe('active');
    });

    it('leave it out of the durable listing', async () => {
        await createEvery(app.token);
        const listed = await call('GET', '/events/subscriptions', app.token);
        expect(listed.body.items).toEqual([]);
    });
});

describe('the budgets the schedule verbs share', () => {
    it('spends the subscribe budget on a create, even one refused', async () => {
        await spendAllButOne(EVENTS_SUBSCRIBE_LIMIT);
        const invalid = await create(app.token, {
            handlerName: SCHEDULE_TEST_HANDLER,
        });
        expect(invalid.status).toBe(400);

        const create429 = await createEvery(app.token);
        expect(create429.status).toBe(429);
        expect(create429.body.code).toBe('too_many_requests');
        const subscribe = await call(
            'POST',
            '/events/subscribe',
            sessionToken,
            {
                subject: `fs:/${harness.env.users.user.username}`,
            },
        );
        expect(subscribe.status).toBe(429);
        expect(subscribe.body.code).toBe('too_many_requests');
    });

    it('spends the unsubscribe budget on a remove, even a miss', async () => {
        const id = (await createEvery(app.token)).body.scheduleId as string;
        await spendAllButOne(EVENTS_UNSUBSCRIBE_LIMIT);
        expect((await remove(app.token, uuidv4())).status).toBe(404);

        const refused = await remove(app.token, id);
        expect(refused.status).toBe(429);
        expect(refused.body.code).toBe('too_many_requests');
        const unsubscribe = await call(
            'POST',
            '/events/unsubscribe',
            sessionToken,
            { subId: `${app.uid}#${uuidv4()}` },
        );
        expect(unsubscribe.status).toBe(429);
    });

    it('spends the listing budget on a list and a read', async () => {
        const id = (await createEvery(app.token)).body.scheduleId as string;
        await spendAllButOne(EVENTS_LIST_LIMIT);
        expect((await list(sessionToken)).status).toBe(200);

        const refused = await get(sessionToken, id);
        expect(refused.status).toBe(429);
        expect(refused.body.code).toBe('too_many_requests');
        const subscriptions = await call(
            'GET',
            '/events/subscriptions',
            sessionToken,
        );
        expect(subscriptions.status).toBe(429);
    });
});

describe('with schedules switched off', () => {
    it('answers every route with one code', async () => {
        const id = (await createEvery(app.token)).body.scheduleId as string;
        scheduleConfig().enabled = false;
        try {
            for (const attempt of [
                createEvery(app.token),
                list(app.token),
                get(app.token, id),
                remove(app.token, id),
            ]) {
                const response = await attempt;
                expect(response.status).toBe(503);
                expect(response.body.code).toBe('events_disabled');
            }
        } finally {
            scheduleConfig().enabled = true;
        }
    });
});
