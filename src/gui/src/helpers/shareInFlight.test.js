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

import { describe, expect, it, vi } from 'vitest';
import shareInFlight from './shareInFlight.js';

describe('shareInFlight', () => {
    it('gives overlapping callers the same call', async () => {
        const fn = vi.fn(async () => 'answer');
        const shared = shareInFlight(fn);
        const [a, b] = await Promise.all([shared(), shared()]);
        expect(fn).toHaveBeenCalledTimes(1);
        expect(a).toBe('answer');
        expect(b).toBe('answer');
    });

    it('calls again once the previous call has settled', async () => {
        const fn = vi.fn(async () => 'answer');
        const shared = shareInFlight(fn);
        await shared();
        await shared();
        expect(fn).toHaveBeenCalledTimes(2);
    });

    it('shares a rejection, then lets the next call retry', async () => {
        const fn = vi.fn()
            .mockRejectedValueOnce(new Error('boom'))
            .mockResolvedValueOnce('answer');
        const shared = shareInFlight(fn);
        const first = shared();
        const second = shared();
        await expect(first).rejects.toThrow('boom');
        await expect(second).rejects.toThrow('boom');
        await expect(shared()).resolves.toBe('answer');
        expect(fn).toHaveBeenCalledTimes(2);
    });
});
