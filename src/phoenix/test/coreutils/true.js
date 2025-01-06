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

async function testTrue(options) {
    let ctx = MakeTestContext(builtins.true, options);
    try {
        const result = await builtins.true.execute(ctx);
        assert.equal(result, undefined);
    } catch (e) {
        assert.fail(e);
    }
    assert.equal(ctx.externs.out.output, '', 'true should not write to stdout');
    assert.equal(ctx.externs.err.output, '', 'true should not write to stderr');
}

export const runTrueTests = () => {
    describe('true', function () {
        it('should execute successfully with no output', async function () {
            await testTrue({});
        });
        it('should allow, but ignore, positional arguments', async function () {
            await testTrue({positionals: ['foo', 'bar', 'baz']});
        });
    });
}