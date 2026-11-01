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
 * `notify({ sendAt })`: a delayed app message stored as a `deferred` schedule
 * and sent by the real runner when it comes due. One slot writes at most one
 * mailbox row, however often it runs, and every delivery of it carries the
 * slot's key as its `sendId`.
 */

import { v4 as uuidv4 } from 'uuid';
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
    EVENTS_SCHEDULE_DEFERRED_MAX_ATTEMPTS,
    EVENTS_SCHEDULE_PENDING_ONESHOTS_PER_APP,
    EVENTS_SCHEDULE_SUSPENDED_HOLDER_DEFER_MS,
    deliveryBackoffMs,
    limitFor,
} from '../../controllers/events/limits.js';
import { makeActor, type Actor } from '../../core/actor.js';
import { runWithContext } from '../../core/context.js';
import { HttpError, isHttpError } from '../../core/http/HttpError.js';
import { checkRateLimit } from '../../core/http/middleware/rateLimit.js';
import type { ScheduleActionRun } from '../../services/events/scheduleActions.js';
import { SCHEDULE_LEASE_MS } from '../../services/events/ScheduleRunner.js';
import {
    bootScheduleHarness,
    freezeRedisClock,
    seedSchedules,
    type ScheduleHarness,
} from '../../services/events/scheduleTestUtil.js';
import { actorPlanId } from '../../services/metering/enforcement.js';
import type { ScheduleRow } from '../../stores/events/ScheduleStore.js';
import type { IConfig } from '../../types.js';
import {
    APP_MESSAGE_SEND_ACTION,
    sendKeyOf,
    type NotificationDriver,
} from './NotificationDriver.js';

vi.setConfig({ testTimeout: 120_000 });

const BOOT_TIMEOUT_MS = 120_000;
const MIN = 60_000;
const DAY = 24 * 60 * MIN;
/** A one-shot's spread is under 10 s, so it is due by then. */
const SPREAD_MS = 10_000;
const PER_MINUTE = 3;

/** A whole hour, so slots land on exact times. */
const T0 = Date.parse('2026-11-02T10:00:00Z');
const DUE = T0 + SPREAD_MS;

let h: ScheduleHarness;
let written: Array<Record<string, unknown>>;
let created: Array<Record<string, unknown>>;

const server = () => h.env.server;
const schedules = () => server().services.schedule;
const store = () => server().stores.schedule;
const index = () => server().stores.scheduleIndex;
const notifications = () => server().stores.notification;
const db = () => server().clients.db;
const driver = () =>
    server().drivers.notifications as unknown as NotificationDriver;

const holderActor = (): Actor => makeActor({ user: h.userRow as never });
const asApp = (app: { uid: string; actor: Actor }, over: Partial<Actor> = {}) =>
    makeActor({ ...app.actor, ...over } as never);

const withActor = <T>(actor: Actor, fn: () => Promise<T>): Promise<T> =>
    runWithContext({ actor }, fn);

const codeOf = async (run: Promise<unknown>): Promise<string | undefined> => {
    try {
        await run;
    } catch (err) {
        if (isHttpError(err)) return err.legacyCode;
        throw err;
    }
    return undefined;
};

interface Scheduled {
    scheduled: { scheduleId: string; sendAt: number };
}

const notify = (
    actor: Actor,
    fields: Record<string, unknown>,
): Promise<unknown> =>
    withActor(actor, () =>
        driver().create({
            object: { value: { type: 'app.message', title: 'Hi', ...fields } },
        }),
    );

/** A message to the app's own user at `sendAt` (T0 by default). */
const sendLater = async (
    app: { uid: string; actor: Actor },
    fields: Record<string, unknown> = {},
): Promise<ScheduleRow> => {
    const answer = (await notify(asApp(app), {
        sendAt: T0,
        ...fields,
    })) as Scheduled;
    return (await store().get(
        schedules().namespace,
        answer.scheduled.scheduleId,
    ))!;
};

const rowOf = async (uid: string) =>
    (await store().get(schedules().namespace, uid))!;

const mailbox = (appUid: string, userId = h.userId) =>
    db().read(
        'SELECT * FROM `notification` WHERE `user_id` = ? AND `app_uid` = ? ' +
            "AND `type` = 'app.message' ORDER BY `id`",
        [userId, appUid],
    );

const writtenFor = (appUid: string) =>
    written.filter((event) => event.appUid === appUid);

/** One run of the action, as the runner would hand it over. */
const runOf = (row: ScheduleRow, attempts = 0): ScheduleActionRun => ({
    scheduleId: row.uid,
    rowId: row.id,
    version: row.version,
    holderUserId: row.holderUserId,
    appUid: row.appUid,
    scheduledFor: row.startAt,
    attempts,
    signal: new AbortController().signal,
});

const action = () => schedules().actions.get(APP_MESSAGE_SEND_ACTION)!;

const fireAt = async (ms: number) => {
    h.setClock(ms);
    await h.fire();
};

/** Fire whenever the index next has the member due, `times` times. */
const fireWhenDue = async (uid: string, times = 1) => {
    for (let i = 0; i < times; i++) {
        const score = await index().getScore(uid);
        if (score === null) throw new Error('member is not in the index');
        await fireAt(score);
    }
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

beforeAll(async () => {
    h = await bootScheduleHarness(
        { kvHandles: true, notificationsFoldIn: true },
        {
            config: {
                kv: { shareHandles: true },
                notificationAppMessageLimits: { perMinute: PER_MINUTE },
            },
        },
    );
    server().clients.event.on('notif.written', (_key, data) => {
        written.push(data as unknown as Record<string, unknown>);
    });
    server().clients.event.on('notif.created', (_key, data) => {
        created.push(data as unknown as Record<string, unknown>);
    });
}, BOOT_TIMEOUT_MS);

afterAll(async () => {
    await h?.shutdown();
});

beforeEach(async () => {
    await db().write('DELETE FROM `event_schedules`', []);
    const keys = await server().clients.redis.keys('sched:*');
    if (keys.length > 0) await server().clients.redis.del(...keys);
    freezeRedisClock();
    h.setClock(T0 - MIN);
    written = [];
    created = [];
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(async () => {
    await h.runner.drain();
    vi.restoreAllMocks();
    vi.useRealTimers();
});

describe('notify({ sendAt })', () => {
    it('stores a delayed send for the app and its user, and answers its id', async () => {
        const app = await h.makeApp();
        const answer = (await notify(asApp(app), {
            text: 'Later',
            group: 'g',
            sendAt: T0 + 1,
        })) as Scheduled;

        // Rounded up to the next whole second.
        expect(answer).toEqual({
            scheduled: {
                scheduleId: expect.any(String),
                sendAt: T0 + 1000,
            },
        });
        const row = await rowOf(answer.scheduled.scheduleId);
        expect(row).toMatchObject({
            kind: 'deferred',
            holderUserId: h.userId,
            appUid: app.uid,
            startAt: T0 + 1000,
            endsAt: T0 + 1000,
            action: APP_MESSAGE_SEND_ACTION,
            state: 'active',
            subId: null,
        });
        expect(JSON.parse(row.payload!)).toEqual({
            message: {
                title: 'Hi',
                text: 'Later',
                group: 'g',
                priority: 'normal',
                ttl: 3600,
            },
        });
        expect(await index().getDef(row.uid)).toMatchObject({
            state: 'active',
            version: row.version,
        });
        expect(await mailbox(app.uid)).toEqual([]);
        expect(writtenFor(app.uid)).toEqual([]);
    });

    it('takes an ISO time with a zone, as `at` does', async () => {
        const app = await h.makeApp();
        const answer = (await notify(asApp(app), {
            sendAt: '2026-11-02T11:00:00+01:00',
        })) as Scheduled;
        expect(answer.scheduled.sendAt).toBe(T0);
    });

    it('refuses a time it can`t read, or one too far ahead, storing nothing', async () => {
        const app = await h.makeApp();
        for (const sendAt of [
            '2026-11-02T10:00:00',
            '11/02/2026',
            -1,
            1.5,
            T0 + 367 * DAY,
        ])
            expect(await codeOf(notify(asApp(app), { sendAt }))).toBe(
                'events_schedule_invalid',
            );
        // The message is checked as for an immediate send.
        expect(
            await codeOf(notify(asApp(app), { sendAt: T0, title: '' })),
        ).toBe('bad_request');
        expect(await store().usageForHolder(h.userId, app.uid)).toMatchObject({
            oneShots: { total: 0 },
        });
    });

    it('sends at once when sendAt is within 5 seconds, or past', async () => {
        const app = await h.makeApp();
        for (const sendAt of [T0 - MIN + 5000, T0 - 2 * MIN]) {
            const answer = (await notify(asApp(app), {
                sendAt,
            })) as Record<string, unknown>;
            expect(answer.uid).toEqual(expect.any(String));
        }
        expect(await mailbox(app.uid)).toHaveLength(2);
        expect(await store().usageForHolder(h.userId, app.uid)).toMatchObject({
            oneShots: { total: 0 },
        });
    });

    it('is refused while schedules are off, even for a send due now', async () => {
        const app = await h.makeApp();
        const config = (schedules() as unknown as { config: IConfig })
            .config as { events: { schedules: { enabled: boolean } } };
        config.events.schedules.enabled = false;
        try {
            for (const sendAt of [T0, T0 - MIN])
                expect(await codeOf(notify(asApp(app), { sendAt }))).toBe(
                    'events_disabled',
                );
        } finally {
            config.events.schedules.enabled = true;
        }
        expect(await mailbox(app.uid)).toEqual([]);
    });

    it('needs an app, and refuses a scoped token', async () => {
        const app = await h.makeApp();
        // The account itself can't send an app message at all.
        expect(await codeOf(notify(holderActor(), { sendAt: T0 }))).toBe(
            'forbidden',
        );
        const token = makeActor({
            user: h.userRow as never,
            accessToken: {
                uid: `tok-${uuidv4()}`,
                issuer: asApp(app),
                authorized: null,
            },
        });
        expect(await codeOf(notify(token, { sendAt: T0 }))).toBe(
            'events_durable_requires_account',
        );
    });

    it('counts against the sender`s pending one-shot cap per app', async () => {
        const app = await h.makeApp();
        const cap = limitFor(
            EVENTS_SCHEDULE_PENDING_ONESHOTS_PER_APP,
            await actorPlanId(server().services.metering, asApp(app)),
        );
        const [first] = await seedSchedules(server(), {
            namespace: schedules().namespace,
            region: schedules().region,
            holderUserId: h.userId,
            appUid: app.uid,
            count: cap,
            startAt: T0 + DAY,
            everyMs: DAY,
            createdAt: T0 - MIN,
            deferred: true,
        });
        expect(await codeOf(notify(asApp(app), { sendAt: T0 }))).toBe(
            'events_schedule_limit',
        );
        await store().cancelDeferred([(await rowOf(first)).id], 'removed');
        expect(await codeOf(notify(asApp(app), { sendAt: T0 }))).toBe(
            undefined,
        );
    });

    it('checks a share`s recipient when it is stored', async () => {
        const app = await h.makeApp();
        expect(
            await codeOf(
                notify(asApp(app), {
                    sendAt: T0,
                    to: { handle: `kvh-${uuidv4()}` },
                }),
            ),
        ).toBe('subject_does_not_exist');
        expect(await store().usageForHolder(h.userId, app.uid)).toMatchObject({
            oneShots: { total: 0 },
        });
    });
});

describe('a delayed send coming due', () => {
    it('waits for sendAt, then writes one row and delivers it under its key', async () => {
        const app = await h.makeApp();
        const row = await sendLater(app, { channel: 'later' });
        await fireAt(T0 - 1000);
        expect(await mailbox(app.uid)).toEqual([]);

        const writes = {
            write: vi.spyOn(db(), 'write'),
            batchWrite: vi.spyOn(db(), 'batchWrite'),
            insert: vi.spyOn(db(), 'insert'),
        };
        await fireAt(DUE);
        // Claim, the write transaction, and the finish: nothing else.
        expect(writes.write).toHaveBeenCalledTimes(2);
        expect(writes.batchWrite).toHaveBeenCalledTimes(1);
        expect(writes.insert).not.toHaveBeenCalled();

        const key = sendKeyOf(row.uid, T0);
        const rows = await mailbox(app.uid);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            uid: key,
            send_key: key,
            type: 'app.message',
            audience: 'app-user',
        });
        expect(JSON.parse(String(rows[0].value))).toMatchObject({
            title: 'Hi',
            channel: 'later',
            type: 'app.message',
            app: { uid: app.uid },
        });
        await settle();
        expect(writtenFor(app.uid)).toEqual([
            expect.objectContaining({
                userId: h.userId,
                uid: key,
                sendId: key,
            }),
        ]);
        expect(writtenFor(app.uid)[0].updated).toBeUndefined();
        expect(await rowOf(row.uid)).toMatchObject({
            state: 'done',
            endReason: 'delivered',
        });
        expect(await index().getDef(row.uid)).toMatchObject({
            state: 'ended',
        });
    });

    it('carries the depth it was scheduled at into the live copy', async () => {
        const app = await h.makeApp();
        const answer = (await notify(asApp(app, { handlerDepth: 2 }), {
            sendAt: T0,
        })) as Scheduled;
        await fireAt(DUE);
        await settle();
        expect(created.filter((event) => event.appUid === app.uid)).toEqual([
            expect.objectContaining({
                uid: sendKeyOf(answer.scheduled.scheduleId, T0),
                handlerDepth: 2,
            }),
        ]);
    });

    it('replaces the open row of its group, keeping its uid and taking its key', async () => {
        const app = await h.makeApp();
        const open = (await notify(asApp(app), { group: 'g' })) as {
            uid: string;
        };
        const row = await sendLater(app, { group: 'g', text: 'newer' });
        await fireAt(DUE);

        const key = sendKeyOf(row.uid, T0);
        const rows = await mailbox(app.uid);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ uid: open.uid, send_key: key });
        expect(Number(rows[0].replaced_at)).toBeGreaterThan(0);
        expect(JSON.parse(String(rows[0].value))).toMatchObject({
            text: 'newer',
        });
        await settle();
        expect(writtenFor(app.uid).at(-1)).toMatchObject({
            uid: open.uid,
            updated: true,
            sendId: key,
        });
    });

    it('writes a fresh row, once, when its group`s row is shown between lookup and write', async () => {
        const app = await h.makeApp();
        const open = (await notify(asApp(app), { group: 'g' })) as {
            uid: string;
        };
        const row = await sendLater(app, { group: 'g' });
        const lookup = notifications().getUnseenByGroup.bind(notifications());
        vi.spyOn(notifications(), 'getUnseenByGroup').mockImplementation(
            async (...args) => {
                const found = await lookup(...args);
                await notifications().markShown(open.uid, h.userId);
                return found;
            },
        );
        await fireAt(DUE);

        const key = sendKeyOf(row.uid, T0);
        const rows = await mailbox(app.uid);
        expect(rows.map((r) => [r.uid, r.send_key])).toEqual([
            [open.uid, null],
            [key, key],
        ]);
        await settle();
        expect(writtenFor(app.uid).at(-1)).toMatchObject({
            uid: key,
            sendId: key,
        });
    });

    it('sends to the other side of a share, checked again when it goes', async () => {
        const app = await h.makeApp();
        const other = await server().stores.user.getByUsername(
            h.env.users.other.username,
        );
        const { handle } = await server().services.kvShare.mintKvHandle(
            holderActor(),
            {
                prefix: `room-${uuidv4().slice(0, 8)}:`,
                recipient: { username: other!.username },
                appUid: app.uid,
                notify: true,
            },
            { defaultAccess: 'write' },
        );
        const kept = await sendLater(app, { to: { handle } });
        await fireAt(DUE);
        expect(await mailbox(app.uid, other!.id)).toHaveLength(1);
        expect(await mailbox(app.uid)).toEqual([]);
        expect((await rowOf(kept.uid)).endReason).toBe('delivered');

        // A share gone by the time it goes drops the send.
        h.setClock(T0 - MIN);
        const dropped = await sendLater(app, {
            to: { handle },
            sendAt: T0 + MIN,
        });
        await server().services.kvShare.removeKvShare(holderActor(), handle);
        await fireAt(T0 + MIN + SPREAD_MS);
        expect(await rowOf(dropped.uid)).toMatchObject({
            state: 'done',
            endReason: 'dropped',
        });
        expect(await mailbox(app.uid, other!.id)).toHaveLength(1);
    });
});

describe('a delayed send run more than once', () => {
    it('re-delivers under the same key, writing no second row, when the finish was lost', async () => {
        const app = await h.makeApp();
        const row = await sendLater(app);
        vi.spyOn(store(), 'finishDeferred').mockRejectedValueOnce(
            new Error('crashed after the delivery'),
        );
        await fireAt(DUE);
        expect(await rowOf(row.uid)).toMatchObject({ state: 'delivered' });

        // The lease lapses and the next pop picks the send up.
        await fireAt(DUE + SCHEDULE_LEASE_MS);
        const key = sendKeyOf(row.uid, T0);
        expect(await mailbox(app.uid)).toHaveLength(1);
        await settle();
        expect(
            writtenFor(app.uid).map((event) => [event.uid, event.sendId]),
        ).toEqual([
            [key, key],
            [key, key],
        ]);
        expect(await rowOf(row.uid)).toMatchObject({
            state: 'done',
            endReason: 'delivered',
        });
    });

    it('re-delivers a group replacement as a replacement, under the same key', async () => {
        const app = await h.makeApp();
        const open = (await notify(asApp(app), { group: 'g' })) as {
            uid: string;
        };
        const row = await sendLater(app, { group: 'g' });
        vi.spyOn(store(), 'finishDeferred').mockRejectedValueOnce(
            new Error('crashed after the delivery'),
        );
        await fireAt(DUE);
        await fireAt(DUE + SCHEDULE_LEASE_MS);

        const key = sendKeyOf(row.uid, T0);
        expect(await mailbox(app.uid)).toHaveLength(1);
        await settle();
        const sends = writtenFor(app.uid).filter((e) => e.sendId === key);
        expect(sends).toEqual([
            expect.objectContaining({ uid: open.uid, updated: true }),
            expect.objectContaining({ uid: open.uid, updated: true }),
        ]);
    });

    it('recovers from a crash at each point to one row and one key', async () => {
        const crashes: Array<[string, () => void]> = [
            [
                'before the claim',
                () =>
                    vi
                        .spyOn(store(), 'claimDeferred')
                        .mockRejectedValueOnce(new Error('crash')),
            ],
            [
                'after the claim',
                () =>
                    vi
                        .spyOn(store(), 'getDeferred')
                        .mockRejectedValueOnce(new Error('crash')),
            ],
            [
                'after the commit',
                () =>
                    vi
                        .spyOn(notifications(), 'getBySendKey')
                        .mockRejectedValueOnce(new Error('crash')),
            ],
            [
                'after the delivery',
                () =>
                    vi
                        .spyOn(store(), 'finishDeferred')
                        .mockRejectedValueOnce(new Error('crash')),
            ],
        ];
        for (const [point, crash] of crashes) {
            const app = await h.makeApp();
            h.setClock(T0 - MIN);
            const row = await sendLater(app);
            crash();
            await fireAt(DUE);
            // A claim left behind holds the send until it lapses on the
            // database's clock.
            await db().write(
                'UPDATE `event_schedules` SET `send_until` = 0 WHERE `id` = ?',
                [row.id],
            );
            await fireAt(DUE + SCHEDULE_LEASE_MS);

            const key = sendKeyOf(row.uid, T0);
            expect(await mailbox(app.uid), point).toHaveLength(1);
            expect((await mailbox(app.uid))[0].send_key, point).toBe(key);
            await settle();
            const sends = writtenFor(app.uid);
            expect(sends.length, point).toBeGreaterThanOrEqual(1);
            expect(
                sends.every((event) => event.sendId === key),
                point,
            ).toBe(true);
            expect(await rowOf(row.uid), point).toMatchObject({
                state: 'done',
                endReason: 'delivered',
            });
            vi.restoreAllMocks();
            vi.spyOn(console, 'warn').mockImplementation(() => {});
        }
    });

    it('rolls a failed write back whole, hands the claim back and retries after the backoff', async () => {
        const app = await h.makeApp();
        const row = await sendLater(app);
        const entries = notifications().sendEntries.bind(notifications());
        vi.spyOn(notifications(), 'sendEntries').mockImplementationOnce(
            (...args) => [
                ...entries(...args),
                {
                    statement: 'INSERT INTO `no_such_table` VALUES (1)',
                    values: [],
                },
            ],
        );
        await fireAt(DUE);

        expect(await mailbox(app.uid)).toEqual([]);
        expect(await rowOf(row.uid)).toMatchObject({
            state: 'active',
            sendToken: null,
        });
        expect(await index().getRun(row.uid)).toMatchObject({ attempts: 1 });
        expect(await index().getScore(row.uid)).toBe(
            DUE + deliveryBackoffMs(1),
        );

        await fireAt(DUE + deliveryBackoffMs(1));
        expect(await mailbox(app.uid)).toHaveLength(1);
        expect((await rowOf(row.uid)).endReason).toBe('delivered');
    });

    it('waits out a claim it couldn`t hand back', async () => {
        const app = await h.makeApp();
        const row = await sendLater(app);
        vi.spyOn(server().stores.app, 'getByUid').mockRejectedValueOnce(
            new Error('primary unreachable'),
        );
        vi.spyOn(store(), 'releaseDeferred').mockRejectedValueOnce(
            new Error('primary unreachable'),
        );
        await fireAt(DUE);
        expect((await rowOf(row.uid)).state).toBe('sending');

        await fireAt(DUE + deliveryBackoffMs(1));
        expect(await mailbox(app.uid)).toEqual([]);
        // Deferred to the claim's expiry, on the database's clock.
        expect(await index().getScore(row.uid)).toBeGreaterThan(
            DUE + deliveryBackoffMs(1) + 100_000,
        );
    });

    it('sends once when two runs race for the claim', async () => {
        const app = await h.makeApp();
        const row = await sendLater(app);
        h.setClock(DUE);
        const outcomes = await Promise.all([
            action()(runOf(row)),
            action()(runOf(row)),
        ]);
        expect(outcomes.map((o) => o.type).sort()).toEqual([
            'defer',
            'finished',
        ]);
        expect(await mailbox(app.uid)).toHaveLength(1);
        await settle();
        expect(writtenFor(app.uid)).toHaveLength(1);
    });

    it('lets no run take a live claim, and fences a stale one off everything', async () => {
        const app = await h.makeApp();
        const row = await sendLater(app);
        h.setClock(DUE);
        const stale = uuidv4();
        expect(
            await store().claimDeferred(
                row.id,
                schedules().namespace,
                stale,
                120_000,
            ),
        ).toBe(true);

        const waiting = await action()(runOf(row));
        expect(waiting.type).toBe('defer');
        expect((waiting as { delayMs: number }).delayMs).toBeGreaterThan(
            100_000,
        );
        expect(await mailbox(app.uid)).toEqual([]);

        // The stale claim lapses; another run takes it over and sends.
        await db().write(
            'UPDATE `event_schedules` SET `send_until` = 0 WHERE `id` = ?',
            [row.id],
        );
        expect((await action()(runOf(row))).type).toBe('finished');

        // The stale owner's transaction and finish change nothing.
        const otherKey = uuidv4();
        expect(
            await store().deliverDeferred(
                row.id,
                stale,
                notifications().sendEntries(
                    {
                        sendKey: otherKey,
                        userId: h.userId,
                        value: { title: 'stale' },
                        type: 'app.message',
                        audience: 'app-user',
                        appUid: app.uid,
                        at: Date.now(),
                    },
                    store().deliveredGuard(row.id, stale),
                ),
            ),
        ).toBe(false);
        expect(await notifications().getBySendKey(otherKey)).toBeNull();
        expect(await mailbox(app.uid)).toHaveLength(1);
        const finished = await rowOf(row.uid);
        expect(
            await store().finishDeferred(row.id, stale, 'dropped'),
        ).toMatchObject({ version: finished.version, endReason: 'delivered' });
    });
});

describe('a delayed send that can`t go', () => {
    it('is retried while the recipient is over its limit, then dropped', async () => {
        const app = await h.makeApp();
        const row = await sendLater(app);
        const fill = async () => {
            while (
                await checkRateLimit(
                    `notif:app-message:minute:${h.userId}:${app.uid}`,
                    PER_MINUTE,
                    MIN,
                )
            );
        };
        h.setClock(DUE);
        for (let i = 1; i <= EVENTS_SCHEDULE_DEFERRED_MAX_ATTEMPTS; i++) {
            await fill();
            await fireWhenDue(row.uid);
            expect(await index().getRun(row.uid)).toMatchObject({
                attempts: i,
            });
            expect((await rowOf(row.uid)).state).toBe('active');
        }
        await fireWhenDue(row.uid);
        expect(await rowOf(row.uid)).toMatchObject({
            state: 'done',
            endReason: 'dropped',
        });
        expect(await index().getDef(row.uid)).toMatchObject({
            state: 'ended',
        });
        expect(await mailbox(app.uid)).toEqual([]);
    });

    it('is dropped when its sender is gone', async () => {
        const app = await h.makeApp();
        const row = await sendLater(app);
        vi.spyOn(
            server().services.events,
            'resolveScheduleActor',
        ).mockResolvedValueOnce(null);
        await fireAt(DUE);
        expect(await rowOf(row.uid)).toMatchObject({
            state: 'done',
            endReason: 'dropped',
        });
        expect(await mailbox(app.uid)).toEqual([]);
    });

    it('waits while its sender is suspended, and goes once they aren`t', async () => {
        const app = await h.makeApp();
        const row = await sendLater(app);
        await db().write('UPDATE user SET suspended = 1 WHERE id = ?', [
            h.userId,
        ]);
        await server().stores.user.invalidateById(h.userId);
        try {
            await fireAt(DUE);
            expect(await mailbox(app.uid)).toEqual([]);
            expect(await rowOf(row.uid)).toMatchObject({
                state: 'active',
                sendToken: null,
            });
            expect(await index().getScore(row.uid)).toBe(
                DUE + EVENTS_SCHEDULE_SUSPENDED_HOLDER_DEFER_MS,
            );
            expect(await index().getRun(row.uid)).toMatchObject({
                attempts: 0,
            });
        } finally {
            await db().write('UPDATE user SET suspended = 0 WHERE id = ?', [
                h.userId,
            ]);
            await server().stores.user.invalidateById(h.userId);
        }
        await fireAt(DUE + EVENTS_SCHEDULE_SUSPENDED_HOLDER_DEFER_MS);
        expect(await mailbox(app.uid)).toHaveLength(1);
    });

    it('is dropped on a refusal that won`t change', async () => {
        const app = await h.makeApp();
        const row = await sendLater(app);
        vi.spyOn(server().stores.app, 'getByUid').mockRejectedValueOnce(
            new HttpError(403, 'no', { legacyCode: 'forbidden' }),
        );
        await fireAt(DUE);
        expect((await rowOf(row.uid)).endReason).toBe('dropped');
    });
});

describe('cancelling a delayed send', () => {
    it('removes one still waiting, which then never sends', async () => {
        const app = await h.makeApp();
        const row = await sendLater(app);
        await schedules().remove(asApp(app), row.uid);
        expect(await rowOf(row.uid)).toMatchObject({
            state: 'done',
            endReason: 'removed',
        });
        await fireAt(DUE);
        expect(await mailbox(app.uid)).toEqual([]);
    });

    it('refuses once the send has started, and after it is delivered', async () => {
        const app = await h.makeApp();
        const row = await sendLater(app);
        const token = uuidv4();
        await store().claimDeferred(
            row.id,
            schedules().namespace,
            token,
            120_000,
        );
        expect(await codeOf(schedules().remove(asApp(app), row.uid))).toBe(
            'events_schedule_sending',
        );
        await store().deliverDeferred(row.id, token, []);
        expect(await codeOf(schedules().remove(asApp(app), row.uid))).toBe(
            'events_schedule_sending',
        );
    });

    it('is done for every waiting send when the app is uninstalled', async () => {
        const app = await h.makeApp();
        const row = await sendLater(app);
        await server().services.auth.uninstallApp(holderActor(), app.uid);
        expect(await rowOf(row.uid)).toMatchObject({
            state: 'done',
            endReason: 'uninstalled',
        });
        await fireAt(DUE);
        expect(await mailbox(app.uid)).toEqual([]);
    });

    it('is done for every waiting send when the app is deleted', async () => {
        const app = await h.makeApp();
        const row = await sendLater(app);
        await withActor(holderActor(), () =>
            server().drivers.apps.delete({ uid: app.uid }),
        );
        await vi.waitFor(async () =>
            expect(await rowOf(row.uid)).toMatchObject({
                state: 'done',
                endReason: 'app_deleted',
            }),
        );
    });
});

describe('a delayed send as a schedule', () => {
    it('reads as waiting, then sending, then ended with why', async () => {
        const app = await h.makeApp();
        const row = await sendLater(app);
        const view = () => schedules().get(asApp(app), row.uid);
        expect(await view()).toMatchObject({
            kind: 'deferred',
            state: 'active',
            handlerName: null,
            contextKeys: null,
            startAt: T0,
            endsAt: T0,
            nextRunAt: T0,
            endReason: null,
        });

        const token = uuidv4();
        await store().claimDeferred(
            row.id,
            schedules().namespace,
            token,
            120_000,
        );
        expect(await view()).toMatchObject({
            state: 'sending',
            nextRunAt: null,
        });
        await store().deliverDeferred(row.id, token, []);
        expect(await view()).toMatchObject({
            state: 'sending',
            nextRunAt: null,
        });
        await store().finishDeferred(row.id, token, 'delivered');
        expect(await view()).toMatchObject({
            state: 'ended',
            endReason: 'delivered',
            nextRunAt: null,
            endedAt: expect.any(Number),
        });

        const dropped = await sendLater(app);
        await store().claimDeferred(
            dropped.id,
            schedules().namespace,
            token,
            120_000,
        );
        await store().finishDeferred(dropped.id, token, 'dropped');
        expect(await schedules().get(asApp(app), dropped.uid)).toMatchObject({
            state: 'ended',
            endReason: 'dropped',
        });
    });

    it('stays live through a reconcile while it sends', async () => {
        const app = await h.makeApp();
        const row = await sendLater(app);
        await store().claimDeferred(
            row.id,
            schedules().namespace,
            uuidv4(),
            120_000,
        );
        await schedules().reconcile();
        expect(await index().getDef(row.uid)).toMatchObject({
            state: 'active',
        });
    });
});
