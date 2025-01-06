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
import { Exit } from "../../src/puter-shell/coreutils/coreutil_lib/exit.js";

async function testFalse(options) {
    let ctx = MakeTestContext(builtins.false, options);
    let hadError = false;
    try {
        await builtins.false.execute(ctx);
    } catch (e) {
        assert(e instanceof Exit);
        assert.notEqual(e.code, 0, 'returned exit code 0, meaning success');
        hadError = true;
    }
    if (!hadError) {
        assert.fail('didn\'t return an exit code');
    }
    assert.equal(ctx.externs.out.output, '', 'false should not write to stdout');
    assert.equal(ctx.externs.err.output, '', 'false should not write to stderr');
}

export const runFalseTests = () => {
    describe('false', function () {
        it('should return a non-zero exit code, with no output', async function () {
            await testFalse({});
        });
        it('should allow, but ignore, positional arguments', async function () {
            await testFalse({positionals: ['foo', 'bar', 'baz']});
        });
    });
}