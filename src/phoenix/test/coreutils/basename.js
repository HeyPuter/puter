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

export const runBasenameTests = () => {
    describe('basename', function () {
        it('expects at least 1 argument', async () => {
            let ctx = MakeTestContext(builtins.basename, {});
            let hadError = false;
            try {
                await builtins.basename.execute(ctx);
            } catch (e) {
                hadError = true;
            }
            if (!hadError) {
                assert.fail('should fail when given 0 arguments');
            }
            assert.equal(ctx.externs.out.output, '', 'nothing should be written to stdout');
            // Output to stderr is allowed but not required.
        });
        it('expects at most 2 arguments', async () => {
            let ctx = MakeTestContext(builtins.basename, {positionals: ['a', 'b', 'c']});
            let hadError = false;
            try {
                await builtins.basename.execute(ctx);
            } catch (e) {
                hadError = true;
            }
            if (!hadError) {
                assert.fail('should fail when given 3 arguments');
            }
            assert.equal(ctx.externs.out.output, '', 'nothing should be written to stdout');
            // Output to stderr is allowed but not required.
        });

        const testCases = [
            {
                description: '"foo.txt" produces "foo.txt"',
                input: ['foo.txt'],
                expectedStdout: 'foo.txt\n'
            },
            {
                description: '"./foo.txt" produces "foo.txt"',
                input: ['./foo.txt'],
                expectedStdout: 'foo.txt\n'
            },
            {
                description: '"/a/b/c/foo.txt" produces "foo.txt"',
                input: ['/a/b/c/foo.txt'],
                expectedStdout: 'foo.txt\n'
            },
            {
                description: 'two slashes produces "/"',
                input: ['//'],
                expectedStdout: '/\n'
            },
            {
                description: 'a series of slashes produces "/"',
                input: ['/////'],
                expectedStdout: '/\n'
            },
            {
                description: 'empty string produces "/"',
                input: [''],
                expectedStdout: '.\n'
            },
            {
                description: 'trailing slashes are trimmed',
                input: ['foo.txt/'],
                expectedStdout: 'foo.txt\n'
            },
            {
                description: 'suffix is removed from simple filename',
                input: ['foo.txt', '.txt'],
                expectedStdout: 'foo\n'
            },
            {
                description: 'suffix is removed from path',
                input: ['/a/b/c/foo.txt', '.txt'],
                expectedStdout: 'foo\n'
            },
            {
                description: 'suffix is removed only once',
                input: ['/a/b/c/foo.txt.txt.txt', '.txt'],
                expectedStdout: 'foo.txt.txt\n'
            },
            {
                description: 'suffix is ignored if not found in the input',
                input: ['/a/b/c/foo.txt', '.png'],
                expectedStdout: 'foo.txt\n'
            },
            {
                description: 'suffix is removed even if input has a trailing slash',
                input: ['/a/b/c/foo.txt/', '.txt'],
                expectedStdout: 'foo\n'
            },
        ];
        for (const {description, input, expectedStdout} of testCases) {
            it(description, async () => {
                let ctx = MakeTestContext(builtins.basename, {positionals: input});
                try {
                    const result = await builtins.basename.execute(ctx);
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