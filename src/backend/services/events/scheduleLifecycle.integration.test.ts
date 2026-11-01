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
import {
    EVENTS_CONSECUTIVE_FAILURES,
    EVENTS_SCHEDULE_SUSPENDED_HOLDER_DEFER_MS,
    EVENTS_WORKER_INVOCATION_LIMIT,
    deliveryBackoffMs,
} from '../../controllers/events/limits.js';
import { createHmac } from 'node:crypto';
import { makeActor } from '../../core/actor.js';
import { runWithContext } from '../../core/context.js';
import { checkRateLimit } from '../../core/http/middleware/rateLimit.js';
import { isHttpError } from '../../core/http/HttpError.js';
import { scheduleToken } from '../../stores/events/types.js';
import { EVENTS_BACKGROUND_PERMISSION } from './authorization.js';
import { SCHEDULE_FINALIZE_RETRY_MS } from './ScheduleRunner.js';
import {
    bootScheduleHarness,
    freezeRedisClock,
    handledAnswer,
    HANDLED_OK,
    SCHEDULE_TEST_HANDLER,
    type ScheduleHarness,
} from './scheduleTestUtil.js';

/**
 * One test per row of the schedule lifecycle matrix: what ends, parks or
 * resumes a schedule, and how the due index learns it. Every test also checks
 * that no schedule's row ever reaches the pending-delivery queue.
 */

// Each test boots or drives a whole backend; a loaded runner needs room.
vi.setConfig({ testTimeout: 120_000 });

const BOOT_TIMEOUT_MS = 120_000;
const MIN = 60_000;
const HOUR = 60 * MIN;
const PEER = 'region-b';
const PEER_SECRET = 'region-b-webhook-secret';

/** A whole hour, so slots and spread offsets land on exact times. */
const T0 = Date.parse('2026-11-02T10:00:00Z');

let h: ScheduleHarness;
let pdsCalls: Array<{ method: string; args: unknown[] }>;

const server = () => h.env.server;
const events = () => server().services.events;
const schedules = () => server().services.schedule;
const store = () => server().stores.schedule;
const index = () => server().stores.scheduleIndex;
const durable = () => server().stores.durableSubscription;
const db = () => server().clients.db;

/** Every pending-delivery call, of every method. */
const spyOnPendingDeliveries = (): void => {
    const pds = server().stores.pendingDelivery as unknown as Record<
        string,
        unknown
    >;
    const proto = Object.getPrototypeOf(pds) as Record<string, unknown>;
    for (const method of Object.getOwnPropertyNames(proto)) {
        if (method === 'constructor' || typeof proto[method] !== 'function')
            continue;
        vi.spyOn(pds as never, method as never).mockImplementation(((
            ...args: unknown[]
        ) => {
            pdsCalls.push({ method, args });
            return (proto[method] as (...a: unknown[]) => unknown).apply(
                pds,
                args,
            );
        }) as never);
    }
};

const expectNoPendingDeliveryCalls = (subIds: Array<string | null>): void => {
    for (const { args } of pdsCalls)
        for (const subId of subIds) if (subId) expect(args[0]).not.toBe(subId);
};

const codeOf = async (run: Promise<unknown>): Promise<string | undefined> => {
    try {
        await run;
    } catch (err) {
        if (isHttpError(err)) return err.legacyCode;
        throw err;
    }
    return undefined;
};

const defOf = (uid: string) => index().getDef(uid);
const runOf = (uid: string) => index().getRun(uid);
const rowOf = async (uid: string) =>
    (await store().get(schedules().namespace, uid))!;
const billed = () =>
    (events().meterScheduleRun as unknown as ReturnType<typeof vi.fn>).mock
        .calls.length;

/** A schedule created at T0 - 1 min, first due at T0, every hour. */
const hourly = async (app: { uid: string }, over = {}) => {
    h.setClock(T0 - MIN);
    return h.createSchedule(app, { startAt: T0, everyMs: HOUR, ...over });
};

beforeAll(async () => {
    h = await bootScheduleHarness(
        {},
        {
            config: {
                broadcast: {
                    peers: [
                        {
                            peerId: PEER,
                            webhook_secret: PEER_SECRET,
                            webhook_url: 'https://region-b.invalid',
                            webhook: true,
                        },
                    ],
                },
            },
        },
    );
}, BOOT_TIMEOUT_MS);

afterAll(async () => {
    await h?.shutdown();
});

beforeEach(async () => {
    // Each test starts from an empty table and index.
    await db().write('DELETE FROM `event_schedules`', []);
    const keys = await server().clients.redis.keys('sched:*');
    if (keys.length > 0) await server().clients.redis.del(...keys);
    freezeRedisClock();
    h.setClock(T0 - MIN);
    h.sent.length = 0;
    h.respond = async () => HANDLED_OK;
    pdsCalls = [];
    spyOnPendingDeliveries();
    vi.spyOn(events(), 'meterScheduleRun');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(async () => {
    await h.runner.drain();
    vi.restoreAllMocks();
    vi.useRealTimers();
});

describe('a schedule', () => {
    it('fires at its slot through the worker transport and bills once', async () => {
        const app = await h.makeApp();
        const row = await hourly(app);
        const offset = (await defOf(row.uid))!.def!.offsetMs;
        h.setClock(T0 + offset);
        await h.fire();
        expect(h.sent).toHaveLength(1);
        expect(h.sent[0].call.lane).toBe('schedule');
        expect(h.sent[0].event).toMatchObject({
            subject: scheduleToken(row.uid),
            id: `${row.uid}:${T0}`,
            scheduledFor: T0,
            missed: 0,
            attempt: 1,
            firedAt: T0 + offset,
        });
        expect(h.sent[0].token).toEqual(expect.any(String));
        expect(billed()).toBe(1);
        expect(await runOf(row.uid)).toMatchObject({ owed: T0 + HOUR });
        expectNoPendingDeliveryCalls([row.subId]);
    });
});

describe('the lifecycle matrix', () => {
    it('1: off removes row, sub and index entry; late peer message can`t recreate it', async () => {
        const app = await h.makeApp();
        const row = await hourly(app);
        await schedules().remove(app.actor, row.uid);

        expect(await rowOf(row.uid)).toMatchObject({
            state: 'done',
            endReason: 'removed',
            version: 3,
        });
        expect(await durable().getBySubId(row.subId!)).toBeNull();
        expect(await defOf(row.uid)).toMatchObject({
            state: 'ended',
            version: 3,
        });
        expect(await index().getScore(row.uid)).toBeNull();

        const live = (await index().getDef(row.uid))!;
        await schedules().receivePeerChanges({
            namespace: schedules().namespace,
            changes: [
                {
                    id: row.uid,
                    version: 2,
                    state: 'active',
                    def: { ...live.def },
                    score: T0,
                    owed: T0,
                },
            ],
        });
        expect((await defOf(row.uid))!.state).toBe('ended');
        await expect(
            codeOf(schedules().remove(app.actor, row.uid)),
        ).resolves.toBe('events_schedule_not_found');
        expectNoPendingDeliveryCalls([row.subId]);
    });

    it('1: a remove whose SQL step fails still stops the schedule, and the reconcile ends it', async () => {
        const app = await h.makeApp();
        const row = await hourly(app);
        // The transaction that ends the row and its subscription row fails.
        vi.spyOn(db(), 'batchWrite').mockRejectedValueOnce(
            new Error('primary down'),
        );
        await expect(schedules().remove(app.actor, row.uid)).rejects.toThrow(
            'primary down',
        );
        expect(await defOf(row.uid)).toMatchObject({
            state: 'ended',
            version: 2,
        });
        expect(await durable().getBySubId(row.subId!)).not.toBeNull();
        // The live row under the tombstone is the soft delete that was lost.
        for (let i = 0; i < 10; i++)
            if ((await schedules().reconcile()).cycleCompleted) break;
        expect(await rowOf(row.uid)).toMatchObject({
            state: 'done',
            endReason: 'removed',
        });
        expect(await durable().getBySubId(row.subId!)).toBeNull();
        expect((await defOf(row.uid))!.state).toBe('ended');
    });

    it('2: unsubscribe refuses schedule subs', async () => {
        const app = await h.makeApp();
        const row = await hourly(app);
        await expect(
            codeOf(
                events().unsubscribeDurable(app.actor, { subId: row.subId! }),
            ),
        ).resolves.toBe('events_schedule_not_found');
        expect((await defOf(row.uid))!.state).toBe('active');
        expectNoPendingDeliveryCalls([row.subId]);
    });

    it('3: app delete ends recurring, once and deferred', async () => {
        const app = await h.makeApp();
        const recurring = await hourly(app);
        const once = await hourly(app, { kind: 'once', everyMs: null });
        const deferred = await store().create({
            namespace: schedules().namespace,
            region: schedules().region,
            kind: 'deferred',
            holderUserId: h.userId,
            appUid: app.uid,
            startAt: T0,
            everyMs: null,
            cron: null,
            tz: 'UTC',
            endsAt: null,
            ratePerHour: 0,
            minGapMs: null,
            handlerDepth: 0,
            action: 'test.send',
            payload: '{}',
            quota: {
                recurringPerUser: 1e6,
                recurringPerApp: 1e6,
                oneShotsPerUser: 1e6,
                oneShotsPerApp: 1e6,
                budgetPerUser: 1e15,
                budgetPerApp: 1e15,
            },
        });
        await schedules().reconcile();
        expect((await defOf(deferred.uid))!.state).toBe('active');

        // The owner deletes the app the way the apps API does.
        await runWithContext(
            { actor: makeActor({ user: h.userRow as never }) },
            () => server().drivers.apps.delete({ uid: app.uid }),
        );
        // `app.changed` is emitted without waiting for its listeners.
        await vi.waitFor(async () => {
            for (const row of [recurring, once, deferred]) {
                expect(await rowOf(row.uid)).toMatchObject({
                    state: 'done',
                    endReason: 'app_deleted',
                });
                expect((await defOf(row.uid))!.state).toBe('ended');
            }
        });
        expectNoPendingDeliveryCalls([recurring.subId, once.subId]);
    });

    /** A fresh account, so deleting it leaves the shared fixture alone. */
    const freshUser = async () => {
        const created = await server().stores.user.create({
            username: `u${Date.now()}${Math.floor(Math.random() * 1e6)}`,
            uuid: crypto.randomUUID(),
            password: null,
            email: null,
            requires_email_confirmation: false,
        } as never);
        return (await server().stores.user.getById(
            Number((created as { id: number }).id),
        ))!;
    };

    it('4: holder delete: next pop ends the member', async () => {
        const holder = await freshUser();
        const app = await h.makeApp();
        await server().services.permission.grantUserAppPermission(
            makeActor({ user: holder as never }),
            app.uid,
            EVENTS_BACKGROUND_PERMISSION,
        );
        const row = await hourly(app, { holderUserId: holder.id });
        await server().services.userAccount.cascadeDelete(holder.id);
        expect(
            await store().getReplica(schedules().namespace, row.uid),
        ).toBeNull();

        const endOrphan = vi.spyOn(store(), 'getReplica');
        h.setClock(T0 + MIN);
        await h.fire();
        expect(h.sent).toHaveLength(0);
        expect(endOrphan).toHaveBeenCalledTimes(1);
        expect(await defOf(row.uid)).toMatchObject({
            state: 'ended',
            version: 3,
        });
        await h.fire();
        expect(endOrphan).toHaveBeenCalledTimes(1);
        expectNoPendingDeliveryCalls([row.subId]);
    });

    it('5: owner delete ends schedules of the owner`s apps', async () => {
        const owner = await freshUser();
        const app = await h.makeApp(owner.id);
        const row = await hourly(app);
        await server().services.userAccount.cascadeDelete(owner.id);
        // `user.delete` is emitted without waiting for its listeners.
        await vi.waitFor(async () =>
            expect(await rowOf(row.uid)).toMatchObject({
                state: 'done',
                endReason: 'app_deleted',
            }),
        );
        expect((await defOf(row.uid))!.state).toBe('ended');
        expectNoPendingDeliveryCalls([row.subId]);
    });

    it('6: uninstall ends schedules and cancels pending deferred sends', async () => {
        const app = await h.makeApp();
        const row = await hourly(app);
        const deferred = await createDeferred(app.uid);
        await server().services.auth.uninstallApp(
            makeActor({ user: h.userRow as never }),
            app.uid,
        );
        expect(await rowOf(row.uid)).toMatchObject({
            state: 'done',
            endReason: 'uninstalled',
        });
        expect(await rowOf(deferred.uid)).toMatchObject({
            state: 'done',
            endReason: 'uninstalled',
        });
        expect((await defOf(row.uid))!.state).toBe('ended');
        expect((await defOf(deferred.uid))!.state).toBe('ended');
        expectNoPendingDeliveryCalls([row.subId]);
    });

    it('7: consent withdrawn ends; fire-time no settles within budget', async () => {
        const app = await h.makeApp();
        const row = await hourly(app);

        // A cached no at fire time defers; the settle asks past the cache.
        const consent = vi
            .spyOn(events(), 'hasBackgroundConsent')
            .mockResolvedValue(false);
        const settle = vi.spyOn(events(), 'settleRevokedGrant');
        h.setClock(T0 + MIN);
        await h.fire();
        expect(h.sent).toHaveLength(0);
        expect(await index().getScore(row.uid)).toBe(T0 + 2 * MIN);
        expect((await defOf(row.uid))!.state).toBe('active');
        await vi.waitFor(() => expect(settle).not.toHaveBeenCalled());
        consent.mockRestore();

        await server().services.permission.revokeUserAppPermission(
            makeActor({ user: h.userRow as never }),
            app.uid,
            EVENTS_BACKGROUND_PERMISSION,
        );
        await events().settleRevokedGrant({
            holderUserId: h.userId,
            appUid: app.uid,
            permission: EVENTS_BACKGROUND_PERMISSION,
        });
        expect(await rowOf(row.uid)).toMatchObject({
            state: 'done',
            endReason: 'permission_revoked',
        });
        // The revoke's own settle may still be applying its end.
        await vi.waitFor(async () =>
            expect((await defOf(row.uid))!.state).toBe('ended'),
        );
        expectNoPendingDeliveryCalls([row.subId]);
    });

    it('8: handler remove parks and cancels the in-flight settle; republish resumes with missed', async () => {
        const app = await h.makeApp();
        const row = await hourly(app);
        const offset = (await defOf(row.uid))!.def!.offsetMs;
        let release!: () => void;
        const held = new Promise<void>((resolve) => (release = resolve));
        h.respond = async () => {
            await held;
            return HANDLED_OK;
        };
        h.setClock(T0 + offset);
        await h.runner.tick();
        await vi.waitFor(() => expect(h.sent).toHaveLength(1));

        await events().removeHandler(app.actor, {
            name: SCHEDULE_TEST_HANDLER,
        });
        expect((await defOf(row.uid))!.state).toBe(
            'suspended:handler_not_found',
        );
        expect(await index().getScore(row.uid)).toBeNull();
        release();
        await h.runner.drain();
        expect(billed()).toBe(0);
        expect(await runOf(row.uid)).toMatchObject({ owed: T0, token: '' });

        h.respond = async () => HANDLED_OK;
        h.setClock(T0 + 3 * HOUR + 10 * MIN);
        await events().publishHandler(app.actor, {
            name: SCHEDULE_TEST_HANDLER,
            source: 'async ({ event }) => event.id',
        });
        expect((await defOf(row.uid))!.state).toBe('active');
        expect(await index().getScore(row.uid)).toBe(T0 + 4 * HOUR + offset);
        h.setClock(T0 + 4 * HOUR + offset);
        await h.fire();
        expect(h.sent[1].event).toMatchObject({
            id: `${row.uid}:${T0 + 4 * HOUR}`,
            missed: 4,
        });
        expectNoPendingDeliveryCalls([row.subId]);
    });

    it('9: worker destroy parks, republish resumes', async () => {
        const app = await h.makeApp();
        const row = await hourly(app);
        await events().destroyEventsWorker(app.actor, {});
        expect((await defOf(row.uid))!.state).toBe(
            'suspended:handler_not_found',
        );
        await events().publishHandler(app.actor, {
            name: SCHEDULE_TEST_HANDLER,
            source: 'async ({ event }) => event.id',
        });
        expect((await defOf(row.uid))!.state).toBe('active');
        expectNoPendingDeliveryCalls([row.subId]);
    });

    it('10: five failures suspend (mixed terminal and retriable); unavailable doesn`t count', async () => {
        const app = await h.makeApp();
        const row = await hourly(app);
        const answers = [400, 500, null, 400, 500, 400];
        h.respond = async () => {
            const status = answers.shift()!;
            return status === null ? { status: null } : handledAnswer(status);
        };
        let now = T0 + MIN;
        while (answers.length > 0) {
            h.setClock(now);
            await h.fire();
            now += HOUR;
        }
        await expect(durable().getBySubId(row.subId!)).resolves.toMatchObject({
            suspendedReason: 'failures',
        });
        expect((await defOf(row.uid))!.state).toBe('suspended:failures');
        expect(h.sent).toHaveLength(6);
        expect((await runOf(row.uid))!.fails).toBe(EVENTS_CONSECUTIVE_FAILURES);
        expectNoPendingDeliveryCalls([row.subId]);
    });

    it('11: no credit parks; credit sweep resumes', async () => {
        const app = await h.makeApp();
        const row = await hourly(app);
        // The balance runs out: what the metering service answers.
        const credits = vi
            .spyOn(server().services.metering, 'hasAnyUsageCached')
            .mockResolvedValue(false);
        h.setClock(T0 + MIN);
        await h.fire();
        expect(h.sent).toHaveLength(0);
        expect((await defOf(row.uid))!.state).toBe('suspended:no_credit');

        // A top-up, then the credit sweep the events service runs.
        credits.mockResolvedValue(true);
        h.setClock(T0 + 90 * MIN);
        await expect(events().sweepNoCredit()).resolves.toBe(1);
        expect((await defOf(row.uid))!.state).toBe('active');
        const offset = (await defOf(row.uid))!.def!.offsetMs;
        expect(await index().getScore(row.uid)).toBe(T0 + 2 * HOUR + offset);
        expectNoPendingDeliveryCalls([row.subId]);
    });

    it('12: final inclusive slot fires with spread and retries, then the schedule finishes', async () => {
        const app = await h.makeApp();
        const row = await hourly(app, { endsAt: T0 + 2 * HOUR });
        const offset = (await defOf(row.uid))!.def!.offsetMs;
        for (const slot of [T0, T0 + HOUR]) {
            h.setClock(slot + offset);
            await h.fire();
        }
        const answers = [500, null, 200];
        h.respond = async () => {
            const status = answers.shift()!;
            return status === null ? { status: null } : handledAnswer(status);
        };
        let now = T0 + 2 * HOUR + offset;
        for (let attempt = 1; attempt <= 3; attempt++) {
            h.setClock(now);
            await h.fire();
            now += deliveryBackoffMs(attempt) + 1000;
        }
        expect(h.sent.map((sent) => sent.event.id)).toEqual([
            `${row.uid}:${T0}`,
            `${row.uid}:${T0 + HOUR}`,
            ...Array(3).fill(`${row.uid}:${T0 + 2 * HOUR}`),
        ]);
        expect(billed()).toBe(3);
        expect(await rowOf(row.uid)).toMatchObject({
            state: 'done',
            endReason: 'ended',
        });
        expect(await durable().getBySubId(row.subId!)).toBeNull();
        expect((await defOf(row.uid))!.state).toBe('ended');
        expectNoPendingDeliveryCalls([row.subId]);
    });

    it('13: suspended 30 d is reaped', async () => {
        const app = await h.makeApp();
        const row = await hourly(app);
        await db().write(
            'UPDATE `event_subscriptions` SET `suspended_at` = ?, `suspended_reason` = ? WHERE `sub_id` = ?',
            [1, 'failures', row.subId],
        );
        await events().sweepSuspended();
        expect(await rowOf(row.uid)).toMatchObject({
            state: 'done',
            endReason: 'ended',
        });
        expect((await defOf(row.uid))!.state).toBe('ended');
        expectNoPendingDeliveryCalls([row.subId]);
    });

    it('14: once fires once; SQL failure keeps it finalizing without re-invoking', async () => {
        const app = await h.makeApp();
        const row = await hourly(app, { kind: 'once', everyMs: null });
        const offset = (await defOf(row.uid))!.def!.offsetMs;
        const finish = vi.spyOn(store(), 'end');
        // The transaction ending the row and its subscription row fails once.
        vi.spyOn(db(), 'batchWrite').mockRejectedValueOnce(
            new Error('primary down'),
        );
        h.setClock(T0 + offset);
        await h.fire();
        expect(h.sent).toHaveLength(1);
        expect(await runOf(row.uid)).toMatchObject({ phase: 'finalizing' });
        expect((await rowOf(row.uid)).deletedAt).toBeNull();
        expect(await durable().getBySubId(row.subId!)).not.toBeNull();

        h.setClock(T0 + offset + SCHEDULE_FINALIZE_RETRY_MS);
        await h.fire();
        expect(h.sent).toHaveLength(1);
        expect(billed()).toBe(1);
        expect(finish).toHaveBeenCalledTimes(2);
        expect(await rowOf(row.uid)).toMatchObject({
            state: 'done',
            endReason: 'ended',
        });
        expect(await durable().getBySubId(row.subId!)).toBeNull();
        expect((await defOf(row.uid))!.state).toBe('ended');
        expectNoPendingDeliveryCalls([row.subId]);
    });

    it('15: context update of a schedule is refused', async () => {
        const app = await h.makeApp();
        const row = await hourly(app);
        await expect(
            codeOf(
                events().updateDurable(app.actor, {
                    subId: row.subId!,
                    context: { a: 1 },
                }),
            ),
        ).resolves.toBe('events_schedule_immutable');
        expectNoPendingDeliveryCalls([row.subId]);
    });

    it('16: revoked worker session is re-minted, schedule keeps firing', async () => {
        const app = await h.makeApp();
        const row = await hourly(app);
        const offset = (await defOf(row.uid))!.def!.offsetMs;
        h.setClock(T0 + offset);
        await h.fire();
        const sessions = await server().stores.session.getByUserId(h.userId);
        const worker = sessions.find(
            (session: { kind: string; app_uid: string }) =>
                session.kind === 'worker' && session.app_uid === app.uid,
        ) as { uuid: string };
        await server().services.auth.revokeSession(worker.uuid);

        h.setClock(T0 + HOUR + offset);
        await h.fire();
        expect(h.sent).toHaveLength(2);
        expect(h.sent[1].token).not.toBe(h.sent[0].token);
        expect(billed()).toBe(2);
        expectNoPendingDeliveryCalls([row.subId]);
    });

    it('17: suspended holder defers without failure or bill, resumes when unsuspended', async () => {
        const holder = await freshUser();
        const app = await h.makeApp();
        await server().services.permission.grantUserAppPermission(
            makeActor({ user: holder as never }),
            app.uid,
            EVENTS_BACKGROUND_PERMISSION,
        );
        const row = await hourly(app, { holderUserId: holder.id });
        await db().write('UPDATE user SET suspended = 1 WHERE id = ?', [
            holder.id,
        ]);
        await server().stores.user.invalidateById(holder.id);
        h.setClock(T0 + MIN);
        await h.fire();
        expect(h.sent).toHaveLength(0);
        expect(billed()).toBe(0);
        expect(await index().getScore(row.uid)).toBe(
            T0 + MIN + EVENTS_SCHEDULE_SUSPENDED_HOLDER_DEFER_MS,
        );
        expect(await runOf(row.uid)).toMatchObject({ fails: 0, owed: T0 });

        await db().write('UPDATE user SET suspended = 0 WHERE id = ?', [
            holder.id,
        ]);
        await server().stores.user.invalidateById(holder.id);
        h.setClock(T0 + MIN + EVENTS_SCHEDULE_SUSPENDED_HOLDER_DEFER_MS);
        await h.fire();
        expect(h.sent).toHaveLength(1);
        expectNoPendingDeliveryCalls([row.subId]);
    });
});

describe('the lifecycle matrix, continued', () => {
    it('18: an app owner gone suspended counts as the handler failing, and suspends', async () => {
        const owner = (await server().stores.user.getByUsername(
            h.env.users.admin.username,
        ))!;
        const app = await h.makeApp(owner.id);
        const row = await hourly(app);
        await db().write('UPDATE user SET suspended = 1 WHERE id = ?', [
            owner.id,
        ]);
        await server().stores.user.invalidateById(owner.id);
        try {
            let now = T0 + MIN;
            for (let i = 0; i < EVENTS_CONSECUTIVE_FAILURES; i++) {
                h.setClock(now);
                await h.fire();
                now += HOUR;
            }
            // Nothing could be addressed, so nothing was sent.
            expect(h.sent).toHaveLength(0);
            await expect(
                durable().getBySubId(row.subId!),
            ).resolves.toMatchObject({ suspendedReason: 'failures' });
            expect((await defOf(row.uid))!.state).toBe('suspended:failures');
        } finally {
            await db().write('UPDATE user SET suspended = 0 WHERE id = ?', [
                owner.id,
            ]);
            await server().stores.user.invalidateById(owner.id);
        }
        expectNoPendingDeliveryCalls([row.subId]);
    });
});

describe('lifecycle changes that race', () => {
    it('a suspension whose read lands after a later resume hands the index the resume', async () => {
        const app = await h.makeApp();
        const row = await hourly(app);
        const sub = (await durable().getBySubId(row.subId!))!;
        const read = store().syncRowsBySubIds.bind(store());
        let release!: () => void;
        const held = new Promise<void>((resolve) => (release = resolve));
        let reads = 0;
        vi.spyOn(store(), 'syncRowsBySubIds').mockImplementation(
            async (...args) => {
                if (reads++ === 0) await held;
                return read(...args);
            },
        );
        const suspension = events().suspendSubscriptions(
            [sub],
            'handler_not_found',
        );
        await vi.waitFor(() => expect(reads).toBe(1));
        // The suspension's row and version changes have landed; a resume
        // runs to completion before it reads them back.
        const suspended = (await durable().getBySubId(row.subId!))!;
        await events().resumeSubscriptions([suspended]);
        release();
        await suspension;

        expect(await defOf(row.uid)).toMatchObject({
            version: 4,
            state: 'active',
        });
        await expect(durable().getBySubId(row.subId!)).resolves.toMatchObject({
            suspendedAt: null,
        });
        expectNoPendingDeliveryCalls([row.subId]);
    });

    it('a hook whose SQL failed never overwrites a newer change in the index', async () => {
        const app = await h.makeApp();
        const row = await hourly(app);
        const sub = (await durable().getBySubId(row.subId!))!;
        const apply = store().applySubscriptionChange.bind(store());
        let release!: () => void;
        const held = new Promise<void>((resolve) => (release = resolve));
        let phase: 'first' | 'others' | 'failing' = 'first';
        vi.spyOn(store(), 'applySubscriptionChange').mockImplementation(
            async (...args) => {
                if (phase === 'first') {
                    phase = 'others';
                    await held;
                    phase = 'failing';
                    throw new Error('primary down');
                }
                if (phase === 'failing') throw new Error('primary down');
                return apply(...args);
            },
        );
        const suspension = events().suspendSubscriptions(
            [sub],
            'handler_not_found',
        );
        await vi.waitFor(() => expect(phase).toBe('others'));
        const suspended = (await durable().getBySubId(row.subId!))!;
        await events().resumeSubscriptions([suspended]);
        expect(await defOf(row.uid)).toMatchObject({
            version: 3,
            state: 'active',
        });
        release();
        await suspension;
        // It saw version 2; the index has moved on, so it leaves it alone.
        expect(await defOf(row.uid)).toMatchObject({
            version: 3,
            state: 'active',
        });
    });

    it('a resume whose SQL failed ends a schedule with no slot left, never puts it back', async () => {
        const app = await h.makeApp();
        const row = await hourly(app, { endsAt: T0 + HOUR });
        const sub = (await durable().getBySubId(row.subId!))!;
        await events().suspendSubscriptions([sub], 'handler_not_found');
        expect((await defOf(row.uid))!.state).toBe(
            'suspended:handler_not_found',
        );
        h.setClock(T0 + 3 * HOUR);
        vi.spyOn(store(), 'applySubscriptionChange').mockRejectedValue(
            new Error('primary down'),
        );
        const suspended = (await durable().getBySubId(row.subId!))!;
        await events().resumeSubscriptions([suspended]);
        expect(await defOf(row.uid)).toMatchObject({
            version: 3,
            state: 'ended',
        });
        expect(await index().getScore(row.uid)).toBeNull();
    });
});

describe('a holder or app that looks gone', () => {
    it('is checked on the primary before the schedule ends: a lagging read defers it', async () => {
        const app = await h.makeApp();
        const row = await hourly(app);
        const getByUid = server().stores.app.getByUid.bind(server().stores.app);
        // The replica hasn't caught up with the app row.
        vi.spyOn(server().stores.app, 'getByUid').mockImplementation(
            async (uid: string) => (uid === app.uid ? null : getByUid(uid)),
        );
        h.setClock(T0 + MIN);
        await h.fire();
        expect(h.sent).toHaveLength(0);
        expect((await rowOf(row.uid)).deletedAt).toBeNull();
        expect((await defOf(row.uid))!.state).toBe('active');
        expect(await index().getScore(row.uid)).toBe(T0 + 2 * MIN);
    });

    it('defers when the primary can`t answer', async () => {
        const app = await h.makeApp();
        const row = await hourly(app);
        vi.spyOn(server().stores.app, 'getByUid').mockResolvedValue(null);
        vi.spyOn(server().stores.app, 'uidExistsOnPrimary').mockRejectedValue(
            new Error('primary down'),
        );
        h.setClock(T0 + MIN);
        await h.fire();
        expect((await rowOf(row.uid)).deletedAt).toBeNull();
        expect(await index().getScore(row.uid)).toBe(T0 + 2 * MIN);
    });
});

describe('the peer route', () => {
    const post = async (
        body: unknown,
        sign: { peer?: string; secret?: string } | null,
    ) => {
        const raw = JSON.stringify(body);
        const headers: Record<string, string> = {
            'content-type': 'application/json',
        };
        if (sign) {
            const timestamp = String(Math.floor(Date.now() / 1000));
            const nonce = String(Date.now() + Math.floor(Math.random() * 1e6));
            headers['x-broadcast-peer-id'] = sign.peer ?? PEER;
            headers['x-broadcast-timestamp'] = timestamp;
            headers['x-broadcast-nonce'] = nonce;
            headers['x-broadcast-signature'] = createHmac(
                'sha256',
                sign.secret ?? PEER_SECRET,
            )
                .update(`${timestamp}.${nonce}.${raw}`)
                .digest('hex');
        }
        const response = await fetch(
            new URL('/broadcast/events/schedules', h.env.apiOrigin),
            { method: 'POST', headers, body: raw },
        );
        return { status: response.status, body: await response.json() };
    };

    it('applies a signed peer`s changes and refuses an unsigned, forged or foreign one', async () => {
        const app = await h.makeApp();
        const row = await hourly(app);
        const live = (await defOf(row.uid))!;
        const changes = [
            {
                id: row.uid,
                version: 3,
                state: 'suspended:failures',
                def: live.def,
                score: 0,
                owed: T0,
            },
        ];
        const namespace = schedules().namespace;

        expect((await post({ namespace, changes }, null)).status).toBe(403);
        expect(
            (await post({ namespace, changes }, { secret: 'not-the-secret' }))
                .status,
        ).toBe(403);
        expect(
            (await post({ namespace: 'another-deployment', changes }, {})).body,
        ).toMatchObject({ ok: true, applied: 0 });
        expect((await defOf(row.uid))!.state).toBe('active');
        // An unversioned change is refused too.
        expect(
            (
                await post(
                    { namespace, changes: [{ ...changes[0], version: null }] },
                    {},
                )
            ).body,
        ).toMatchObject({ applied: 0 });

        expect((await post({ namespace, changes }, {})).body).toMatchObject({
            ok: true,
            applied: 1,
        });
        expect(await defOf(row.uid)).toMatchObject({
            version: 3,
            state: 'suspended:failures',
        });
        expectNoPendingDeliveryCalls([row.subId]);
    });
});

describe('a lifecycle hook whose SQL step fails', () => {
    it('parks the member at its current version, refuses the in-flight settle, and the reconcile leaves it parked', async () => {
        const app = await h.makeApp();
        const row = await hourly(app);
        const offset = (await defOf(row.uid))!.def!.offsetMs;
        let release!: () => void;
        const held = new Promise<void>((resolve) => (release = resolve));
        h.respond = async () => {
            await held;
            return HANDLED_OK;
        };
        h.setClock(T0 + offset);
        await h.runner.tick();
        await vi.waitFor(() => expect(h.sent).toHaveLength(1));

        vi.spyOn(store(), 'applySubscriptionChange').mockRejectedValue(
            new Error('primary unavailable'),
        );
        const sub = (await durable().getBySubId(row.subId!))!;
        await events().suspendSubscriptions([sub], 'handler_not_found');
        vi.mocked(store().applySubscriptionChange).mockRestore();

        expect(await defOf(row.uid)).toMatchObject({
            version: 2,
            state: 'suspended:handler_not_found',
        });
        release();
        await h.runner.drain();
        expect(billed()).toBe(0);

        await schedules().reconcile();
        expect(await defOf(row.uid)).toMatchObject({
            version: 2,
            state: 'suspended:handler_not_found',
        });
        expect(await index().getScore(row.uid)).toBeNull();
        expectNoPendingDeliveryCalls([row.subId]);
    });
});

describe('the fire path', () => {
    it('stamps firedAt when the invocation goes out after a deploy', async () => {
        const app = await h.makeApp();
        const row = await hourly(app);
        const offset = (await defOf(row.uid))!.def!.offsetMs;
        h.respond = async (call) =>
            call.deployed
                ? HANDLED_OK
                : { status: null, dispatchReason: 'missing' };
        events().useWorkerMissHandler(async () => {
            // The deploy takes three seconds of clock.
            h.setClock(Date.now() + 3000);
            return 'deployed';
        });
        h.setClock(T0 + offset);
        await h.fire();
        expect(h.sent).toHaveLength(2);
        expect(h.sent[0].event.firedAt).toBe(T0 + offset);
        expect(h.sent[1].event.firedAt).toBe(T0 + offset + 3000);
        expect(h.sent[1].event.id).toBe(h.sent[0].event.id);
        expect(billed()).toBe(1);
    });

    it('spreads 100 hourly schedules of one app across the window, on the schedule lane only', async () => {
        const app = await h.makeApp();
        const uids = new Set<string>();
        for (let i = 0; i < 100; i++) uids.add((await hourly(app)).uid);
        const perSecond: number[] = [];
        for (let s = 0; s <= 30; s++) {
            const before = h.sent.length;
            h.setClock(T0 + s * 1000);
            await h.fire();
            perSecond.push(h.sent.length - before);
        }
        expect(new Set(h.sent.map((sent) => sent.event.scheduleId))).toEqual(
            uids,
        );
        // Deterministic offsets under 30 s: no second takes the whole burst.
        expect(perSecond[30]).toBe(0);
        expect(Math.max(...perSecond)).toBeLessThanOrEqual(15);
        expect(h.sent.every((sent) => sent.call.lane === 'schedule')).toBe(
            true,
        );
        // The delivery invocation limiter is never spent by schedules: its
        // window still admits the first of a limit of one.
        await expect(
            checkRateLimit(
                `${EVENTS_WORKER_INVOCATION_LIMIT.scope}:${h.userId}:${app.uid}`,
                1,
                EVENTS_WORKER_INVOCATION_LIMIT.window,
            ),
        ).resolves.toBe(true);
    });
});

describe('a schedule owned by another region', () => {
    it('gets its lifecycle changes by a signed peer message, which a foreign namespace can`t use', async () => {
        const app = await h.makeApp();
        const row = await store().create({
            namespace: schedules().namespace,
            region: 'region-b',
            kind: 'recurring',
            holderUserId: h.userId,
            appUid: app.uid,
            startAt: T0,
            everyMs: HOUR,
            cron: null,
            tz: 'UTC',
            endsAt: null,
            ratePerHour: 1000,
            minGapMs: HOUR,
            handlerDepth: 0,
            subscription: {
                handlerName: SCHEDULE_TEST_HANDLER,
                context: null,
                permission: EVENTS_BACKGROUND_PERMISSION,
            },
            quota: {
                recurringPerUser: 1e6,
                recurringPerApp: 1e6,
                oneShotsPerUser: 1e6,
                oneShotsPerApp: 1e6,
                budgetPerUser: 1e15,
                budgetPerApp: 1e15,
            },
        });
        const post = vi
            .spyOn(server().services.broadcast, 'postToPeer')
            .mockResolvedValue({ ok: true });
        const sub = (await durable().getBySubId(row.subId!))!;
        await events().suspendSubscriptions([sub], 'handler_not_found');

        expect(post).toHaveBeenCalledTimes(1);
        const [peer, path, payload] = post.mock.calls[0] as [
            string,
            string,
            { namespace: string; changes: Array<Record<string, unknown>> },
        ];
        expect(peer).toBe('region-b');
        expect(path).toBe('/broadcast/events/schedules');
        expect(payload.namespace).toBe(schedules().namespace);
        expect(payload.changes).toEqual([
            expect.objectContaining({
                id: row.uid,
                version: 3,
                state: 'suspended:handler_not_found',
            }),
        ]);
        // Nothing of it lands in this region's index.
        expect(await defOf(row.uid)).toBeNull();

        // The owning region applies it; another deployment's message is dropped.
        await expect(
            schedules().receivePeerChanges({
                namespace: 'another-deployment',
                changes: payload.changes,
            }),
        ).resolves.toEqual({ applied: 0 });
        await expect(schedules().receivePeerChanges(payload)).resolves.toEqual({
            applied: 1,
        });
        expect(await defOf(row.uid)).toMatchObject({
            version: 3,
            state: 'suspended:handler_not_found',
        });
    });
});

describe('the holder`s notice', () => {
    it('names an ended schedule as a schedule', async () => {
        const app = await h.makeApp();
        await hourly(app);
        const notify = vi.spyOn(server().services.notification, 'notify');
        await server().services.permission.revokeUserAppPermission(
            makeActor({ user: h.userRow as never }),
            app.uid,
            EVENTS_BACKGROUND_PERMISSION,
        );
        await events().settleRevokedGrant({
            holderUserId: h.userId,
            appUid: app.uid,
            permission: EVENTS_BACKGROUND_PERMISSION,
        });
        // The revoke settles off its own event; whichever settle wins notifies.
        await vi.waitFor(() =>
            expect(notify).toHaveBeenCalledWith(
                [h.userId],
                expect.objectContaining({
                    title: 'A schedule ended',
                    reason: 'permission_revoked',
                }),
                expect.objectContaining({ type: 'app.events.ended' }),
            ),
        );
    });
});

/** A pending delayed send of `appUid`, indexed by a reconcile pass. */
const createDeferred = async (appUid: string) => {
    const row = await store().create({
        namespace: schedules().namespace,
        region: schedules().region,
        kind: 'deferred',
        holderUserId: h.userId,
        appUid,
        startAt: T0,
        everyMs: null,
        cron: null,
        tz: 'UTC',
        endsAt: null,
        ratePerHour: 0,
        minGapMs: null,
        handlerDepth: 0,
        action: 'test.send',
        payload: '{}',
        quota: {
            recurringPerUser: 1e6,
            recurringPerApp: 1e6,
            oneShotsPerUser: 1e6,
            oneShotsPerApp: 1e6,
            budgetPerUser: 1e15,
            budgetPerApp: 1e15,
        },
    });
    await schedules().reconcile();
    return row;
};
