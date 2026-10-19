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
import { decodeStrictBase64 } from './mediaSniff.ts';

describe('decodeStrictBase64', () => {
    it.each([
        ['no padding', Buffer.from('abc')],
        ['one pad character', Buffer.from('ab')],
        ['two pad characters', Buffer.from('a')],
    ])('decodes base64 with %s', (_label, bytes) => {
        expect(decodeStrictBase64(bytes.toString('base64'))).toEqual(bytes);
    });

    it.each([
        ['empty input', ''],
        ['unpadded input', 'YWI'],
        ['the URL-safe alphabet', 'a-b_'],
        ['whitespace', 'YW Jj'],
        ['a character outside the alphabet', 'YW*j'],
        ['padding mid-string', 'YQ==YWJj'],
        ['three pad characters', 'Y==='],
    ])('rejects %s', (_label, value) => {
        expect(decodeStrictBase64(value)).toBeNull();
    });

    it('rejects one bad character anywhere in a multi-MB payload', () => {
        const valid = Buffer.alloc(6 * 1024 * 1024, 7).toString('base64');
        for (const at of [0, valid.length / 2, valid.length - 1]) {
            const corrupt = `${valid.slice(0, at)}*${valid.slice(at + 1)}`;
            expect(decodeStrictBase64(corrupt)).toBeNull();
        }
    });
});
