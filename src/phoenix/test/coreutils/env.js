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

export const runEnvTests = () => {
    describe('env', function () {
        it('should return a non-zero exit code, and output the env variables', async function () {
            let ctx = MakeTestContext(builtins.env, { env: {'a': '1', 'b': '2' } });
            try {
                await builtins.env.execute(ctx);
            } catch (e) {
                assert.fail(e);
            }
            assert.equal(ctx.externs.out.output, 'a=1\nb=2\n', 'env should output the env variables, one per line');
            assert.equal(ctx.externs.err.output, '', 'env should not write to stderr');
        });
    });
}