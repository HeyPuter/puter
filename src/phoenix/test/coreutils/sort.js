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
import { MakeTestContext } from './harness.js'
import builtins from '../../src/puter-shell/coreutils/__exports__.js';

export const runSortTests = () => {
    describe('sort', function () {
        const testCases = [
            {
                description: 'reads from stdin if no parameter is given',
                options: {},
                positionals: [],
                stdin: 'a\nb\nc\n',
                expectedStdout: 'a\nb\nc\n',
                expectedStderr: '',
            },
            {
                description: 'reads from stdin if parameter is `-`',
                options: {},
                positionals: ['-'],
                stdin: 'a\nb\nc\n',
                expectedStdout: 'a\nb\nc\n',
                expectedStderr: '',
            },
            {
                description: 'sorts the output by byte value by default',
                options: {},
                positionals: ['-'],
                stdin: 'awesome\nCOOL\nAmazing\n!\ncold\n123\n',
                expectedStdout: '!\n123\nAmazing\nCOOL\nawesome\ncold\n',
                expectedStderr: '',
            },
            {
                description: 'keeps duplicates by default',
                options: {},
                positionals: ['-'],
                stdin: 'a\na\na\n',
                expectedStdout: 'a\na\na\n',
                expectedStderr: '',
            },
            {
                description: 'removes duplicates when -u/--unique is specified',
                options: { unique: true },
                positionals: ['-'],
                stdin: 'a\nd\na\nb\nc\nc\nb\na\n',
                expectedStdout: 'a\nb\nc\nd\n',
                expectedStderr: '',
            },
            {
                description: 'reverses the order when -r/--reverse is specified',
                options: { reverse: true },
                positionals: ['-'],
                stdin: 'a\nd\na\nb\nc\nc\nb\na\n',
                expectedStdout: 'd\nc\nc\nb\nb\na\na\na\n',
                expectedStderr: '',
            },
            {
                description: 'supports --reverse and --unique together',
                options: { reverse: true, unique: true },
                positionals: ['-'],
                stdin: 'a\nd\na\nb\nc\nc\nb\na\n',
                expectedStdout: 'd\nc\nb\na\n',
                expectedStderr: '',
            },
            {
                description: 'sorts case-insensitively when -f/--ignore-case is specified',
                options: { 'ignore-case': true },
                positionals: ['-'],
                stdin: 'b\nB\nA\na\n',
                expectedStdout: 'A\na\nb\nB\n',
                expectedStderr: '',
            },
            {
                description: 'supports --ignore-case and --unique together',
                options: { 'ignore-case': true, unique: true },
                positionals: ['-'],
                stdin: 'b\nB\nA\na\n',
                expectedStdout: 'A\nb\n',
                expectedStderr: '',
            },
            {
                description: 'considers only printing characters when -i/--ignore-nonprinting is specified',
                options: { 'ignore-nonprinting': true },
                positionals: ['-'],
                stdin: '*-*-*z\n????b\na\n    hello\n?a\n=======a=======\n\0\0\0\0b\n',
                expectedStdout: '*-*-*z\n=======a=======\n????b\n?a\na\n\0\0\0\0b\n    hello\n',
                expectedStderr: '',
            },
            {
                description: 'supports --ignore-nonprinting and --unique together',
                options: { 'ignore-nonprinting': true, unique: true },
                positionals: ['-'],
                stdin: '\0\0c\n\0b\nA\na\n\0a\n',
                expectedStdout: 'A\na\n\0b\n\0\0c\n',
                expectedStderr: '',
            },
            {
                description: 'considers only alphanumeric and whitespace characters when -d/--dictionary-order is specified',
                options: { 'dictionary-order': true },
                positionals: ['-'],
                stdin: '*-*-*z\n????b\na\n    hello\n?a\n=======a=======\n\0\0\0\0b\n',
                expectedStdout: '    hello\na\n?a\n=======a=======\n????b\n\0\0\0\0b\n*-*-*z\n',
                expectedStderr: '',
            },
            {
                description: 'supports --dictionary-order and --unique together',
                options: { 'dictionary-order': true, unique: true },
                positionals: ['-'],
                stdin: '*-*-*z\n????b\na\n    hello\n?a\n=======a=======\n\0\0\0\0b\n',
                expectedStdout: '    hello\na\n????b\n*-*-*z\n',
                expectedStderr: '',
            },
            {
                description: 'supports --dictionary-order and --ignore-nonprinting together',
                options: { 'dictionary-order': true, 'ignore-nonprinting': true },
                positionals: ['-'],
                stdin: '*-*-*z\n????b\na\n    hello\n?a\n=======a=======\n\0\0\0\0b\n',
                expectedStdout: 'a\n?a\n=======a=======\n????b\n\0\0\0\0b\n    hello\n*-*-*z\n',
                expectedStderr: '',
            },
            // TODO: Test with files once the harness supports that.
        ];
        for (const { description, options, positionals, stdin, expectedStdout, expectedStderr } of testCases) {
            it(description, async () => {
                let ctx = MakeTestContext(builtins.sort, { positionals, values: options, stdinInputs: [stdin] });
                try {
                    const result = await builtins.sort.execute(ctx);
                    assert.equal(result, undefined);
                } catch (e) {
                    assert.fail(e);
                }
                assert.equal(ctx.externs.out.output, expectedStdout, 'wrong output written to stdout');
                assert.equal(ctx.externs.err.output, expectedStderr, 'wrong output written to stderr');
            });
        }
    });
}