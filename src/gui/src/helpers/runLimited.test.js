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
import { runLimited } from './runLimited.js';

describe('runLimited', () => {
    it('runs every item, never more than the limit at once', async () => {
        let running = 0;
        let peak = 0;
        const done = [];
        await runLimited([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
            running++;
            peak = Math.max(peak, running);
            await new Promise(resolve => setTimeout(resolve, 5));
            done.push(n);
            running--;
        });
        expect(done.sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
        expect(peak).toBe(3);
    });

    it('resolves to the items whose task rejected, after running the rest', async () => {
        const failed = await runLimited(['a', 'b', 'c'], 2, async (item) => {
            if ( item === 'b' ) throw new Error('no');
        });
        expect(failed).toEqual(['b']);
    });

    it('does nothing for no items', async () => {
        expect(await runLimited([], 4, async () => {})).toEqual([]);
    });
});
