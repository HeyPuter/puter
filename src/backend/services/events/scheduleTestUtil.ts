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

import { v4 as uuidv4 } from 'uuid';
import { vi } from 'vitest';
import type {
    EventsInvokeAnswer,
    EventsInvokeCall,
} from '../../clients/events/EventsWorkerInvokerClient.js';
import { makeActor, type Actor } from '../../core/actor.js';
import type { ScheduleRow } from '../../stores/events/ScheduleStore.js';
import { setupPuterTestEnv, type PuterTestEnv } from '../../testUtil.js';
import type { IConfig } from '../../types.js';
import { EVENTS_BACKGROUND_PERMISSION } from './authorization.js';
import type { SchedulePlan } from './ScheduleService.js';
import type { ScheduleRunner } from './ScheduleRunner.js';
import { firstSlotAtOrAfter } from './scheduleSlots.js';
import type { ScheduleEvent } from './workerSeam.js';

/**
 * A booted backend for schedule tests: events and schedules on, the worker
 * runtime pointed at an in-process transport the test answers for, and the
 * runner's and reconcile's timers stopped so a test drives them.
 */

export const SCHEDULE_TEST_HANDLER = 'tick';
const SOURCE = 'async ({ event }) => { return event.id; }';

/** One invocation the fake transport received. */
export interface SentInvocation {
    call: EventsInvokeCall;
    event: ScheduleEvent;
    token: string;
}

export interface ScheduleHarness {
    env: PuterTestEnv;
    userId: number;
    userRow: Record<string, unknown>;
    sent: SentInvocation[];
    /** What the transport answers; replace per test. */
    respond: (call: EventsInvokeCall) => Promise<EventsInvokeAnswer>;
    runner: ScheduleRunner;
    /** An app owned by `ownerUserId`, consented to and with a handler published. */
    makeApp(ownerUserId?: number): Promise<{ uid: string; actor: Actor }>;
    /** A schedule created the way the API creates one, caps set wide. */
    createSchedule(
        app: { uid: string },
        options?: Partial<SchedulePlan>,
    ): Promise<ScheduleRow>;
    /** Set the clock every layer and the in-process Redis read. */
    setClock(ms: number): void;
    /** One runner tick, and every attempt it started. */
    fire(): Promise<void>;
    shutdown(): Promise<void>;
}

export const HANDLED_OK: EventsInvokeAnswer = { status: 200, handled: true };

export const bootScheduleHarness = async (
    config: Record<string, unknown> = {},
): Promise<ScheduleHarness> => {
    const env = await setupPuterTestEnv({
        events: {
            enabled: true,
            schedules: { enabled: true },
            workerRuntime: true,
            internalSecret: 'schedule-test-secret',
        },
        unlimitedMetering: true,
        ...config,
    } as IConfig);
    const server = env.server;
    server.services.schedule.onServerPrepareShutdown();

    const user = await server.stores.user.getByUsername(
        env.users.user.username,
    );
    const userRow = user as unknown as Record<string, unknown>;

    const harness: ScheduleHarness = {
        env,
        userId: user!.id,
        userRow,
        sent: [],
        respond: async () => HANDLED_OK,
        runner: server.services.schedule.runner,
        async makeApp(ownerUserId = harness.userId) {
            const uid = `app-${uuidv4()}`;
            await server.clients.db.write(
                'INSERT INTO `apps` (`uid`, `name`, `title`, `index_url`, `owner_user_id`) VALUES (?, ?, ?, ?, ?)',
                [uid, uid, uid, `https://${uid}.example/`, ownerUserId],
            );
            const [row] = await server.clients.db.read(
                'SELECT `id` FROM `apps` WHERE `uid` = ?',
                [uid],
            );
            await server.services.permission.grantUserAppPermission(
                makeActor({ user: userRow as never }),
                uid,
                EVENTS_BACKGROUND_PERMISSION,
            );
            await server.stores.eventHandler.publish({
                appUid: uid,
                name: SCHEDULE_TEST_HANDLER,
                source: SOURCE,
            });
            return {
                uid,
                actor: makeActor({
                    user: userRow as never,
                    app: { uid, id: Number(row.id) },
                }),
            };
        },
        async createSchedule(app, options = {}) {
            const now = Date.now();
            const startAt = options.startAt ?? Math.ceil(now / 60_000) * 60_000;
            const kind = options.kind ?? 'recurring';
            const everyMs =
                kind === 'recurring' ? (options.everyMs ?? 60_000) : null;
            const plan: SchedulePlan = {
                kind,
                startAt,
                everyMs,
                cron: null,
                tz: 'UTC',
                endsAt: kind === 'recurring' ? null : startAt,
                minGapMs: everyMs,
                ratePerHour: everyMs ? Math.ceil(3_600_000_000 / everyMs) : 0,
                firstSlot: startAt,
                handlerName: SCHEDULE_TEST_HANDLER,
                handlerHash: null,
                context: null,
                namespace: server.services.schedule.namespace,
                holderUserId: harness.userId,
                appUid: app.uid,
                handlerDepth: 0,
                quota: {
                    recurringPerUser: 1e6,
                    recurringPerApp: 1e6,
                    oneShotsPerUser: 1e6,
                    oneShotsPerApp: 1e6,
                    budgetPerUser: 1e15,
                    budgetPerApp: 1e15,
                },
                ...options,
            };
            if (options.endsAt === undefined && plan.kind === 'recurring')
                plan.endsAt = null;
            if (firstSlotAtOrAfter(plan, now) === null)
                throw new Error('test schedule never fires');
            return server.services.schedule.create(plan);
        },
        setClock(ms) {
            vi.setSystemTime(ms);
        },
        async fire() {
            await harness.runner.tick();
            await harness.runner.drain();
        },
        shutdown: () => env.shutdown(),
    };

    server.services.events.useWorkerTransport({
        send: async (call) => {
            const body = JSON.parse(
                call.render ? call.render() : call.body,
            ) as {
                event: ScheduleEvent;
                token: string;
            };
            harness.sent.push({ call, event: body.event, token: body.token });
            return harness.respond(call);
        },
    });
    return harness;
};

/** Pin the clock the in-process Redis scripts read to whole milliseconds. */
export const freezeRedisClock = (): void => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.spyOn(process, 'hrtime').mockReturnValue([0, 0]);
};

/** An answer the handler itself gave. */
export const handledAnswer = (status: number): EventsInvokeAnswer => ({
    status,
    handled: true,
});
