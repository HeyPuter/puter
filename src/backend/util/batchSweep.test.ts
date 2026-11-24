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

import { describe, expect, it } from 'vitest';
import { sweepInBatches } from './batchSweep';

/** A backlog of `size` rows, taken `batchSize` at a time. */
const backlog = (size: number) => {
    let left = size;
    const asked: number[] = [];
    return {
        asked,
        pass: async (batchSize: number) => {
            asked.push(batchSize);
            const taken = Math.min(batchSize, left);
            left -= taken;
            return taken;
        },
    };
};

describe('sweepInBatches', () => {
    it('stops at the first short pass and reports the total', async () => {
        const { asked, pass } = backlog(25);
        await expect(
            sweepInBatches(pass, { batchSize: 10, maxBatches: 100 }),
        ).resolves.toBe(25);
        expect(asked).toEqual([10, 10, 10]);
    });

    it('runs one more pass after an exact multiple, which comes back empty', async () => {
        const { asked, pass } = backlog(20);
        await sweepInBatches(pass, { batchSize: 10, maxBatches: 100 });
        expect(asked).toHaveLength(3);
    });

    it('stops at the batch cap', async () => {
        const { asked, pass } = backlog(1_000);
        await expect(
            sweepInBatches(pass, { batchSize: 10, maxBatches: 2 }),
        ).resolves.toBe(20);
        expect(asked).toHaveLength(2);
    });

    it('stops before the next pass once the signal aborts', async () => {
        const controller = new AbortController();
        let passes = 0;
        const total = await sweepInBatches(
            async (batchSize) => {
                passes++;
                if (passes === 2) controller.abort();
                return batchSize;
            },
            { batchSize: 10, maxBatches: 100, signal: controller.signal },
        );
        expect(passes).toBe(2);
        expect(total).toBe(20);
    });

    it('runs nothing with an already aborted signal', async () => {
        const { asked, pass } = backlog(10);
        await expect(
            sweepInBatches(pass, {
                batchSize: 10,
                maxBatches: 5,
                signal: AbortSignal.abort(),
            }),
        ).resolves.toBe(0);
        expect(asked).toEqual([]);
    });
});
