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

import { bench, describe } from 'vitest';
import { EWMA, MovingMode, TimeWindow, normalize } from './opmath.js';

describe('EWMA - Exponential Weighted Moving Average', () => {
    bench('EWMA put() with constant alpha', () => {
        const ewma = new EWMA({ initial: 0, alpha: 0.2 });
        for ( let i = 0; i < 1000; i++ ) {
            ewma.put(Math.random() * 100);
        }
    });

    bench('EWMA put() with function alpha', () => {
        const ewma = new EWMA({ initial: 0, alpha: () => 0.2 });
        for ( let i = 0; i < 1000; i++ ) {
            ewma.put(Math.random() * 100);
        }
    });

    bench('EWMA get() after many puts', () => {
        const ewma = new EWMA({ initial: 0, alpha: 0.2 });
        for ( let i = 0; i < 100; i++ ) {
            ewma.put(i);
        }
        for ( let i = 0; i < 1000; i++ ) {
            ewma.get();
        }
    });
});

describe('MovingMode - Mode calculation with sliding window', () => {
    bench('MovingMode put() with window_size=30', () => {
        const mode = new MovingMode({ initial: 0, window_size: 30 });
        for ( let i = 0; i < 1000; i++ ) {
            mode.put(Math.floor(Math.random() * 10));
        }
    });

    bench('MovingMode put() with window_size=100', () => {
        const mode = new MovingMode({ initial: 0, window_size: 100 });
        for ( let i = 0; i < 1000; i++ ) {
            mode.put(Math.floor(Math.random() * 10));
        }
    });

    bench('MovingMode with high cardinality values', () => {
        const mode = new MovingMode({ initial: 0, window_size: 50 });
        for ( let i = 0; i < 1000; i++ ) {
            mode.put(Math.floor(Math.random() * 1000));
        }
    });

    bench('MovingMode with low cardinality values', () => {
        const mode = new MovingMode({ initial: 0, window_size: 50 });
        for ( let i = 0; i < 1000; i++ ) {
            mode.put(Math.floor(Math.random() * 3));
        }
    });
});

describe('TimeWindow - Time-based sliding window', () => {
    bench('TimeWindow add() and get()', () => {
        let fakeTime = 0;
        const tw = new TimeWindow({
            window_duration: 1000,
            reducer: values => values.reduce((a, b) => a + b, 0),
            now: () => fakeTime,
        });
        for ( let i = 0; i < 1000; i++ ) {
            fakeTime += 10;
            tw.add(Math.random());
        }
    });

    bench('TimeWindow with stale entry removal', () => {
        let fakeTime = 0;
        const tw = new TimeWindow({
            window_duration: 100,
            reducer: values => values.length,
            now: () => fakeTime,
        });
        for ( let i = 0; i < 1000; i++ ) {
            fakeTime += 50; // Fast time progression causes stale removal
            tw.add(i);
            tw.get();
        }
    });
});

describe('normalize - Exponential normalization', () => {
    bench('normalize() single value', () => {
        for ( let i = 0; i < 10000; i++ ) {
            normalize({ high_value: 0.001 }, Math.random());
        }
    });

    bench('normalize() with varying high_value', () => {
        const high_values = [0.001, 0.01, 0.1, 1, 10];
        for ( let i = 0; i < 10000; i++ ) {
            const hv = high_values[i % high_values.length];
            normalize({ high_value: hv }, Math.random() * 100);
        }
    });
});
