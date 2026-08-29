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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EVENTS_COALESCE_WINDOW_MS } from '../../controllers/events/limits.js';
import { DeliveryCoalescer } from './coalescer.js';

let released: Array<[string, string]>;
let coalescer: DeliveryCoalescer<string>;

beforeEach(() => {
    vi.useFakeTimers();
    released = [];
    coalescer = new DeliveryCoalescer<string>(
        EVENTS_COALESCE_WINDOW_MS,
        (key, payload) => released.push([key, payload]),
    );
});

afterEach(() => {
    vi.useRealTimers();
});

it('turns a burst on one subject into one release', () => {
    for (let i = 0; i < 20; i++) coalescer.push('sub|fs:a:write', `v${i}`);

    vi.advanceTimersByTime(EVENTS_COALESCE_WINDOW_MS);

    expect(released).toEqual([['sub|fs:a:write', 'v19']]);
});

it('keeps distinct subjects apart', () => {
    coalescer.push('sub|fs:a:write', 'a');
    coalescer.push('sub|fs:b:write', 'b');

    vi.advanceTimersByTime(EVENTS_COALESCE_WINDOW_MS);

    expect(released).toEqual([
        ['sub|fs:a:write', 'a'],
        ['sub|fs:b:write', 'b'],
    ]);
});

it('keeps two subscriptions on one subject apart', () => {
    coalescer.push('one|fs:a:write', 'x');
    coalescer.push('two|fs:a:write', 'x');

    vi.advanceTimersByTime(EVENTS_COALESCE_WINDOW_MS);

    expect(released).toHaveLength(2);
});

it('holds nothing back before the window is up', () => {
    coalescer.push('sub|fs:a:write', 'a');

    vi.advanceTimersByTime(EVENTS_COALESCE_WINDOW_MS - 1);
    expect(released).toEqual([]);

    vi.advanceTimersByTime(1);
    expect(released).toHaveLength(1);
});

it('does not let a sustained writer hold the window open forever', () => {
    for (let tick = 0; tick < 10; tick++) {
        coalescer.push('sub|fs:a:write', `v${tick}`);
        vi.advanceTimersByTime(EVENTS_COALESCE_WINDOW_MS / 2);
    }

    expect(released.length).toBeGreaterThanOrEqual(4);
});

it('opens a fresh window after one closes', () => {
    coalescer.push('sub|fs:a:write', 'first');
    vi.advanceTimersByTime(EVENTS_COALESCE_WINDOW_MS);

    coalescer.push('sub|fs:a:write', 'second');
    vi.advanceTimersByTime(EVENTS_COALESCE_WINDOW_MS);

    expect(released.map(([, payload]) => payload)).toEqual([
        'first',
        'second',
    ]);
});

it('drops what a cancelled subscription had queued', () => {
    coalescer.push('gone|fs:a:write', 'a');
    coalescer.push('stays|fs:a:write', 'b');

    coalescer.cancel((key) => key.startsWith('gone|'));
    vi.advanceTimersByTime(EVENTS_COALESCE_WINDOW_MS);

    expect(released).toEqual([['stays|fs:a:write', 'b']]);
    expect(coalescer.pendingCount).toBe(0);
});
