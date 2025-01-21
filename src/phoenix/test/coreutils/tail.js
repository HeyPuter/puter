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

export const runTailTests = () => {
    describe('tail', function () {
        // Too many parameters
        // Bad -n
        const failureCases = [
            {
                description: 'expects at most 1 argument',
                options: {},
                positionals: ['1', '2'],
            },
            {
                description: 'expects --lines, if set, to be a number',
                options: { lines: 'frog' },
                positionals: ['-'],
            },
            {
                description: 'expects --lines, if set, to be an integer',
                options: { lines: '1.75' },
                positionals: ['-'],
            },
            {
                description: 'expects --lines, if set, to be positive',
                options: { lines: '-3' },
                positionals: ['-'],
            },
            {
                description: 'expects --lines, if set, to not be 0',
                options: { lines: '0' },
                positionals: ['-'],
            },
        ];
        for (const { description, options, positionals } of failureCases) {
            it(description, async () => {
                let ctx = MakeTestContext(builtins.tail, { positionals, values: options });
                let hadError = false;
                try {
                    await builtins.tail.execute(ctx);
                } catch (e) {
                    hadError = true;
                }
                if (!hadError) {
                    assert.fail('didn\'t return an error code');
                }
                assert.equal(ctx.externs.out.output, '', 'nothing should be written to stdout');
                // Output to stderr is allowed but not required.
            });
        }

        const alphabet = 'a\nb\nc\nd\ne\nf\ng\nh\ni\nj\nk\nl\nm\nn\no\np\nq\nr\ns\nt\nu\nv\nw\nx\ny\nz\n';
        const testCases = [
            {
                description: 'reads from stdin if no parameter is given',
                options: {},
                positionals: [],
                stdin: alphabet,
                expectedStdout: 'q\nr\ns\nt\nu\nv\nw\nx\ny\nz\n',
            },
            {
                description: 'reads from stdin if parameter is `-`',
                options: {},
                positionals: ['-'],
                stdin: alphabet,
                expectedStdout: 'q\nr\ns\nt\nu\nv\nw\nx\ny\nz\n',
            },
            {
                description: '--lines/-n specifies how many lines to write',
                options: { lines: 5 },
                positionals: ['-'],
                stdin: alphabet,
                expectedStdout: 'v\nw\nx\ny\nz\n',
            },
            {
                description: 'when --lines/-n is greater than the number of lines, write everything',
                options: { lines: 500 },
                positionals: ['-'],
                stdin: alphabet,
                expectedStdout: alphabet,
            },
            // TODO: Test with files once the harness supports that.
        ];
        for (const { description, options, positionals, stdin, expectedStdout } of testCases) {
            it(description, async () => {
                let ctx = MakeTestContext(builtins.tail, { positionals, values: options, stdinInputs: [stdin] });
                try {
                    const result = await builtins.tail.execute(ctx);
                    assert.equal(result, undefined);
                } catch (e) {
                    assert.fail(e);
                }
                assert.equal(ctx.externs.out.output, expectedStdout, 'wrong output written to stdout');
                assert.equal(ctx.externs.err.output, '', 'sleep should not write to stderr');
            });
        }
    });
}