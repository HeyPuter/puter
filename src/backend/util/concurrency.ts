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
    return runWithConcurrencyLimit(
        values,
        concurrency,
        async (value, index): Promise<PromiseSettledResult<TOutput>> => {
            try {
                return {
                    status: 'fulfilled',
                    value: await worker(value, index),
                };
            } catch (reason) {
                return { status: 'rejected', reason };
            }
        },
    );
}

/**
 * For a promise started before the code that needs it: marks it handled, so an
 * early return or throw that never awaits it doesn't leave an unhandled
 * rejection. Its rejection still surfaces where it is awaited.
 */
export function awaitLater<T>(promise: Promise<T>): Promise<T> {
    void (async () => {
        try {
            await promise;
        } catch {
            // Surfaced where awaited.
        }
    })();
    return promise;
}

/**
 * Waits for `promise` for at most `ms`, without rejecting. Resolves `true` if
 * it settled in time, `false` if the time ran out first.
 */
export async function settleWithin(
    promise: Promise<unknown>,
    ms: number,
): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settled = async () => {
        try {
            await promise;
        } catch {
            // Callers report work failures.
        }
        return true;
    };
    try {
        return await Promise.race([
            settled(),
            new Promise<boolean>((resolve) => {
                timer = setTimeout(() => resolve(false), ms);
            }),
        ]);
    } finally {
        clearTimeout(timer);
    }
}

/**
 * `promise`, or a rejection once `ms` passes first: `makeError()` when given,
 * else the `TimeoutError` `AbortSignal.timeout` rejects with. A non-finite `ms`
 * sets no deadline. The timer doesn't hold the process open.
 */
export async function withTimeout<T>(
    promise: Promise<T>,
    ms: number,
    makeError?: () => unknown,
): Promise<T> {
    if (!Number.isFinite(ms)) return promise;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            promise,
            new Promise<never>((_resolve, reject) => {
                timer = setTimeout(
                    () =>
                        reject(
                            makeError
                                ? makeError()
                                : new DOMException(
                                      'The operation was aborted due to timeout',
                                      'TimeoutError',
                                  ),
                        ),
                    Math.max(0, ms),
                );
                timer.unref?.();
            }),
        ]);
    } finally {
        clearTimeout(timer);
    }
}

/** `items` split into consecutive slices of at most `size` (at least 1). */
export function chunk<T>(items: readonly T[], size: number): T[][] {
    const step = size >= 1 ? Math.floor(size) : 1;
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += step) {
        out.push(items.slice(i, i + step));
    }
    return out;
}
