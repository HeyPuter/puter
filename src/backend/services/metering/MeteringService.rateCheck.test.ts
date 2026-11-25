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
import { MeteringService } from './MeteringService.ts';

const SHARDS = 8;
const PER_SHARD = 1000;
const MONTH = new Date().toISOString().slice(0, 7);

/** `checkRateOfChange` is private; call it through this narrowed view. */
type RateCheckable = { checkRateOfChange(): Promise<void> };

const makeService = (
    config: Record<string, unknown>,
    baseline: unknown,
): {
    svc: RateCheckable;
    kv: {
        get: ReturnType<typeof vi.fn>;
        list: ReturnType<typeof vi.fn>;
        set: ReturnType<typeof vi.fn>;
    };
    alarmCreate: ReturnType<typeof vi.fn>;
} => {
    const kv = {
        get: vi.fn(async () => ({ res: baseline })),
        list: vi.fn(async () => ({
            res: {
                items: Array.from({ length: SHARDS }, (_, shard) => ({
                    key: `metering:v2:puter:${shard}:${MONTH}`,
                    value: { total: PER_SHARD },
                })),
            },
            usage: { read: 0, write: 0, cachedRead: 0 },
        })),
        set: vi.fn(async () => ({ res: true })),
    };
    const alarmCreate = vi.fn();
    const svc = new MeteringService(
        config as never,
        { alarm: { create: alarmCreate } } as never,
        { kv } as never,
    ) as unknown as RateCheckable;
    return { svc, kv, alarmCreate };
};

describe('MeteringService.checkRateOfChange', () => {
    it.each([undefined, 0, -1, NaN])(
        'reads and writes nothing when maxGlobalUsagePerMinute is %s',
        async (maxGlobalUsagePerMinute) => {
            const { svc, kv, alarmCreate } = makeService(
                { maxGlobalUsagePerMinute },
                null,
            );

            await svc.checkRateOfChange();

            expect(kv.get).not.toHaveBeenCalled();
            expect(kv.list).not.toHaveBeenCalled();
            expect(kv.set).not.toHaveBeenCalled();
            expect(alarmCreate).not.toHaveBeenCalled();
        },
    );

    it('reads global usage and writes a baseline when none exists yet', async () => {
        const { svc, kv, alarmCreate } = makeService(
            { maxGlobalUsagePerMinute: 100 },
            null,
        );

        await svc.checkRateOfChange();

        expect(kv.get).toHaveBeenCalledTimes(1);
        expect(kv.get.mock.calls[0][0].key).toBe(
            'metering:lastGlobalUsageCheck',
        );
        expect(kv.list).toHaveBeenCalledTimes(1);
        expect(kv.list.mock.calls[0][0].keyPrefix).toBe('metering:v2:puter:');

        expect(kv.set).toHaveBeenCalledTimes(1);
        const setArg = kv.set.mock.calls[0][0];
        expect(setArg.value.total).toBe(SHARDS * PER_SHARD);
        expect(typeof setArg.value.timestamp).toBe('number');

        expect(alarmCreate).not.toHaveBeenCalled();
    });

    describe('with a 16-minute-old baseline', () => {
        const baseline = () => ({
            total: 0,
            timestamp: Date.now() - 16 * 60_000,
        });

        it('raises the alarm when the rate exceeds the max', async () => {
            const { svc, alarmCreate } = makeService(
                { maxGlobalUsagePerMinute: 100 },
                baseline(),
            );

            await svc.checkRateOfChange();

            expect(alarmCreate).toHaveBeenCalledWith(
                'metering:excessiveGlobalUsageRate',
                expect.any(String),
                expect.any(Object),
                'warning',
            );
        });

        it('does not raise the alarm when the rate is within the max', async () => {
            const { svc, alarmCreate } = makeService(
                { maxGlobalUsagePerMinute: 1e9 },
                baseline(),
            );

            await svc.checkRateOfChange();

            expect(alarmCreate).not.toHaveBeenCalled();
        });
    });

    it('skips the shard read when the baseline is only 5 minutes old', async () => {
        const { svc, kv, alarmCreate } = makeService(
            { maxGlobalUsagePerMinute: 100 },
            { total: 0, timestamp: Date.now() - 5 * 60_000 },
        );

        await svc.checkRateOfChange();

        expect(kv.get).toHaveBeenCalledTimes(1);
        expect(kv.list).not.toHaveBeenCalled();
        expect(kv.set).not.toHaveBeenCalled();
        expect(alarmCreate).not.toHaveBeenCalled();
    });
});
