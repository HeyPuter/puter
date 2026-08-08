/**
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
import identifier from './identifier.js';

const { generate_identifier, generate_random_code } = identifier;

describe('generate_identifier', () => {
    it('joins adjective, noun and a 0-999999 number with the default separator', () => {
        const value = generate_identifier();
        const parts = value.split('_');
        expect(parts).toHaveLength(3);
        expect(parts[0]).toMatch(/^[a-z]+$/);
        expect(parts[1]).toMatch(/^[a-z]+$/);
        expect(Number(parts[2])).toBeGreaterThanOrEqual(0);
        expect(Number(parts[2])).toBeLessThan(1000000);
    });

    it('honours a custom separator', () => {
        expect(generate_identifier('-').split('-')).toHaveLength(3);
    });

    it('is deterministic for a fixed random source', () => {
        const zero = () => 0;
        expect(generate_identifier('-', zero)).toBe(
            generate_identifier('-', zero),
        );
        // The lowest draw picks the first entry of each word list.
        expect(generate_identifier('-', zero).endsWith('-0')).toBe(true);
    });

    it('reaches the last entry of each list at the top of the range', () => {
        const almostOne = () => 0.9999999;
        const value = generate_identifier('|', almostOne);
        expect(value.split('|')[2]).toBe('999999');
    });
});

describe('generate_random_code', () => {
    it('produces a code of the requested length from the default alphabet', () => {
        const code = generate_random_code(8);
        expect(code).toHaveLength(8);
        expect(code).toMatch(/^[A-Z0-9]{8}$/);
    });

    it('returns an empty string for a zero length', () => {
        expect(generate_random_code(0)).toBe('');
    });

    it('uses a caller-supplied alphabet and random source', () => {
        expect(generate_random_code(4, { rng: () => 0, chars: 'xyz' })).toBe(
            'xxxx',
        );
        expect(
            generate_random_code(3, { rng: () => 0.999999, chars: 'xyz' }),
        ).toBe('zzz');
    });
});
