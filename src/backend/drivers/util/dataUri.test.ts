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
import { dataUriBytes, parseDataUri } from './dataUri.js';

describe('parseDataUri', () => {
    it('splits mime type, base64 flag and payload', () => {
        expect(parseDataUri('data:image/PNG;base64,iVBORw0KGgo=')).toEqual({
            mimeType: 'image/png',
            base64: true,
            data: 'iVBORw0KGgo=',
        });
    });

    it('defaults a missing mime type to text/plain, or the caller default', () => {
        expect(parseDataUri('data:,hello')).toEqual({
            mimeType: 'text/plain',
            base64: false,
            data: 'hello',
        });
        expect(parseDataUri('data:;base64,AA==', 'image/png')?.mimeType).toBe(
            'image/png',
        );
    });

    it('finds the base64 flag among other parameters', () => {
        expect(
            parseDataUri('data:text/plain;charset=utf-8;BASE64,aGk=')?.base64,
        ).toBe(true);
    });

    it('returns null for anything that is not a data URI', () => {
        expect(parseDataUri('https://cdn.test/a.png')).toBeNull();
        expect(parseDataUri('')).toBeNull();
    });
});

describe('dataUriBytes', () => {
    it('decodes base64 and percent-encoded payloads', () => {
        expect(dataUriBytes(parseDataUri('data:;base64,aGk=')!)).toEqual(
            Buffer.from('hi'),
        );
        expect(dataUriBytes(parseDataUri('data:,h%69')!)).toEqual(
            Buffer.from('hi'),
        );
    });

    it('rejects a malformed percent-encoding with a 400', () => {
        expect(() => dataUriBytes(parseDataUri('data:,%E0%A4%A')!)).toThrow(
            expect.objectContaining({ statusCode: 400 }),
        );
    });
});
