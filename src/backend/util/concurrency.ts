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

export async function runWithConcurrencyLimit<TInput, TOutput>(
    values: TInput[],
    concurrency: number,
    worker: (value: TInput, index: number) => Promise<TOutput>,
): Promise<TOutput[]> {
    if (values.length === 0) {
        return [];
    }

    const limit = Math.max(1, concurrency);
    const results = new Array<TOutput>(values.length);
    let nextIndex = 0;

    const runWorker = async () => {
        while (true) {
            const index = nextIndex;
            if (index >= values.length) {
                return;
            }
            nextIndex++;
            const value = values[index];
            if (value === undefined) {
                throw new Error(`Missing value at index ${index}`);
            }
            results[index] = await worker(value, index);
        }
    };

    const workerCount = Math.min(limit, values.length);
    await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
    return results;
}

export async function runWithConcurrencyLimitSettled<TInput, TOutput>(
    values: TInput[],
    concurrency: number,
    worker: (value: TInput, index: number) => Promise<TOutput>,
): Promise<PromiseSettledResult<TOutput>[]> {
    if (values.length === 0) {
        return [];
    }

    const limit = Math.max(1, concurrency);
    const results = new Array<PromiseSettledResult<TOutput>>(values.length);
    let nextIndex = 0;

    const runWorker = async () => {
        while (true) {
            const index = nextIndex;
            if (index >= values.length) {
                return;
            }
            nextIndex++;
            const value = values[index];
            if (value === undefined) {
                throw new Error(`Missing value at index ${index}`);
            }

            try {
                const output = await worker(value, index);
                results[index] = {
                    status: 'fulfilled',
                    value: output,
                };
            } catch (error) {
                results[index] = {
                    status: 'rejected',
                    reason: error,
                };
            }
        }
    };

    const workerCount = Math.min(limit, values.length);
    await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
    return results;
}
