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

import { assertScalarOptions } from './scalarOptions.js';

describe('assertScalarOptions', () => {
    it.each([
        { toString: null },
        { toString: null, valueOf: null },
        [{ toString: null }],
    ])('rejects %j with a 400 that names the option', (language) => {
        expect(() =>
            assertScalarOptions({ language }, ['model', 'language']),
        ).toThrow(
            expect.objectContaining({
                statusCode: 400,
                legacyCode: 'bad_request',
                message: '`language` is not a usable value',
            }),
        );
    });

    // A provider ignores or refuses these itself, as it did before the check.
    it.each([
        'en',
        '',
        0,
        16000,
        true,
        false,
        null,
        undefined,
        {},
        { order: ['a'] },
        [],
        ['en'],
    ])(
        'accepts %j',
        (language) => {
            expect(() =>
                assertScalarOptions({ language }, ['language']),
            ).not.toThrow();
        },
    );

    it('leaves the options it was not given alone', () => {
        expect(() =>
            assertScalarOptions({ voice_settings: { stability: 0.5 } }, ['voice']),
        ).not.toThrow();
    });
});
