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
 * Puter is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with Puter. If not, see <https://www.gnu.org/licenses/>.
 */

import { describe, expect, it } from 'vitest';
import { positiveWholeSeconds, snapAspectRatio } from './videoParams.js';

const RATIOS = ['16:9', '9:16', '1:1'];

describe('snapAspectRatio', () => {
    it('reduces a size to an allowed ratio', () => {
        expect(snapAspectRatio(1920, 1080, RATIOS)).toBe('16:9');
        expect(snapAspectRatio(720, 1280, RATIOS)).toBe('9:16');
        expect(snapAspectRatio(1023.6, 1024.4, RATIOS)).toBe('1:1');
    });

    it('leaves ratios outside the list, and unusable sizes, undefined', () => {
        expect(snapAspectRatio(1024, 768, RATIOS)).toBeUndefined();
        expect(snapAspectRatio('1920', 1080, RATIOS)).toBeUndefined();
        expect(snapAspectRatio(0.3, 1080, RATIOS)).toBeUndefined();
        expect(snapAspectRatio(-1920, -1080, RATIOS)).toBeUndefined();
        expect(snapAspectRatio(Infinity, 1080, RATIOS)).toBeUndefined();
        expect(snapAspectRatio(undefined, undefined, RATIOS)).toBeUndefined();
    });
});

describe('positiveWholeSeconds', () => {
    it('rounds numbers and parses numeric strings', () => {
        expect(positiveWholeSeconds(5)).toBe(5);
        expect(positiveWholeSeconds(4.6)).toBe(5);
        expect(positiveWholeSeconds('8')).toBe(8);
        expect(positiveWholeSeconds('8s')).toBe(8);
    });

    it('is undefined below one second or for anything else', () => {
        expect(positiveWholeSeconds(0.4)).toBeUndefined();
        expect(positiveWholeSeconds(0)).toBeUndefined();
        expect(positiveWholeSeconds(-3)).toBeUndefined();
        expect(positiveWholeSeconds(Number.NaN)).toBeUndefined();
        expect(positiveWholeSeconds('soon')).toBeUndefined();
        expect(positiveWholeSeconds(true)).toBeUndefined();
        expect(positiveWholeSeconds(undefined)).toBeUndefined();
    });
});
