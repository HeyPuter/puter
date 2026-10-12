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
import { secretsEqual } from './secureCompare.ts';

describe('secretsEqual', () => {
    it('is true for equal strings and equal buffers', () => {
        expect(secretsEqual('s3cret', 's3cret')).toBe(true);
        expect(
            secretsEqual(Buffer.from([1, 2, 3]), Buffer.from([1, 2, 3])),
        ).toBe(true);
        expect(secretsEqual('', '')).toBe(true);
    });

    it('is false for values that differ anywhere', () => {
        expect(secretsEqual('s3cret', 's3creT')).toBe(false);
        expect(secretsEqual('s3cret', 'X3cret')).toBe(false);
    });

    it('is false for different lengths without throwing', () => {
        expect(secretsEqual('short', 'much longer secret')).toBe(false);
        expect(secretsEqual('', 'x')).toBe(false);
        expect(secretsEqual(Buffer.alloc(16), Buffer.alloc(32))).toBe(false);
    });

    it('compares a string with its utf8 bytes as equal', () => {
        expect(secretsEqual('héllo', Buffer.from('héllo', 'utf8'))).toBe(true);
    });
});
