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
import assert from 'assert';
import { readtoken, TOKENS } from '../src/ansi-shell/readline/readtoken.js';

describe('readtoken', () => {
    const tcases = [
        {
            desc: 'should accept unquoted string',
            input: 'asdf',
            expected: ['asdf']
        },
        {
            desc: 'should accept leading spaces',
            input: '   asdf',
            expected: ['asdf']
        },
        {
            desc: 'should accept trailing spaces',
            input: 'asdf   ',
            expected: ['asdf']
        },
        {
            desc: 'should expected quoted string',
            input: '"asdf"',
            expected: ['asdf']
        },
        {
            desc: 'should recognize pipe with no whitespace',
            input: 'asdf|zxcv',
            expected: ['asdf', TOKENS['|'], 'zxcv']
        },
        {
            desc: 'mixed quoted and unquoted should work',
            input: '"asdf" zxcv',
            expected: ['asdf', 'zxcv']
        },
    ];
    for ( const { desc, input, expected } of tcases ) {
        it(desc, () => {
            assert.deepEqual(readtoken(input), expected)
        });
    }
})