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
import {
    isAspectRatio,
    expandAspectRatio,
    resolveImageSize,
    closestAspectRatio,
    formatAspectRatio,
} from './imageDimensions.js';

describe('isAspectRatio', () => {
    it.each([
        [16, 9, true],
        [32, 18, true],
        [64, 36, false],
        [1024, 1024, false],
        [0, 1, false],
        [1, -1, false],
    ])('classifies %s by %s', (w, h, expected) => {
        expect(isAspectRatio({ w: Number(w), h: Number(h) })).toBe(expected);
    });
});

describe('resolveImageSize', () => {
    it.each([
        [{ ratio: { w: '16', h: '9' } }, { w: 16, h: 9, kind: 'aspect' }],
        [
            { width: '4096', height: '3072' },
            { w: 4096, h: 3072, kind: 'pixels' },
        ],
        [
            { width: ' 512 ', height: ' 512 ' },
            { w: 512, h: 512, kind: 'pixels' },
        ],
        [{ aspect_ratio: '170:100' }, { w: 170, h: 100, kind: 'aspect' }],
        [
            { ratio: { w: 4, h: 3 }, width: 1024, height: 1024 },
            { w: 4, h: 3, kind: 'aspect' },
        ],
        [
            { width: 1024, height: 768, aspect_ratio: '1:1' },
            { w: 1024, h: 768, kind: 'pixels' },
        ],
    ])('preserves dimension intent for %j', (params, expected) => {
        expect(resolveImageSize({ prompt: 'hi', ...params } as never)).toEqual(
            expected,
        );
    });
    it('retains the BytePlus legacy pixel threshold', () => {
        expect(
            resolveImageSize(
                { prompt: 'hi', width: 512, height: 512 },
                { pixelSizeThreshold: 921_600 },
            ),
        ).toEqual({ w: 512, h: 512, kind: 'aspect' });
    });
    it('does not manufacture a size when none is requested', () => {
        expect(resolveImageSize({ prompt: 'hi' })).toBeUndefined();
    });
    it.each([
        { ratio: null },
        { width: null, height: null },
        { aspect_ratio: null },
        { aspect_ratio: '' },
        { aspect_ratio: '  ' },
        { ratio: null, width: null, height: null, aspect_ratio: null },
    ])('treats null and blank dimension fields %j as absent', (params) => {
        expect(
            resolveImageSize({ prompt: 'hi', ...params } as never),
        ).toBeUndefined();
    });
    it('names the missing partner when only one pixel dimension is set', () => {
        expect(() =>
            resolveImageSize({ prompt: 'hi', width: 1024 } as never),
        ).toThrow(/width and height must be set together/);
    });
    it('still rejects a lone dimension when its partner is null', () => {
        expect(() =>
            resolveImageSize({ prompt: 'hi', width: 1024, height: null } as never),
        ).toThrow(expect.objectContaining({ statusCode: 400 }));
    });
    it.each([
        { ratio: '16:9' },
        { ratio: {} },
        { ratio: { w: 0, h: 10 } },
        { ratio: { w: Infinity, h: 1 } },
        { ratio: { w: true, h: 1 } },
        { width: 'invalid', height: 1 },
        { width: 1 },
        { aspect_ratio: '1:2:3' },
        { aspect_ratio: 42 },
        { aspect_ratio: '-1:2' },
        { width: '0x10', height: '0x10' },
        { ratio: { w: '1e3', h: '1e3' } },
    ])('rejects malformed dimensions %j', (params) => {
        expect(() =>
            resolveImageSize({ prompt: 'hi', ...params } as never),
        ).toThrow(expect.objectContaining({ statusCode: 400 }));
    });
});

describe('aspect helpers', () => {
    it('chooses the closest supported shape symmetrically', () => {
        const shapes = [
            { w: 16, h: 9 },
            { w: 9, h: 16 },
            { w: 1, h: 1 },
        ];
        expect(closestAspectRatio({ w: 17, h: 10 }, shapes)).toEqual(shapes[0]);
        expect(closestAspectRatio({ w: 10, h: 17 }, shapes)).toEqual(shapes[1]);
    });
    it.each([
        [1920, 1080, '16:9'],
        [16.5, 9.5, '33:19'],
        [1.1, 1, '11:10'],
        [0.1, 0.3, '1:3'],
        [1024, 768, '4:3'],
        [0, 1, undefined],
    ])('formats %s by %s', (w, h, expected) => {
        expect(formatAspectRatio({ w: Number(w), h: Number(h) })).toBe(
            expected,
        );
    });
    it('omits a missing ratio', () =>
        expect(formatAspectRatio()).toBeUndefined());
});

it.each([
    { w: 4, h: 1 },
    { w: 1e-200, h: 1e-200 },
])('expands an aspect hint without overflowing: %j', (ratio) => {
    const result = expandAspectRatio(ratio);
    expect(result.w / result.h).toBeCloseTo(ratio.w / ratio.h);
    expect(result.w * result.h).toBeCloseTo(1024 * 1024);
});

it('rejects an aspect ratio whose quotient overflows', () => {
    expect(() =>
        resolveImageSize({ prompt: 'hi', ratio: { w: 16, h: 1e-320 } }),
    ).toThrow(expect.objectContaining({ statusCode: 400 }));
});
