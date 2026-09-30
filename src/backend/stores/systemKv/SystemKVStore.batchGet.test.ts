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

import { describe, expect, it, vi } from 'vitest';
import {
    KV_BATCH_GET_CONCURRENCY,
    KV_BATCH_GET_LIMIT,
    SystemKVStore,
} from './SystemKVStore.ts';
import { PUTER_KV_STORE_TABLE_NAME } from './tableDefinition.ts';

type BatchGetRequest = {
    table: string;
    items: { namespace: string; key: string };
};

/** Fake `DDBClient.batchGet` that tracks peak concurrency. */
const makeBatchGet = (opts: { failOnCall?: number } = {}) => {
    let active = 0;
    let peak = 0;
    let callCount = 0;

    const batchGet = vi.fn(async (reqs: BatchGetRequest[]) => {
        callCount++;
        const thisCall = callCount;
        active++;
        peak = Math.max(peak, active);
        try {
            await new Promise((resolve) => setTimeout(resolve, 0));
            if (opts.failOnCall && thisCall === opts.failOnCall) {
                throw new Error('dynamo unavailable');
            }
            return {
                Responses: {
                    [PUTER_KV_STORE_TABLE_NAME]: reqs.map((r) => ({
                        key: r.items.key,
                        value: 'v:' + r.items.key,
                    })),
                },
                ConsumedCapacity: [
                    {
                        TableName: PUTER_KV_STORE_TABLE_NAME,
                        CapacityUnits: reqs.length * 0.5,
                    },
                ],
            };
        } finally {
            active--;
        }
    });

    return { batchGet, getPeak: () => peak };
};

describe('SystemKVStore batch-get concurrency', () => {
    it('bounds concurrency and sums usage', async () => {
        const keys = Array.from({ length: 1050 }, (_, i) => `key-${i}`);
        const { batchGet, getPeak } = makeBatchGet();
        const store = new SystemKVStore(
            {} as never,
            { dynamo: { batchGet } } as never,
        );

        const { res, usage } = await store.get({ key: keys });

        expect(batchGet).toHaveBeenCalledTimes(11);
        for (const call of batchGet.mock.calls) {
            expect(call[0].length).toBeLessThanOrEqual(KV_BATCH_GET_LIMIT);
        }
        expect(getPeak()).toBe(KV_BATCH_GET_CONCURRENCY);
        expect(res).toEqual(keys.map((k) => 'v:' + k));
        expect(usage.read).toBe(525);
    });

    it('propagates the first rejection', async () => {
        const keys = Array.from({ length: 1050 }, (_, i) => `key-${i}`);
        const { batchGet } = makeBatchGet({ failOnCall: 2 });
        const store = new SystemKVStore(
            {} as never,
            { dynamo: { batchGet } } as never,
        );

        await expect(store.get({ key: keys })).rejects.toThrow(
            'dynamo unavailable',
        );
    });
});
