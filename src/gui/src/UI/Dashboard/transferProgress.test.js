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
import { clampPercent, createRemainingEstimator, roundSecondsLeft, summarizeUpload } from './transferProgress.js';

describe('clampPercent', () => {
    it('clamps to 0-100, keeping fractions', () => {
        expect(clampPercent(42.6)).toBe(42.6);
        expect(clampPercent(-5)).toBe(0);
        expect(clampPercent(140)).toBe(100);
    });

    it('reads strings, including toPrecision output', () => {
        expect(clampPercent('37.25')).toBe(37.25);
        expect(clampPercent((100).toPrecision(2))).toBe(100);
        expect(clampPercent('nope')).toBe(0);
    });
});

describe('createRemainingEstimator', () => {
    const clock = () => {
        let t = 0;
        return { now: () => t, advance: (ms) => { t += ms; } };
    };

    it('stays quiet until the transfer has run long enough to judge', () => {
        const c = clock();
        const estimator = createRemainingEstimator(c.now);
        expect(estimator.push(0)).toBeNull();
        c.advance(1000);
        expect(estimator.push(10)).toBeNull();
    });

    it('extrapolates from the recent rate', () => {
        const c = clock();
        const estimator = createRemainingEstimator(c.now);
        estimator.push(0);
        c.advance(2000);
        // 20% in 2s is 10%/s, so 80% is 8s away.
        expect(estimator.push(20)).toBeCloseTo(8);
    });

    it('follows a transfer that speeds up', () => {
        const c = clock();
        const estimator = createRemainingEstimator(c.now);
        estimator.push(0);
        let seconds;
        for ( let i = 1; i <= 10; i++ ) {
            c.advance(1000);
            seconds = estimator.push(i);
        }
        expect(seconds).toBeGreaterThan(60);
        // Then 8%/s, which leaves about a second at 90%.
        for ( let i = 1; i <= 10; i++ ) {
            c.advance(1000);
            seconds = estimator.push(10 + i * 8);
        }
        expect(seconds).toBeLessThan(10);
    });

    it('smooths a single jump instead of following it', () => {
        const c = clock();
        const estimator = createRemainingEstimator(c.now);
        estimator.push(0);
        c.advance(2000);
        const before = estimator.push(10);
        c.advance(100);
        const after = estimator.push(40);
        expect(after).toBeLessThan(before);
        expect(after).toBeGreaterThan(before * 0.5);
    });

    it('gives no estimate when stalled or finished', () => {
        const c = clock();
        const estimator = createRemainingEstimator(c.now);
        estimator.push(50);
        c.advance(3000);
        expect(estimator.push(50)).toBeNull();
        c.advance(1000);
        expect(estimator.push(100)).toBeNull();
    });
});

describe('roundSecondsLeft', () => {
    it('says "a few seconds" for the last stretch', () => {
        expect(roundSecondsLeft(3)).toBeNull();
        expect(roundSecondsLeft(9.9)).toBeNull();
    });

    it('rounds up to 5 seconds, then minutes', () => {
        expect(roundSecondsLeft(11)).toEqual({ value: 15, unit: 'second' });
        expect(roundSecondsLeft(58)).toEqual({ value: 55, unit: 'second' });
        expect(roundSecondsLeft(61)).toEqual({ value: 2, unit: 'minute' });
        expect(roundSecondsLeft(3599)).toEqual({ value: 59, unit: 'minute' });
    });

    it('rounds to whole hours past an hour', () => {
        expect(roundSecondsLeft(3600)).toEqual({ value: 1, unit: 'hour' });
        expect(roundSecondsLeft(3 * 3600 + 1000)).toEqual({ value: 3, unit: 'hour' });
    });
});

describe('summarizeUpload', () => {
    it('counts picked files and names the first', () => {
        expect(summarizeUpload([{ name: 'a.txt' }, { name: 'b.txt' }])).toEqual({ count: 2, name: 'a.txt' });
    });

    it('reads a drop, skipping its text items', () => {
        const items = [
            { kind: 'string' },
            { kind: 'file', webkitGetAsEntry: () => ({ name: 'Photos' }) },
            { kind: 'file', getAsFile: () => ({ name: 'c.png' }) },
        ];
        expect(summarizeUpload(items)).toEqual({ count: 2, name: 'Photos' });
    });

    it('handles nothing to upload', () => {
        expect(summarizeUpload(undefined)).toEqual({ count: 0, name: '' });
    });
});
