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

import { describe, it, expect } from 'vitest';
import { isAttestedOrigin } from './attestedOrigin.js';

describe('isAttestedOrigin', () => {
    it.each([
        'https://example.com',
        'http://localhost:4100',
        'https://example.com/page?q=1',
        'chrome-extension://abcdefghijklmnop',
        'moz-extension://abcdefghijklmnop',
    ])('accepts %s', origin => {
        expect(isAttestedOrigin(origin)).toBe(true);
    });

    it.each([
        'null',
        'file://',
        'file:///Users/me/index.html',
        'data:text/html,<p>hi</p>',
        'javascript:alert(1)',
        'chrome-extension:',
        'not a url',
        '',
        null,
        undefined,
    ])('rejects %j', origin => {
        expect(isAttestedOrigin(origin)).toBe(false);
    });
});
