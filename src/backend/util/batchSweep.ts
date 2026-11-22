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

export interface SweepInBatchesOptions {
    /** What each pass is asked to take. */
    batchSize: number;
    /** Passes one sweep runs at most. */
    maxBatches: number;
    /** Checked before each pass; an abort stops the sweep there. */
    signal?: AbortSignal;
}

/**
 * Run `pass` until one takes fewer than `batchSize` (the backlog is clear),
 * `maxBatches` have run, or `signal` aborts. Returns the total the passes
 * reported taking.
 */
export async function sweepInBatches(
    pass: (batchSize: number) => Promise<number>,
    { batchSize, maxBatches, signal }: SweepInBatchesOptions,
): Promise<number> {
    let total = 0;
    for (let i = 0; i < maxBatches && !signal?.aborted; i++) {
        const taken = await pass(batchSize);
        total += taken;
        if (taken < batchSize) break;
    }
    return total;
}
