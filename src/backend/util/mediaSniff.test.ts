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
    decodeStrictBase64,
    decodeStrictBase64InSlices,
} from './mediaSniff.ts';

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
        ['a non-ASCII character whose low byte is in the alphabet', 'YWJī'],
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

describe('decodeStrictBase64InSlices', () => {
    // Several slices, with a last one that is partial and padded.
    const bytes = Buffer.alloc(5 * 1024 * 1024 + 2);
    for (let i = 0; i < bytes.length; i += 4099) bytes[i] = i % 251;
    const valid = bytes.toString('base64');

    it('decodes a multi-MB payload to the same bytes', async () => {
        expect(valid.endsWith('==')).toBe(true);
        expect((await decodeStrictBase64InSlices(valid))?.equals(bytes)).toBe(
            true,
        );
        const short = Buffer.from('abcd').toString('base64');
        expect(await decodeStrictBase64InSlices(short)).toEqual(
            Buffer.from('abcd'),
        );
    });

    it.each([
        ['empty input', ''],
        ['unpadded input', valid.slice(0, -2)],
        [
            'a character outside the alphabet in the first slice',
            `*${valid.slice(1)}`,
        ],
        [
            'a character outside the alphabet in the last slice',
            `${valid.slice(0, -5)}*${valid.slice(-4)}`,
        ],
        [
            'the URL-safe alphabet',
            `${valid.slice(0, 3_000_000)}-${valid.slice(3_000_001)}`,
        ],
        [
            'a non-ASCII character',
            `${valid.slice(0, 3_000_000)}ī${valid.slice(3_000_001)}`,
        ],
        [
            'padding where a slice ends',
            `${valid.slice(0, 1024 * 1024 - 1)}=${valid.slice(1024 * 1024)}`,
        ],
        [
            'padding inside a slice',
            `${valid.slice(0, 2_000_002)}==${valid.slice(2_000_004)}`,
        ],
    ])('rejects %s', async (_label, value) => {
        expect(await decodeStrictBase64InSlices(value)).toBeNull();
    });
});
