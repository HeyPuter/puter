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
import { EventsWorkerDeployer } from '../../controllers/events/workerDeploy.js';
import { makeActor } from '../../core/actor.js';
import { EVENTS_BACKGROUND_PERMISSION } from './authorization.js';
import {
    bootScheduleHarness,
    freezeRedisClock,
    HANDLED_OK,
    seedSchedules,
    type ScheduleHarness,
} from './scheduleTestUtil.js';

/**
 * A recurring fire costs the primary database nothing. Every call the fire path
 * makes to it is counted; the only ones allowed are the per-event exceptions,
 * each told apart by where it came from:
 *
 * - E1 the end of a schedule whose holder or app is gone
 * - E2 minting the worker session the first time, or after a revoke
 * - E3 a deploy after the worker was evicted
 * - E4 a lifecycle change (suspend, resume, a consent settle)
 * - E5 the finish of a one-shot or ended schedule
 *
 * Any other primary call fails the test. The MySQL client also falls back to
 * the primary inside `read()` when the replica itself is down (E6, a replica
 * outage only); sqlite has no replica, so that path can't be exercised here.
 */

// Each test boots or drives a whole backend; a loaded runner needs room.
vi.setConfig({ testTimeout: 120_000 });

const BOOT_TIMEOUT_MS = 180_000;
const MIN = 60_000;
const HOUR = 60 * MIN;
const T0 = Date.parse('2026-11-02T10:00:00Z');

type Tag = 'E1' | 'E2' | 'E3' | 'E4' | 'E5';

const TAGS: Array<[Tag, RegExp]> = [
    ['E1', /\bendOrphan\b/],
    ['E2', /getOrCreateWorker|selectUnlessEnded/],
    ['E3', /EventsWorkerDeployer|\.#deploy\b/],
    [
        'E4',
        /suspendForFailures|suspendForNoCredit|resumeSubscriptions|applySubscriptionChange|settleLostConsent|suspendSubscriptions/,
    ],
    ['E5', /\bfinishRun\b/],
];

const PRIMARY = ['pread', 'write', 'insert', 'batchWrite'] as const;

interface PrimaryCall {
    method: string;
    sql: string;
    tag: Tag | null;
    stack: string;
}

let h: ScheduleHarness;
let calls: PrimaryCall[];
let replicaReads: number;

const server = () => h.env.server;
const schedules = () => server().services.schedule;
const index = () => server().stores.scheduleIndex;

const watchPrimary = (): void => {
    const db = server().clients.db as unknown as Record<
        string,
        (...args: unknown[]) => unknown
    >;
    for (const method of PRIMARY) {
        const original = db[method].bind(db);
        vi.spyOn(db as never, method as never).mockImplementation(((
            ...args: unknown[]
        ) => {
            const stack = new Error().stack ?? '';
            const tag = TAGS.find(([, pattern]) => pattern.test(stack));
            calls.push({
                method,
                sql: String(args[0]).slice(0, 120),
                tag: tag ? tag[0] : null,
                stack,
            });
            return original(...args);
        }) as never);
    }
    const read = db.read.bind(db);
    vi.spyOn(db as never, 'read' as never).mockImplementation(((
        ...args: unknown[]
    ) => {
        replicaReads++;
        return read(...args);
    }) as never);
};

const untagged = () =>
    calls
        .filter((call) => call.tag === null)
        .map((call) => `${call.method}: ${call.sql}\n${call.stack}`);

const byTag = (tag: Tag) => calls.filter((call) => call.tag === tag).length;

/** Fire until nothing is due at the current time. */
const fireAll = async (): Promise<void> => {
    let sent = -1;
    while (sent !== h.sent.length) {
        sent = h.sent.length;
        await h.fire();
    }
};

const apps: string[] = [];

beforeAll(async () => {
    h = await bootScheduleHarness({ workerNamespace: 'schedule-test-events' });
    // 20 apps of 50 schedules each: a fixed (holder, app) window takes 200.
    for (let i = 0; i < 20; i++) apps.push((await h.makeApp()).uid);
}, BOOT_TIMEOUT_MS);

afterAll(async () => {
    await h?.shutdown();
});

beforeEach(async () => {
    freezeRedisClock();
    h.setClock(T0);
    h.sent.length = 0;
    h.respond = async () => HANDLED_OK;
    calls = [];
    replicaReads = 0;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(async () => {
    await h.runner.drain();
    vi.restoreAllMocks();
    vi.useRealTimers();
});

/** 50 schedules per app, every minute from `startAt`, indexed. */
const seedRound = async (startAt: number): Promise<string[]> => {
    const uids: string[] = [];
    for (const appUid of apps)
        uids.push(
            ...(await seedSchedules(server(), {
                namespace: schedules().namespace,
                region: schedules().region,
                holderUserId: h.userId,
                appUid,
                count: 50,
                startAt,
                everyMs: MIN,
                createdAt: startAt - HOUR,
            })),
        );
    for (let i = 0; i < 50; i++)
        if ((await schedules().reconcile()).cycleCompleted) break;
    return uids;
};

describe('a recurring fire', () => {
    it('(a) warm: 1,000 fires touch the primary not at all', async () => {
        // A first round warms every cache: the worker sessions are minted here.
        await seedRound(T0);
        h.setClock(T0 + 6000);
        await fireAll();
        expect(h.sent.length).toBeGreaterThanOrEqual(1000);

        const warm = await seedRound(T0 + 20_000);
        h.sent.length = 0;
        calls = [];
        watchPrimary();
        h.setClock(T0 + 26_000);
        await fireAll();
        const fired = h.sent.filter((sent) =>
            warm.includes(sent.event.scheduleId),
        );
        expect(fired).toHaveLength(1000);
        expect(untagged()).toEqual([]);
        expect(calls).toEqual([]);
    });

    it('(b) expired caches: misses read the replica, never the primary', async () => {
        h.setClock(T0 + 25 * HOUR);
        watchPrimary();
        await fireAll();
        expect(h.sent.length).toBeGreaterThan(0);
        expect(untagged()).toEqual([]);
        expect(calls.filter((call) => call.method === 'pread')).toEqual([]);
        expect(replicaReads).toBeGreaterThan(0);
    });

    it('(c) a credit refresh issues no primary read or write', async () => {
        h.setClock(T0 + 26 * HOUR);
        watchPrimary();
        const actor = makeActor({ user: h.userRow as never });
        await server().services.metering.hasAnyUsageCached(actor);
        h.setClock(T0 + 26 * HOUR + 16_000);
        await server().services.metering.hasAnyUsageCached(actor);
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(untagged()).toEqual([]);
        expect(calls).toEqual([]);
    });

    it('(c) a credit refresh on a metered plan issues no primary read or write', async () => {
        h.setClock(T0 + 27 * HOUR);
        const metering = server().services.metering;
        const created = (await server().stores.user.create({
            username: `metered${Math.floor(Math.random() * 1e9)}`,
            uuid: crypto.randomUUID(),
            password: null,
            email: `metered${Date.now()}@example.com`,
            requires_email_confirmation: false,
        } as never)) as { id: number };
        const user = (await server().stores.user.getById(created.id))!;
        // Not the harness's unlimited plan: one with an allowance, so the
        // refresh reads add-ons and this month's totals.
        metering.registerSubscriptionResolver((who) =>
            who.user?.uuid === user.uuid ? 'user_free' : null,
        );
        const actor = makeActor({ user: user as never });
        const totals = vi.spyOn(metering, 'currentMonthTotals');
        watchPrimary();
        await metering.hasAnyUsageCached(actor);
        h.setClock(T0 + 27 * HOUR + 16_000);
        await metering.hasAnyUsageCached(actor);
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(totals).toHaveBeenCalledTimes(2);
        expect(untagged()).toEqual([]);
        expect(calls).toEqual([]);
    });

    it('(d) a cold redeploy reads the primary once per deploy, not per fire', async () => {
        await server().clients.db.write('DELETE FROM `event_schedules`', []);
        const keys = await server().clients.redis.keys('sched:*');
        if (keys.length > 0) await server().clients.redis.del(...keys);

        const deployer = new EventsWorkerDeployer({
            // The server keeps its config to itself; the services hold it.
            config: (server().services.schedule as unknown as { config: never })
                .config,
            clients: server().clients,
            stores: server().stores,
            services: server().services,
            drivers: server().drivers,
        });
        const create = vi
            .spyOn(server().drivers.workers, 'create')
            .mockResolvedValue({
                success: true,
            } as never);
        server().services.events.useWorkerMissHandler((appUid, script) =>
            deployer.ensure(appUid, script),
        );
        // The worker was evicted: missing until a deploy brings it back.
        let deployed = false;
        h.respond = async (call) => {
            if (call.deployed) deployed = true;
            return deployed
                ? HANDLED_OK
                : { status: null, dispatchReason: 'missing' };
        };
        h.setClock(T0 + 30 * HOUR);
        const uids = await seedSchedules(server(), {
            namespace: schedules().namespace,
            region: schedules().region,
            holderUserId: h.userId,
            appUid: apps[0],
            count: 100,
            startAt: T0 + 30 * HOUR + MIN,
            everyMs: MIN,
            createdAt: T0 + 29 * HOUR,
        });
        for (let i = 0; i < 50; i++)
            if ((await schedules().reconcile()).cycleCompleted) break;
        watchPrimary();
        h.setClock(T0 + 30 * HOUR + MIN + 6000);
        await fireAll();
        expect(new Set(h.sent.map((s) => s.event.scheduleId)).size).toBe(
            uids.length,
        );
        expect(untagged()).toEqual([]);
        // One deploy, through the region gate; the setForApp and allForApp
        // reads are its own, not each fire's.
        expect(create).toHaveBeenCalledTimes(1);
        expect(byTag('E3')).toBe(2);
        // The session is minted once, however many first fires race for it.
        expect(byTag('E2')).toBeLessThanOrEqual(1);
    });

    it('(e) a deleted holder: one orphan end, then the member is gone', async () => {
        await server().clients.db.write('DELETE FROM `event_schedules`', []);
        const holder = await server().stores.user.create({
            username: `orphan${Math.floor(Math.random() * 1e9)}`,
            uuid: crypto.randomUUID(),
            password: null,
            email: null,
            requires_email_confirmation: false,
        } as never);
        const holderId = Number((holder as { id: number }).id);
        await server().services.permission.grantUserAppPermission(
            makeActor({
                user: (await server().stores.user.getById(holderId)) as never,
            }),
            apps[1],
            EVENTS_BACKGROUND_PERMISSION,
        );
        h.setClock(T0 + 31 * HOUR);
        const [uid] = await seedSchedules(server(), {
            namespace: schedules().namespace,
            region: schedules().region,
            holderUserId: holderId,
            appUid: apps[1],
            count: 1,
            startAt: T0 + 31 * HOUR + MIN,
            everyMs: MIN,
            createdAt: T0 + 30 * HOUR,
        });
        for (let i = 0; i < 50; i++)
            if ((await schedules().reconcile()).cycleCompleted) break;
        await server().services.userAccount.cascadeDelete(holderId);

        watchPrimary();
        h.setClock(T0 + 31 * HOUR + 2 * MIN);
        await fireAll();
        await fireAll();
        expect(untagged()).toEqual([]);
        expect((await index().getDef(uid))!.state).toBe('ended');
        expect(h.sent.filter((s) => s.event.scheduleId === uid)).toEqual([]);
    });

    it('(f) a suspend and resume cost only lifecycle writes', async () => {
        const subs = await server().stores.durableSubscription.listByHandler(
            apps[2],
            'tick',
        );
        watchPrimary();
        await server().services.events.suspendSubscriptions(
            subs.slice(0, 5),
            'failures',
        );
        await server().services.events.resumeSubscriptions(
            subs.slice(0, 5).map((sub) => ({
                ...sub,
                suspendedAt: Math.floor(Date.now() / 1000),
                suspendedReason: 'failures',
            })),
        );
        expect(untagged()).toEqual([]);
        expect(calls.every((call) => call.tag === 'E4')).toBe(true);
        expect(calls.length).toBeGreaterThan(0);
    });
});
