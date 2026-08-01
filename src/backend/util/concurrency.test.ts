/**
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

import { describe, expect, it } from 'vitest';
import {
    runWithConcurrencyLimit,
    runWithConcurrencyLimitSettled,
} from './concurrency.ts';

/**
 * Worker that records the peak number of simultaneously-running calls so a test
 * can assert the limit was actually respected (not just that every value was
 * visited).
 */
const makeTracker = () => {
    const state = { active: 0, peak: 0, order: [] as number[] };
    const worker = async <T>(value: T, index: number): Promise<T> => {
        state.active++;
        state.peak = Math.max(state.peak, state.active);
        state.order.push(index);
        await new Promise((r) => setTimeout(r, 5));
        state.active--;
        return value;
    };
    return { state, worker };
};

describe('runWithConcurrencyLimit', () => {
    it('returns results in input order regardless of completion order', async () => {
        // Later items finish first — the result array must still line up
        // with the input positions.
        const out = await runWithConcurrencyLimit(
            [40, 30, 20, 10],
            4,
            async (ms, i) => {
                await new Promise((r) => setTimeout(r, ms));
                return `${i}:${ms}`;
            },
        );
        expect(out).toEqual(['0:40', '1:30', '2:20', '3:10']);
    });

    it('never runs more than `concurrency` workers at once', async () => {
        const { state, worker } = makeTracker();
        const values = Array.from({ length: 12 }, (_, i) => i);
        const out = await runWithConcurrencyLimit(values, 3, worker);
        expect(out).toEqual(values);
        expect(state.peak).toBe(3);
    });

    it('clamps a non-positive concurrency to a single worker', async () => {
        const { state, worker } = makeTracker();
        await runWithConcurrencyLimit([1, 2, 3], 0, worker);
        expect(state.peak).toBe(1);

        const negative = makeTracker();
        await runWithConcurrencyLimit([1, 2, 3], -5, negative.worker);
        expect(negative.state.peak).toBe(1);
    });

    it('spawns at most one worker per value when concurrency exceeds the input size', async () => {
        const { state, worker } = makeTracker();
        await runWithConcurrencyLimit([1, 2], 50, worker);
        expect(state.peak).toBe(2);
    });

    it('short-circuits on an empty input without invoking the worker', async () => {
        let calls = 0;
        const out = await runWithConcurrencyLimit([], 4, async (v) => {
            calls++;
            return v;
        });
        expect(out).toEqual([]);
        expect(calls).toBe(0);
    });

    it('rejects with the worker error and stops handing out further values', async () => {
        const seen: number[] = [];
        await expect(
            runWithConcurrencyLimit([1, 2, 3, 4], 1, async (value) => {
                seen.push(value);
                if (value === 2) throw new Error('boom');
                return value;
            }),
        ).rejects.toThrow('boom');
        // Single worker, so nothing past the failure is attempted.
        expect(seen).toEqual([1, 2]);
    });

    it('rejects on an undefined hole rather than calling the worker with undefined', async () => {
        const seen: unknown[] = [];
        await expect(
            runWithConcurrencyLimit(
                [1, undefined, 3] as unknown as number[],
                1,
                async (value) => {
                    seen.push(value);
                    return value;
                },
            ),
        ).rejects.toThrow('Missing value at index 1');
        expect(seen).toEqual([1]);
    });
});

describe('runWithConcurrencyLimitSettled', () => {
    it('reports per-value fulfilled/rejected outcomes in input order', async () => {
        const results = await runWithConcurrencyLimitSettled(
            ['a', 'bad', 'c'],
            2,
            async (value) => {
                if (value === 'bad') throw new Error('nope');
                return value.toUpperCase();
            },
        );
        expect(results).toEqual([
            { status: 'fulfilled', value: 'A' },
            { status: 'rejected', reason: expect.any(Error) },
            { status: 'fulfilled', value: 'C' },
        ]);
        expect((results[1] as PromiseRejectedResult).reason.message).toBe(
            'nope',
        );
    });

    it('keeps processing every remaining value after a failure', async () => {
        const seen: number[] = [];
        const results = await runWithConcurrencyLimitSettled(
            [1, 2, 3, 4],
            1,
            async (value) => {
                seen.push(value);
                if (value === 2) throw new Error('boom');
                return value;
            },
        );
        expect(seen).toEqual([1, 2, 3, 4]);
        expect(results.map((r) => r.status)).toEqual([
            'fulfilled',
            'rejected',
            'fulfilled',
            'fulfilled',
        ]);
    });

    it('never runs more than `concurrency` workers at once', async () => {
        const { state, worker } = makeTracker();
        const values = Array.from({ length: 10 }, (_, i) => i);
        await runWithConcurrencyLimitSettled(values, 4, worker);
        expect(state.peak).toBe(4);
    });

    it('clamps a non-positive concurrency to a single worker', async () => {
        const { state, worker } = makeTracker();
        await runWithConcurrencyLimitSettled([1, 2, 3], 0, worker);
        expect(state.peak).toBe(1);
    });

    it('short-circuits on an empty input without invoking the worker', async () => {
        let calls = 0;
        const out = await runWithConcurrencyLimitSettled([], 4, async (v) => {
            calls++;
            return v;
        });
        expect(out).toEqual([]);
        expect(calls).toBe(0);
    });

    it('throws (rather than settling) when the input has an undefined hole', async () => {
        // The hole check is deliberately outside the per-value try/catch —
        // a sparse input is a programming error, not a worker failure.
        await expect(
            runWithConcurrencyLimitSettled(
                [undefined] as unknown as number[],
                1,
                async (value) => value,
            ),
        ).rejects.toThrow('Missing value at index 0');
    });
});
