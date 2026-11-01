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

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { makeActor } from '../../core/actor.js';
import { isHttpError } from '../../core/http/HttpError.js';
import { ScheduleIndexStore } from '../../stores/events/ScheduleIndexStore.js';
import { setupPuterTestEnv, type PuterTestEnv } from '../../testUtil.js';
import type { IConfig } from '../../types.js';
import { EVENTS_BACKGROUND_PERMISSION } from './authorization.js';
import { ScheduleReconciler } from './scheduleReconcile.js';
import { ScheduleRunner } from './ScheduleRunner.js';

/**
 * With schedules off, nothing about them runs: no runner or reconcile timer, no
 * Redis key, no create, and the subscription lifecycle changes only rows.
 */

const BOOT_TIMEOUT_MS = 120_000;

let env: PuterTestEnv;
const indexCalls: string[] = [];

const codeOf = async (run: Promise<unknown>): Promise<string | undefined> => {
    try {
        await run;
    } catch (err) {
        if (isHttpError(err)) return err.legacyCode;
        throw err;
    }
    return undefined;
};

beforeAll(async () => {
    const proto = ScheduleIndexStore.prototype as unknown as Record<
        string,
        unknown
    >;
    for (const method of Object.getOwnPropertyNames(proto)) {
        const descriptor = Object.getOwnPropertyDescriptor(proto, method);
        if (method === 'constructor' || typeof descriptor?.value !== 'function')
            continue;
        vi.spyOn(proto as never, method as never).mockImplementation(function (
            this: unknown,
            ...args: unknown[]
        ) {
            indexCalls.push(method);
            return (descriptor.value as (...a: unknown[]) => unknown).apply(
                this,
                args,
            );
        } as never);
    }
    vi.spyOn(ScheduleRunner.prototype, 'tick');
    vi.spyOn(ScheduleReconciler.prototype, 'pass');
    env = await setupPuterTestEnv({
        events: { enabled: true },
        unlimitedMetering: true,
    } as IConfig);
}, BOOT_TIMEOUT_MS);

afterAll(async () => {
    vi.restoreAllMocks();
    await env?.shutdown();
});

describe('schedules off', () => {
    it('start no timer and touch no Redis key', async () => {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        expect(ScheduleRunner.prototype.tick).not.toHaveBeenCalled();
        expect(ScheduleReconciler.prototype.pass).not.toHaveBeenCalled();
        expect(indexCalls).toEqual([]);
        expect(await env.server.clients.redis.keys('sched:*')).toEqual([]);
    });

    it('refuse a create and a remove, and ignore peer changes', async () => {
        const user = (await env.server.stores.user.getByUsername(
            env.users.user.username,
        ))!;
        const actor = makeActor({
            user: user as never,
            app: { uid: 'app-off', id: 1 },
        });
        const schedules = env.server.services.schedule;
        await expect(
            codeOf(schedules.prepareCreate(actor, { every: '1h' })),
        ).resolves.toBe('events_disabled');
        await expect(
            codeOf(schedules.remove(actor, crypto.randomUUID())),
        ).resolves.toBe('events_disabled');
        await expect(
            schedules.receivePeerChanges({
                namespace: schedules.namespace,
                changes: [],
            }),
        ).resolves.toEqual({ applied: 0 });
    });

    it('let the subscription lifecycle change rows only', async () => {
        const user = (await env.server.stores.user.getByUsername(
            env.users.user.username,
        ))!;
        const appUid = `app-${crypto.randomUUID()}`;
        await env.server.clients.db.write(
            'INSERT INTO `apps` (`uid`, `name`, `title`, `index_url`, `owner_user_id`) VALUES (?, ?, ?, ?, ?)',
            [appUid, appUid, appUid, `https://${appUid}.example/`, user.id],
        );
        const row = await env.server.stores.schedule.create({
            namespace: env.server.services.schedule.namespace,
            region: env.server.services.schedule.region,
            kind: 'recurring',
            holderUserId: user.id,
            appUid,
            startAt: Date.now() + 3_600_000,
            everyMs: 3_600_000,
            cron: null,
            tz: 'UTC',
            endsAt: null,
            ratePerHour: 1000,
            minGapMs: 3_600_000,
            handlerDepth: 0,
            subscription: {
                handlerName: 'tick',
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
        const sub = (await env.server.stores.durableSubscription.getBySubId(
            row.subId!,
        ))!;
        await env.server.services.events.suspendSubscriptions(
            [sub],
            'failures',
        );
        expect(
            (await env.server.stores.schedule.get(
                env.server.services.schedule.namespace,
                row.uid,
            ))!.version,
        ).toBe(3);
        expect(indexCalls).toEqual([]);
        expect(await env.server.clients.redis.keys('sched:*')).toEqual([]);
    });
});
