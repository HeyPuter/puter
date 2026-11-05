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

import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
    CONSENT_CONFIRMED_TTL_MS,
    CONSENT_SETTLE_WINDOW_MS,
    CONSENT_SETTLES_PER_WINDOW,
    ConsentSettles,
} from './consentSettles.js';

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
});

afterEach(() => {
    vi.useRealTimers();
});

it('runs one check per pair at a time', () => {
    const settles = new ConsentSettles();
    expect(settles.begin('1|app')).toBe('start');
    expect(settles.begin('1|app')).toBe('skip');
    expect(settles.begin('2|app')).toBe('start');
    settles.end('1|app');
    expect(settles.begin('1|app')).toBe('start');
});

it('skips a pair a fresh read just confirmed, until that lapses', () => {
    const settles = new ConsentSettles();
    settles.begin('1|app');
    settles.confirm('1|app');
    settles.end('1|app');
    expect(settles.begin('1|app')).toBe('skip');

    vi.setSystemTime(Date.now() + CONSENT_CONFIRMED_TTL_MS + 1);
    expect(settles.begin('1|app')).toBe('start');
});

it('stops settling once the window budget is spent, and resets after it', () => {
    const settles = new ConsentSettles();
    for (let i = 0; i < CONSENT_SETTLES_PER_WINDOW; i++)
        expect(settles.take()).toBe(true);
    expect(settles.take()).toBe(false);
    // Spent means no check either: nothing it could settle.
    expect(settles.begin('1|app')).toBe('spent');

    vi.setSystemTime(Date.now() + CONSENT_SETTLE_WINDOW_MS);
    expect(settles.begin('1|app')).toBe('start');
    expect(settles.take()).toBe(true);
});
