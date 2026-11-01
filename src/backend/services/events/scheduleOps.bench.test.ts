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

import Redis from 'ioredis';
import {
    afterAll,
    afterEach,
    beforeAll,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { EVENTS_SCHEDULE_INVOCATION_LIMIT } from '../../controllers/events/limits.js';
import {
    SCHEDULE_PARTITIONS,
    ScheduleIndexStore,
} from '../../stores/events/ScheduleIndexStore.js';
import type { IConfig } from '../../types.js';
import { SCHEDULE_LEASE_MS } from './ScheduleRunner.js';
import {
    bootScheduleHarness,
    freezeRedisClock,
    seedSchedules,
    type ScheduleHarness,
} from './scheduleTestUtil.js';

/**
 * What one schedule fire costs Redis. The index and the runtime budget are held
 * to three round trips per on-time fire (the pop's share, the budget, the
 * settle); the total with the shared caches on the path is reported. With
 * `PUTER_TEST_REDIS_URL` set, the commands Redis itself runs (inside the
 * scripts included) are counted from `INFO commandstats`.
 */

// Each test boots or drives a whole backend; a loaded runner needs room.
vi.setConfig({ testTimeout: 120_000 });

const BOOT_TIMEOUT_MS = 180_000;
const MIN = 60_000;
const HOUR = 60 * MIN;
const T0 = Date.parse('2026-11-02T10:00:00Z');
const FIRES = 1000;
const APPS = 20;

const INDEX_COMMANDS = new Set([
    'schedPop',
    'schedBudget',
    'schedSettle',
    'schedStart',
]);

const report = (line: string): void => {
    process.stderr.write(`[schedule ops] ${line}\n`);
};

describe('round trips per fire', () => {
    let h: ScheduleHarness;

    beforeAll(async () => {
        h = await bootScheduleHarness();
    }, BOOT_TIMEOUT_MS);

    afterAll(async () => {
        await h?.shutdown();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    /** Count every call that crosses to Redis; a pipeline is one. */
    const countRoundTrips = () => {
        const server = h.env.server;
        const inner = server.clients.redis;
        const counts = new Map<string, number>();
        const bump = (name: string) =>
            counts.set(name, (counts.get(name) ?? 0) + 1);
        const proxy = new Proxy(inner, {
            get(target, property, receiver) {
                const value = Reflect.get(target, property, receiver);
                if (typeof property !== 'string' || typeof value !== 'function')
                    return value;
                if (property === 'pipeline' || property === 'multi')
                    return (...args: unknown[]) => {
                        const batch = (
                            value as (...a: unknown[]) => {
                                exec: () => Promise<unknown>;
                            }
                        ).apply(target, args);
                        const exec = batch.exec.bind(batch);
                        batch.exec = () => {
                            bump(property);
                            return exec();
                        };
                        return batch;
                    };
                return (...args: unknown[]) => {
                    bump(property);
                    return (value as (...a: unknown[]) => unknown).apply(
                        target,
                        args,
                    );
                };
            },
        });
        (server.clients as { redis: unknown }).redis = proxy;
        return {
            counts,
            restore: () => {
                (server.clients as { redis: unknown }).redis = inner;
            },
        };
    };

    it('is at most three for the index and budget on a warm on-time fire', async () => {
        freezeRedisClock();
        h.setClock(T0);
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const server = h.env.server;
        const schedules = server.services.schedule;
        const apps: string[] = [];
        for (let i = 0; i < APPS; i++) apps.push((await h.makeApp()).uid);
        const seedRound = async (startAt: number) => {
            for (const appUid of apps)
                await seedSchedules(server, {
                    namespace: schedules.namespace,
                    region: schedules.region,
                    holderUserId: h.userId,
                    appUid,
                    count: FIRES / APPS,
                    startAt,
                    everyMs: MIN,
                    createdAt: startAt - HOUR,
                });
            for (let i = 0; i < 50; i++)
                if ((await schedules.reconcile()).cycleCompleted) break;
        };
        const fireAll = async () => {
            let sent = -1;
            while (sent !== h.sent.length) {
                sent = h.sent.length;
                await h.fire();
            }
        };

        // A first round warms the caches and mints the worker sessions.
        await seedRound(T0);
        h.setClock(T0 + 6000);
        await fireAll();

        await seedRound(T0 + 20_000);
        h.sent.length = 0;
        const { counts, restore } = countRoundTrips();
        h.setClock(T0 + 26_000);
        try {
            await fireAll();
        } finally {
            restore();
        }
        const fires = h.sent.length;
        expect(fires).toBe(FIRES);

        let index = 0;
        let total = 0;
        for (const [name, count] of counts) {
            total += count;
            if (INDEX_COMMANDS.has(name)) index += count;
        }
        const perFire = index / fires;
        report(
            `${fires} warm on-time fires: index + budget ${perFire.toFixed(2)} ` +
                `round trips per fire (pop ${((counts.get('schedPop') ?? 0) / fires).toFixed(2)}), ` +
                `${(total / fires).toFixed(2)} in all`,
        );
        report(
            `by command: ${JSON.stringify(Object.fromEntries([...counts].sort((a, b) => b[1] - a[1])))}`,
        );
        expect(counts.get('schedStart') ?? 0).toBe(0);
        expect(perFire).toBeLessThanOrEqual(3);
    });
});

/**
 * The commands a real Redis runs per fire, scripts' insides included. Index and
 * budget only: the fire path around them is what the test above covers.
 */
describe.skipIf(!process.env.PUTER_TEST_REDIS_URL)(
    'commands per fire on a real Redis',
    () => {
        let redis: Redis;
        let index: ScheduleIndexStore;

        beforeAll(async () => {
            redis = new Redis(process.env.PUTER_TEST_REDIS_URL!);
            index = new ScheduleIndexStore(
                {
                    jobs: { namespace: `bench${Date.now()}` },
                } as IConfig,
                { redis } as never,
                {} as never,
            );
        });

        afterAll(async () => {
            const keys = await redis.keys(
                `${index.keys(0).due.split(':due:')[0]}:*`,
            );
            if (keys.length > 0) await redis.del(...keys);
            await redis.quit();
        });

        const commandCalls = async (): Promise<number> => {
            const info = await redis.info('commandstats');
            let calls = 0;
            for (const line of info.split('\n')) {
                const match = /^cmdstat_([^:]+):calls=(\d+)/.exec(line.trim());
                if (!match) continue;
                // The script calls themselves and this probe aren't fire work.
                if (
                    /^(evalsha|eval|evalsha_ro|eval_ro|script|info)$/.test(
                        match[1],
                    )
                )
                    continue;
                calls += Number(match[2]);
            }
            return calls;
        };

        const seed = async (count: number, owed: number) => {
            const changes = Array.from({ length: count }, (_, i) => ({
                id: `bench-${owed}-${i}`,
                version: 2,
                state: 'active',
                def: {
                    rowId: i,
                    kind: 'recurring' as const,
                    startAt: owed,
                    everyMs: MIN,
                    cron: null,
                    tz: 'UTC',
                    endsAt: null,
                    createdAt: owed - HOUR,
                    subId: `sub-${i}`,
                    holderUserId: 1,
                    appUid: `app-${i % APPS}`,
                    handlerName: 'tick',
                    context: null,
                    handlerDepth: 0,
                    offsetMs: 0,
                    action: null,
                },
                score: owed,
                owed,
            }));
            await index.apply(changes);
        };

        /** Pop, budget and settle every due member; `late` pins first. */
        const fireAll = async (late: boolean): Promise<number> => {
            let fires = 0;
            for (let p = 0; p < SCHEDULE_PARTITIONS; p++) {
                for (;;) {
                    const { items } = await index.pop(
                        p,
                        100,
                        SCHEDULE_LEASE_MS,
                    );
                    if (items.length === 0) break;
                    for (const item of items) {
                        const owed = item.prevRun.owed!;
                        await index.spendBudget(
                            1,
                            item.def.def!.appUid,
                            EVENTS_SCHEDULE_INVOCATION_LIMIT.limit * 100,
                            EVENTS_SCHEDULE_INVOCATION_LIMIT.windowMs,
                        );
                        const slot = late ? owed + MIN : owed;
                        if (late)
                            await index.start(
                                item.id,
                                item.token,
                                slot,
                                1,
                                false,
                            );
                        await index.settle(
                            item.id,
                            item.token,
                            slot,
                            slot + 10 * MIN,
                            slot + 10 * MIN,
                            0,
                        );
                        fires++;
                    }
                }
            }
            return fires;
        };

        it('runs under ten for a steady fire and at most eleven for a late one', async () => {
            const now = await index.now();
            await seed(FIRES, now - 1000);
            let before = await commandCalls();
            const steady = await fireAll(false);
            const steadyPerFire = ((await commandCalls()) - before) / steady;

            await seed(FIRES, now - 3 * MIN);
            before = await commandCalls();
            const late = await fireAll(true);
            const latePerFire = ((await commandCalls()) - before) / late;

            report(
                `real Redis: ${steadyPerFire.toFixed(2)} commands per steady fire, ` +
                    `${latePerFire.toFixed(2)} per late fire`,
            );
            expect(steadyPerFire).toBeLessThan(10);
            expect(latePerFire).toBeLessThanOrEqual(11);
        });
    },
);
