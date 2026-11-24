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

import MockRedis from 'ioredis-mock';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PendingDeliveryStore } from '../../stores/events/PendingDeliveryStore.js';
import type { IConfig } from '../../types.js';
import { EventsService, PENDING_SWEEP_INTERVAL_MS } from './EventsService.js';

let redis: InstanceType<typeof MockRedis.Cluster>;
let nodes: EventsService[];
let heads: number;

/** One backend node: its own service and store over the region's Redis. */
const startNode = (): EventsService => {
    const pending = new PendingDeliveryStore(
        {} as IConfig,
        { redis } as never,
        {} as never,
    );
    const head = pending.head.bind(pending);
    pending.head = async (...args: Parameters<typeof pending.head>) => {
        heads++;
        return head(...args);
    };
    const service = new EventsService(
        { events: { enabled: true } } as IConfig,
        {
            redis,
            event: { on: vi.fn(), emit: vi.fn() },
            alarm: { create: vi.fn() },
        } as never,
        { pendingDelivery: pending } as never,
        { jobs: { register: vi.fn() } } as never,
    );
    service.onServerStart();
    nodes.push(service);
    return service;
};

/** Let the sweeps the ticks started run to the end. */
const settled = async (): Promise<void> => {
    for (let i = 0; i < 20; i++)
        await new Promise((resolve) => setImmediate(resolve));
};

beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    redis = new MockRedis.Cluster(['redis://localhost:7001']);
    await redis.del('ev:qxs', 'ev:qxr');
    nodes = [];
    heads = 0;
});

afterEach(() => {
    for (const node of nodes) node.onServerPrepareShutdown();
    vi.useRealTimers();
});

describe('the pending sweep timer', () => {
    it('sweeps once per tick for the region, however many nodes tick', async () => {
        startNode();
        startNode();

        await vi.advanceTimersByTimeAsync(PENDING_SWEEP_INTERVAL_MS);
        await settled();

        expect(heads).toBe(1);
    });

    it('lets a lone node sweep on every tick', async () => {
        startNode();

        await vi.advanceTimersByTimeAsync(PENDING_SWEEP_INTERVAL_MS);
        await settled();
        await vi.advanceTimersByTimeAsync(PENDING_SWEEP_INTERVAL_MS);
        await settled();

        expect(heads).toBe(2);
    });
});
