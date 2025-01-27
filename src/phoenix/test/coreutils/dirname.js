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

export const runDirnameTests = () => {
    describe('dirname', function () {
        it('expects at least 1 argument', async () => {
            let ctx = MakeTestContext(builtins.dirname, {});
            let hadError = false;
            try {
                await builtins.dirname.execute(ctx);
            } catch (e) {
                hadError = true;
            }
            if (!hadError) {
                assert.fail('should fail when given 0 arguments');
            }
            assert.equal(ctx.externs.out.output, '', 'nothing should be written to stdout');
            // Output to stderr is allowed but not required.
        });
        it('expects at most 1 argument', async () => {
            let ctx = MakeTestContext(builtins.dirname, {positionals: ['a', 'b']});
            let hadError = false;
            try {
                await builtins.dirname.execute(ctx);
            } catch (e) {
                hadError = true;
            }
            if (!hadError) {
                assert.fail('should fail when given 2 or more arguments');
            }
            assert.equal(ctx.externs.out.output, '', 'nothing should be written to stdout');
            // Output to stderr is allowed but not required.
        });

        const testCases = [
            {
                description: '"foo.txt" produces "."',
                input: 'foo.txt',
                expectedStdout: '.\n'
            },
            {
                description: '"./foo.txt" produces "."',
                input: './foo.txt',
                expectedStdout: '.\n'
            },
            {
                description: '"/a/b/c/foo.txt" produces "/a/b/c"',
                input: '/a/b/c/foo.txt',
                expectedStdout: '/a/b/c\n'
            },
            {
                description: '"a/b/c/foo.txt" produces "a/b/c"',
                input: 'a/b/c/foo.txt',
                expectedStdout: 'a/b/c\n'
            },
            {
                description: 'two slashes produces "/"',
                input: '//',
                expectedStdout: '/\n'
            },
            {
                description: 'a series of slashes produces "/"',
                input: '/////',
                expectedStdout: '/\n'
            },
            {
                description: 'empty string produces "/"',
                input: '',
                expectedStdout: '/\n'
            },
            {
                description: 'trailing slashes are trimmed',
                input: 'a/b/c////foo//',
                expectedStdout: 'a/b/c\n'
            },
        ];
        for (const {description, input, expectedStdout} of testCases) {
            it(description, async () => {
                let ctx = MakeTestContext(builtins.dirname, {positionals: [input]});
                try {
                    const result = await builtins.dirname.execute(ctx);
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