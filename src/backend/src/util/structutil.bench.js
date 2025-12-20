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
import { apply_keys, cart_product } from './structutil.js';

describe('cart_product - Small inputs', () => {
    bench('2 keys, 2 values each', () => {
        cart_product({
            a: [1, 2],
            b: ['x', 'y'],
        });
    });

    bench('3 keys, 2 values each', () => {
        cart_product({
            a: [1, 2],
            b: ['x', 'y'],
            c: [true, false],
        });
    });

    bench('2 keys, 3 values each', () => {
        cart_product({
            a: [1, 2, 3],
            b: ['x', 'y', 'z'],
        });
    });
});

describe('cart_product - Medium inputs', () => {
    bench('4 keys, 2 values each (16 combinations)', () => {
        cart_product({
            a: [1, 2],
            b: [3, 4],
            c: [5, 6],
            d: [7, 8],
        });
    });

    bench('3 keys, 3 values each (27 combinations)', () => {
        cart_product({
            a: [1, 2, 3],
            b: [4, 5, 6],
            c: [7, 8, 9],
        });
    });

    bench('5 keys, 2 values each (32 combinations)', () => {
        cart_product({
            a: [1, 2],
            b: [3, 4],
            c: [5, 6],
            d: [7, 8],
            e: [9, 10],
        });
    });
});

describe('cart_product - Large inputs', () => {
    bench('3 keys, 5 values each (125 combinations)', () => {
        cart_product({
            a: [1, 2, 3, 4, 5],
            b: [6, 7, 8, 9, 10],
            c: [11, 12, 13, 14, 15],
        });
    });

    bench('4 keys, 4 values each (256 combinations)', () => {
        cart_product({
            a: [1, 2, 3, 4],
            b: [5, 6, 7, 8],
            c: [9, 10, 11, 12],
            d: [13, 14, 15, 16],
        });
    });

    bench('6 keys, 2 values each (64 combinations)', () => {
        cart_product({
            a: [1, 2],
            b: [3, 4],
            c: [5, 6],
            d: [7, 8],
            e: [9, 10],
            f: [11, 12],
        });
    });
});

describe('cart_product - Single values', () => {
    bench('3 keys, 1 value each (1 combination)', () => {
        cart_product({
            a: 1,
            b: 2,
            c: 3,
        });
    });

    bench('mixed single and array values', () => {
        cart_product({
            a: 1,
            b: [2, 3],
            c: 4,
            d: [5, 6],
        });
    });
});

describe('cart_product - Edge cases', () => {
    bench('empty object', () => {
        cart_product({});
    });

    bench('single key with array', () => {
        cart_product({
            only: [1, 2, 3, 4, 5],
        });
    });

    bench('many keys with single values', () => {
        cart_product({
            a: 1,
            b: 2,
            c: 3,
            d: 4,
            e: 5,
            f: 6,
            g: 7,
            h: 8,
            i: 9,
            j: 10,
        });
    });
});

describe('apply_keys - Basic operations', () => {
    const keys = ['a', 'b', 'c'];

    bench('apply to single entry', () => {
        apply_keys(keys, [1, 2, 3]);
    });

    bench('apply to 5 entries', () => {
        apply_keys(keys,
                        [1, 2, 3],
                        [4, 5, 6],
                        [7, 8, 9],
                        [10, 11, 12],
                        [13, 14, 15]);
    });

    bench('apply to 10 entries', () => {
        const entries = [];
        for ( let i = 0; i < 10; i++ ) {
            entries.push([i * 3, i * 3 + 1, i * 3 + 2]);
        }
        apply_keys(keys, ...entries);
    });
});

describe('apply_keys - Varying key counts', () => {
    bench('2 keys', () => {
        apply_keys(['a', 'b'], [1, 2], [3, 4], [5, 6]);
    });

    bench('5 keys', () => {
        apply_keys(['a', 'b', 'c', 'd', 'e'],
                        [1, 2, 3, 4, 5],
                        [6, 7, 8, 9, 10]);
    });

    bench('10 keys', () => {
        const keys = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
        const entry = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        apply_keys(keys, entry, entry, entry);
    });
});

describe('Combined cart_product + apply_keys workflow', () => {
    bench('generate and label small product', () => {
        const product = cart_product({
            size: ['small', 'medium', 'large'],
            color: ['red', 'blue'],
        });
        apply_keys(['size', 'color'], ...product);
    });

    bench('generate and label medium product', () => {
        const product = cart_product({
            a: [1, 2, 3],
            b: [4, 5, 6],
            c: [7, 8, 9],
        });
        apply_keys(['a', 'b', 'c'], ...product);
    });
});

describe('Real-world configuration generation', () => {
    bench('test matrix generation (browser x OS)', () => {
        const matrix = cart_product({
            browser: ['chrome', 'firefox', 'safari'],
            os: ['windows', 'macos', 'linux'],
        });
        apply_keys(['browser', 'os'], ...matrix);
    });

    bench('feature flag combinations', () => {
        cart_product({
            featureA: [true, false],
            featureB: [true, false],
            featureC: [true, false],
            featureD: [true, false],
        });
    });

    bench('API endpoint parameter combinations', () => {
        const combinations = cart_product({
            method: ['GET', 'POST'],
            auth: ['none', 'token', 'session'],
            format: ['json', 'xml'],
        });
        apply_keys(['method', 'auth', 'format'], ...combinations);
    });
});
