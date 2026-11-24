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

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    cachedRemoteCatalog,
    refreshingCatalogs,
} from './cachedRemoteCatalog.js';

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('cachedRemoteCatalog', () => {
    it('serves a fetched value until it expires, then fetches again', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        const fetch = vi.fn(async () => ['a']);
        const get = cachedRemoteCatalog({
            name: 'test',
            fetch,
            fallback: [],
            ttlMs: 1000,
        });

        expect(await get()).toEqual(['a']);
        expect(await get()).toEqual(['a']);
        expect(fetch).toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(1001);
        await get();
        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('shares one fetch between concurrent callers', async () => {
        let resolve!: (value: string[]) => void;
        const fetch = vi.fn(
            () =>
                new Promise<string[]>((r) => {
                    resolve = r;
                }),
        );
        const get = cachedRemoteCatalog({ name: 'test', fetch, fallback: [] });

        const results = Promise.all([get(), get(), get()]);
        resolve(['a']);

        expect(await results).toEqual([['a'], ['a'], ['a']]);
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('returns the fallback after a failure and does not refetch until the failure expires', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const fetch = vi.fn(async (): Promise<string[]> => {
            throw new Error('down');
        });
        const get = cachedRemoteCatalog({
            name: 'test',
            fetch,
            fallback: [],
            failureTtlMs: 500,
        });

        expect(await get()).toEqual([]);
        expect(await get()).toEqual([]);
        expect(fetch).toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(501);
        await get();
        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('keeps serving the last good value when a refresh fails', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const fetch = vi
            .fn<() => Promise<string[]>>()
            .mockResolvedValueOnce(['a'])
            .mockRejectedValueOnce(new Error('down'));
        const get = cachedRemoteCatalog({
            name: 'test',
            fetch,
            fallback: [],
            ttlMs: 1000,
        });

        expect(await get()).toEqual(['a']);
        vi.advanceTimersByTime(1001);
        expect(await get()).toEqual(['a']);
        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('abandons a fetch that runs past the timeout', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const fetch = vi.fn(
            (signal: AbortSignal) =>
                new Promise<string[]>((_resolve, reject) => {
                    signal.addEventListener('abort', () =>
                        reject(signal.reason),
                    );
                }),
        );
        const get = cachedRemoteCatalog({
            name: 'test',
            fetch,
            fallback: ['fallback'],
            timeoutMs: 10,
        });

        expect(await get()).toEqual(['fallback']);
        expect(fetch.mock.calls[0]![0].aborted).toBe(true);
    });

    it('logs an outage once, and again only after a recovery', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const fetch = vi
            .fn<() => Promise<string[]>>()
            .mockRejectedValueOnce(new Error('down'))
            .mockRejectedValueOnce(new Error('down'))
            .mockResolvedValueOnce(['a'])
            .mockRejectedValueOnce(new Error('down'));
        const get = cachedRemoteCatalog({
            name: 'test',
            fetch,
            fallback: [],
            ttlMs: 0,
            failureTtlMs: 0,
        });

        await get();
        await get();
        expect(warn).toHaveBeenCalledTimes(1);
        await get();
        await get();
        expect(warn).toHaveBeenCalledTimes(2);
    });

    it('treats a synchronous throw like any other failure', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const fetch = vi.fn((): Promise<string[]> => {
            throw new Error('bad config');
        });
        const get = cachedRemoteCatalog({
            name: 'test',
            fetch,
            fallback: [],
            failureTtlMs: 0,
        });

        expect(await get()).toEqual([]);
        expect(await get()).toEqual([]);
        expect(fetch).toHaveBeenCalledTimes(2);
    });
});


it('passes the last successful snapshot to a refresh without exposing the fallback as fetched data', async () => {
    const fetch = vi.fn(async (_signal: AbortSignal, previous?: string[]) => [...(previous ?? []), 'model']);
    const get = cachedRemoteCatalog({ name: 'fixture', fetch, fallback: ['fallback'], ttlMs: 0 });
    expect(await get()).toEqual(['model']);
    expect(fetch.mock.calls[0][1]).toBeUndefined();
    expect(await get()).toEqual(['model', 'model']);
    expect(fetch.mock.calls[1][1]).toEqual(['model']);
});

describe('cachedRemoteCatalog read modes', () => {
    const PENDING = Symbol('pending');
    /** What a promise settles to once the microtask queue drains, else PENDING. */
    const settled = <T>(promise: Promise<T>) =>
        Promise.race([
            promise,
            new Promise<typeof PENDING>((resolve) =>
                setImmediate(() => resolve(PENDING)),
            ),
        ]);
    const flush = () => new Promise((resolve) => setImmediate(resolve));
    const deferred = <T>() => {
        let resolve!: (value: T) => void;
        let reject!: (reason: unknown) => void;
        const promise = new Promise<T>((res, rej) => {
            resolve = res;
            reject = rej;
        });
        return { promise, resolve, reject };
    };
    /** A catalog holding `['a']` that has just gone stale. */
    const staleCatalog = async (
        fetch: () => Promise<string[]>,
        options: { failureTtlMs?: number; staleWhileRevalidate?: boolean } = {},
    ) => {
        vi.useFakeTimers({ toFake: ['Date'] });
        const get = cachedRemoteCatalog({
            name: 'test',
            fetch,
            fallback: [],
            ttlMs: 1000,
            ...options,
        });
        expect(await get()).toEqual(['a']);
        vi.advanceTimersByTime(1001);
        return get;
    };

    it('refetches on every scheduled tick when the fetch takes time', async () => {
        vi.useFakeTimers({
            toFake: ['Date', 'setTimeout', 'setInterval', 'clearInterval'],
        });
        const fetch = vi.fn(
            () =>
                new Promise<string[]>((resolve) =>
                    setTimeout(() => resolve(['a']), 200),
                ),
        );
        const get = cachedRemoteCatalog({
            name: 'test',
            fetch,
            fallback: [],
            ttlMs: 1000,
        });
        const interval = setInterval(() => void refreshingCatalogs(get), 1000);
        try {
            const first = get();
            await vi.advanceTimersByTimeAsync(200);
            await first;
            for (let tick = 0; tick < 6; tick++)
                await vi.advanceTimersByTimeAsync(1000);
            expect(fetch).toHaveBeenCalledTimes(7);
        } finally {
            clearInterval(interval);
        }
    });

    it('refetches when a scheduled tick lands on or just before the expiry millisecond', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        const fetch = vi.fn(async () => ['a']);
        const get = cachedRemoteCatalog({
            name: 'test',
            fetch,
            fallback: [],
            ttlMs: 1000,
        });
        await get();

        vi.advanceTimersByTime(999);
        await refreshingCatalogs(get);
        expect(fetch).toHaveBeenCalledTimes(2);

        vi.advanceTimersByTime(1000);
        await refreshingCatalogs(get);
        expect(fetch).toHaveBeenCalledTimes(3);
    });

    it('fetches a catalog once per scheduled refresh, however often the refresh reads it', async () => {
        const fetch = vi
            .fn<() => Promise<string[]>>()
            .mockResolvedValueOnce(['a'])
            .mockResolvedValueOnce(['b']);
        const get = await staleCatalog(fetch);

        const reads = await refreshingCatalogs(async () => [
            await get(),
            await get(),
        ]);

        expect(reads).toEqual([['b'], ['b']]);
        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('serves the stored copy while a stale read revalidates, then the new one', async () => {
        const next = deferred<string[]>();
        const fetch = vi
            .fn<() => Promise<string[]>>()
            .mockResolvedValueOnce(['a'])
            .mockReturnValueOnce(next.promise);
        const get = await staleCatalog(fetch, {
            staleWhileRevalidate: true,
        });

        expect(await settled(get())).toEqual(['a']);

        next.resolve(['b']);
        await flush();
        expect(await get()).toEqual(['b']);
        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('starts one revalidation for concurrent stale reads', async () => {
        const fetch = vi
            .fn<() => Promise<string[]>>()
            .mockResolvedValueOnce(['a'])
            .mockReturnValue(new Promise(() => {}));
        const get = await staleCatalog(fetch, {
            staleWhileRevalidate: true,
        });

        const reads = await Promise.all(
            [get(), get(), get(), get(), get()].map(settled),
        );

        expect(reads).toEqual([['a'], ['a'], ['a'], ['a'], ['a']]);
        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('keeps the stored copy when a background revalidation fails, waits out the failure window, and leaves no unhandled rejection', async () => {
        const unhandled = vi.fn();
        process.on('unhandledRejection', unhandled);
        try {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const failing = deferred<string[]>();
            const fetch = vi
                .fn<() => Promise<string[]>>()
                .mockResolvedValueOnce(['a'])
                .mockReturnValueOnce(failing.promise)
                .mockRejectedValue(new Error('down'));
            const get = await staleCatalog(fetch, {
                staleWhileRevalidate: true,
            });

            expect(await settled(get())).toEqual(['a']);
            failing.reject(new Error('down'));
            await flush();

            // Inside the failure window neither kind of read asks again.
            expect(await settled(get())).toEqual(['a']);
            expect(await refreshingCatalogs(get)).toEqual(['a']);
            expect(fetch).toHaveBeenCalledTimes(2);

            vi.advanceTimersByTime(30_001);
            expect(await settled(get())).toEqual(['a']);
            expect(fetch).toHaveBeenCalledTimes(3);
            await flush();

            expect(warn).toHaveBeenCalledTimes(1);
            expect(unhandled).not.toHaveBeenCalled();
        } finally {
            process.off('unhandledRejection', unhandled);
        }
    });

    it('survives a background revalidation that fails with a value it cannot print', async () => {
        const unhandled = vi.fn();
        process.on('unhandledRejection', unhandled);
        try {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const fetch = vi
                .fn<() => Promise<string[]>>()
                .mockResolvedValueOnce(['a'])
                .mockRejectedValueOnce(Object.create(null))
                .mockResolvedValueOnce(['b']);
            const get = await staleCatalog(fetch, {
                failureTtlMs: 0,
                staleWhileRevalidate: true,
            });

            expect(await settled(get())).toEqual(['a']);
            await flush();
            expect(warn).toHaveBeenCalledTimes(1);
            expect(unhandled).not.toHaveBeenCalled();

            expect(await refreshingCatalogs(get)).toEqual(['b']);
        } finally {
            process.off('unhandledRejection', unhandled);
        }
    });

    it('refetches for a read in a scheduled refresh that began more than a TTL ago', async () => {
        const fetch = vi
            .fn<() => Promise<string[]>>()
            .mockResolvedValueOnce(['a'])
            .mockResolvedValueOnce(['b'])
            .mockResolvedValueOnce(['c']);
        const get = await staleCatalog(fetch);

        const reads = await refreshingCatalogs(async () => {
            const first = await get();
            vi.advanceTimersByTime(1001);
            return [first, await get()];
        });

        expect(reads).toEqual([['b'], ['c']]);
    });

    it('starts a new revalidation after one that threw synchronously', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const fetch = vi
            .fn<() => Promise<string[]>>()
            .mockResolvedValueOnce(['a'])
            .mockImplementationOnce(() => {
                throw new Error('bad config');
            })
            .mockResolvedValueOnce(['b']);
        const get = await staleCatalog(fetch, {
            failureTtlMs: 0,
            staleWhileRevalidate: true,
        });

        expect(await settled(get())).toEqual(['a']);
        await flush();
        expect(await settled(get())).toEqual(['a']);
        await flush();

        expect(await get()).toEqual(['b']);
        expect(fetch).toHaveBeenCalledTimes(3);
    });

    it('has a scheduled read join a background revalidation already in flight', async () => {
        const next = deferred<string[]>();
        const fetch = vi
            .fn<() => Promise<string[]>>()
            .mockResolvedValueOnce(['a'])
            .mockReturnValueOnce(next.promise);
        const get = await staleCatalog(fetch, {
            staleWhileRevalidate: true,
        });

        expect(await settled(get())).toEqual(['a']);
        const scheduled = refreshingCatalogs(get);
        expect(await settled(scheduled)).toBe(PENDING);

        next.resolve(['b']);
        expect(await scheduled).toEqual(['b']);
        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('makes a cold read wait for the first fetch', async () => {
        const first = deferred<string[]>();
        const fetch = vi.fn(() => first.promise);
        const get = cachedRemoteCatalog({ name: 'test', fetch, fallback: [] });

        const read = get();
        expect(await settled(read)).toBe(PENDING);

        first.resolve(['a']);
        expect(await read).toEqual(['a']);
    });

    it('makes a stale read wait for the new copy unless the catalog opts into stale-while-revalidate', async () => {
        const next = deferred<string[]>();
        const fetch = vi
            .fn<() => Promise<string[]>>()
            .mockResolvedValueOnce(['a'])
            .mockReturnValueOnce(next.promise);
        const get = await staleCatalog(fetch);

        const read = get();
        expect(await settled(read)).toBe(PENDING);

        next.resolve(['b']);
        expect(await read).toEqual(['b']);
    });
});
