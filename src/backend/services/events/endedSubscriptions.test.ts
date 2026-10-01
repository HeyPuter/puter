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
import {
    ENDED_SUBSCRIPTIONS_MAX_ENTRIES,
    ENDED_SUBSCRIPTIONS_TTL_MS,
    EndedSubscriptions,
} from './endedSubscriptions.js';

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
});

afterEach(() => {
    vi.useRealTimers();
});

it('remembers a subscription it was told ended', () => {
    const ended = new EndedSubscriptions();
    ended.mark('sub-1');
    expect(ended.has('sub-1')).toBe(true);
    expect(ended.has('sub-2')).toBe(false);
});

it('forgets it once the window has passed', () => {
    const ended = new EndedSubscriptions();
    ended.mark('sub-1');

    vi.setSystemTime(Date.now() + ENDED_SUBSCRIPTIONS_TTL_MS);
    expect(ended.has('sub-1')).toBe(true);

    vi.setSystemTime(Date.now() + 1);
    expect(ended.has('sub-1')).toBe(false);
});

it('drops the oldest past its cap', () => {
    const ended = new EndedSubscriptions();
    for (let i = 0; i < ENDED_SUBSCRIPTIONS_MAX_ENTRIES; i++)
        ended.mark(`sub-${i}`);
    expect(ended.has('sub-0')).toBe(true);

    ended.mark('sub-overflow');
    expect(ended.size).toBe(ENDED_SUBSCRIPTIONS_MAX_ENTRIES);
    expect(ended.has('sub-0')).toBe(false);
    expect(ended.has('sub-overflow')).toBe(true);
});
