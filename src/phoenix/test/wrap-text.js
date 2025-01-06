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
import { lengthIgnoringEscapes, wrapText } from '../src/util/wrap-text.js';

describe('wrapText', () => {
    const testCases = [
        {
            description: 'should wrap text',
            input: 'Well, hello friends! How are you today?',
            width: 12,
            output: ['Well, hello', 'friends! How', 'are you', 'today?'],
        },
        {
            description: 'should break too-long words onto multiple lines',
            input: 'Antidisestablishmentarianism.',
            width: 20,
            output: ['Antidisestablishmen-', 'tarianism.'],
        },
        {
            description: 'should break too-long words onto multiple lines',
            input: 'Antidisestablishmentarianism.',
            width: 10,
            output: ['Antidises-', 'tablishme-', 'ntarianis-', 'm.'],
        },
        {
            description: 'should break too-long words when there is already text on the line',
            input: 'The longest word I can think of is antidisestablishmentarianism.',
            width: 20,
            output: ['The longest word I', 'can think of is', 'antidisestablishmen-', 'tarianism.'],
        },
        {
            description: 'should return the original text if the width is invalid',
            input: 'Well, hello friends!',
            width: 0,
            output: ['Well, hello friends!'],
        },
        {
            description: 'should maintain existing newlines',
            input: 'Well\nhello\n\nfriends!',
            width: 20,
            output: ['Well', 'hello', '', 'friends!'],
        },
        {
            description: 'should maintain indentation after newlines',
            input: 'Well\n      hello\n\nfriends!',
            width: 20,
            output: ['Well', '      hello', '', 'friends!'],
        },
        {
            description: 'should ignore ansi escape sequences',
            input: '\x1B[34;1mWell this is some text with ansi escape sequences\x1B[0m',
            width: 20,
            output: ['\x1B[34;1mWell this is some', 'text with ansi', 'escape sequences\x1B[0m'],
        },
    ];
    for (const { description, input, width, output } of testCases) {
        it (description, () => {
            const result = wrapText(input, width);
            for (const line of result) {
                if (typeof width === 'number' && width > 0) {
                    assert.ok(lengthIgnoringEscapes(line) <= width, `Line is too long: '${line}'`);
                }
            }
            assert.equal('|' + result.join('|\n|') + '|', '|' + output.join('|\n|') + '|');
        });
    }
})