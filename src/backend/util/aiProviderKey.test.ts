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
import { readProviderKey } from './aiProviderKey.js';

describe('readProviderKey', () => {
    it('reads apiKey, secret_key, api_key and key, in that order', () => {
        expect(readProviderKey({ apiKey: 'a', secret_key: 'b' })).toBe('a');
        expect(readProviderKey({ secret_key: 'b', api_key: 'c' })).toBe('b');
        expect(readProviderKey({ api_key: 'c', key: 'd' })).toBe('c');
        expect(readProviderKey({ key: 'd' })).toBe('d');
    });

    it('takes the first block that has a key, skipping empty values', () => {
        expect(
            readProviderKey(undefined, { apiKey: '' }, { secret_key: 'b' }),
        ).toBe('b');
        expect(readProviderKey({ apiKey: 7 }, undefined)).toBeUndefined();
    });
});
