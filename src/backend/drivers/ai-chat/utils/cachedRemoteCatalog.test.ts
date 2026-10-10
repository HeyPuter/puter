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
import { cachedRemoteCatalog } from './cachedRemoteCatalog.js';

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
