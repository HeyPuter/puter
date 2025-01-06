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
import { ErrorCodes, ErrorMetadata } from '@heyputer/putility/src/PosixError.js';

export const runErrnoTests = () => {
    describe('errno', function () {

        const testCases = [
            {
                description: 'exits normally if nothing is passed in',
                input: [ ],
                values: {},
                expectedStdout: '',
                expectedStderr: '',
                expectedFail: false,
            },
            {
                description: 'can search by number',
                input: [ ErrorMetadata.get(ErrorCodes.EFBIG).code.toString() ],
                values: {},
                expectedStdout: 'EFBIG         27 File too big\n',
                expectedStderr: '',
                expectedFail: false,
            },
            {
                description: 'can search by number',
                input: [ ErrorCodes.EIO.description ],
                values: {},
                expectedStdout: 'EIO            5 IO error\n',
                expectedStderr: '',
                expectedFail: false,
            },
            {
                description: 'prints an error message and returns a code > 0 if an error is not found',
                input: [ 'NOT-A-REAL-ERROR' ],
                values: {},
                expectedStdout: '',
                expectedStderr: 'ERROR: Not understood: NOT-A-REAL-ERROR\n',
                expectedFail: true,
            },
            {
                description: 'accepts multiple arguments and prints each',
                input: [ ErrorMetadata.get(ErrorCodes.ENOENT).code.toString(), 'NOT-A-REAL-ERROR', ErrorCodes.EPIPE.description ],
                values: {},
                expectedStdout:
                    'ENOENT         2 File or directory not found\n' +
                    'EPIPE         32 Pipe broken\n',
                expectedStderr: 'ERROR: Not understood: NOT-A-REAL-ERROR\n',
                expectedFail: true,
            },
            {
                description: 'searches descriptions if --search is provided',
                input: [ 'directory' ],
                values: { search: true },
                expectedStdout:
                    'ENOENT         2 File or directory not found\n' +
                    'ENOTDIR       20 Is not a directory\n' +
                    'EISDIR        21 Is a directory\n' +
                    'ENOTEMPTY     39 Directory is not empty\n',
                expectedStderr: '',
                expectedFail: false,
            },
            {
                description: 'lists all errors if --list is provided, ignoring parameters',
                input: [ 'directory' ],
                values: { list: true },
                expectedStdout:
                    'EPERM          1 Operation not permitted\n' +
                    'ENOENT         2 File or directory not found\n' +
                    'EIO            5 IO error\n' +
                    'EACCES        13 Permission denied\n' +
                    'EEXIST        17 File already exists\n' +
                    'ENOTDIR       20 Is not a directory\n' +
                    'EISDIR        21 Is a directory\n' +
                    'EINVAL        22 Argument invalid\n' +
                    'EMFILE        24 Too many open files\n' +
                    'EFBIG         27 File too big\n' +
                    'ENOSPC        28 Device out of space\n' +
                    'EPIPE         32 Pipe broken\n' +
                    'ENOTEMPTY     39 Directory is not empty\n' +
                    'EADDRINUSE    98 Address already in use\n' +
                    'ECONNRESET   104 Connection reset\n' +
                    'ETIMEDOUT    110 Connection timed out\n' +
                    'ECONNREFUSED 111 Connection refused\n' +
                    'EUNKNOWN      -1 Unknown error\n',
                expectedStderr: '',
                expectedFail: false,
            },
            {
                description: '--search overrides --list',
                input: [ 'directory' ],
                values: { list: true, search: true },
                expectedStdout:
                    'ENOENT         2 File or directory not found\n' +
                    'ENOTDIR       20 Is not a directory\n' +
                    'EISDIR        21 Is a directory\n' +
                    'ENOTEMPTY     39 Directory is not empty\n',
                expectedStderr: '',
                expectedFail: false,
            },
        ];

        for (const { description, input, values, expectedStdout, expectedStderr, expectedFail } of testCases) {
            it(description, async () => {
                let ctx = MakeTestContext(builtins.errno, { positionals: input, values });
                let hadError = false;
                try {
                    const result = await builtins.errno.execute(ctx);
                    if (!expectedFail) {
                        assert.equal(result, undefined, 'should exit successfully, returning nothing');
                    }
                } catch (e) {
                    hadError = true;
                    if (!expectedFail) {
                        assert.fail(e);
                    }
                }
                if (expectedFail && !hadError) {
                    assert.fail('should have returned an error code');
                }
                assert.equal(ctx.externs.out.output, expectedStdout, 'wrong output written to stdout');
                assert.equal(ctx.externs.err.output, expectedStderr, 'wrong output written to stderr');
            });
        }
    });
}