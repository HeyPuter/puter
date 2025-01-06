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

export const runEchoTests = () => {
    describe('echo', function () {
        const testCases = [
            {
                description: 'empty input prints a newline',
                input: [],
                options: {},
                expectedStdout: '\n'
            },
            {
                description: 'single input is printed',
                input: ['hello'],
                options: {},
                expectedStdout: 'hello\n'
            },
            {
                description: 'multiple inputs are printed, separated by spaces',
                input: ['hello', 'world'],
                options: {},
                expectedStdout: 'hello world\n'
            },
            {
                description: '-n suppresses newlines',
                input: ['hello', 'world'],
                options: {
                    n: true
                },
                expectedStdout: 'hello world'
            },
            // TODO: Test the `-e` option for interpreting backslash escapes.
        ];
        for (const {description, input, options, expectedStdout} of testCases) {
            it(description, async () => {
                let ctx = MakeTestContext(builtins.echo, {positionals: input, values: options});
                try {
                    const result = await builtins.echo.execute(ctx);
                    assert.equal(result, undefined, 'should exit successfully, returning nothing');
                } catch (e) {
                    assert.fail(e);
                }
                assert.equal(ctx.externs.out.output, expectedStdout, 'wrong output written to stdout');
                assert.equal(ctx.externs.err.output, '', 'nothing should be written to stderr');
            });
        }
    });
}