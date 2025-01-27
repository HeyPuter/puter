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
import sinon from 'sinon';
import { MakeTestContext } from './harness.js';
import builtins from '../../src/puter-shell/coreutils/__exports__.js';

export const runSleepTests = () => {
    describe('sleep', function () {
        let clock;
        beforeEach(() => {
            clock = sinon.useFakeTimers();
        });
        afterEach(() => {
            clock.restore();
        });

        const failureCases = [
            {
                description: 'expects at least 1 argument',
                positionals: [],
            },
            {
                description: 'expects at most 1 argument',
                positionals: ['1', '2'],
            },
            {
                description: 'expects its argument to be a number',
                positionals: ['frog'],
            },
            {
                description: 'expects its argument to be positive',
                positionals: ['-1'],
            },
        ];
        for (const { description, positionals } of failureCases) {
            it(description, async () => {
                let ctx = MakeTestContext(builtins.sleep, { positionals });
                let hadError = false;
                try {
                    await builtins.sleep.execute(ctx);
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

        const testCases = [
            {
                description: 'sleep 0.5',
                positionals: ['0.5'],
                durationS: 0.5,
            },
            {
                description: 'sleep 1',
                positionals: ['1'],
                durationS: 1,
            },
            {
                description: 'sleep 1.5',
                positionals: ['1.5'],
                durationS: 1.5,
            },
            {
                description: 'sleep 27',
                positionals: ['27'],
                durationS: 27,
            },
        ];
        for (const { description, positionals, durationS } of testCases) {
            it(description, async () => {
                const durationMs = durationS * 1000;
                let ctx = MakeTestContext(builtins.sleep, { positionals });
                const startTimeMs = performance.now();
                let endTimeMs;
                builtins.sleep.execute(ctx)
                    .then(() => { endTimeMs = performance.now(); })
                    .catch((e) => { assert.fail(e); });
                await clock.tickAsync(durationMs - 5);
                assert.ok(endTimeMs === undefined, `sleep took less than ${durationS}s, took ${(endTimeMs - startTimeMs) / 1000}s`);
                await clock.tickAsync(10);
                assert.ok(endTimeMs !== undefined, `sleep took more than ${durationS}s, not done after ${(durationS + 0.005)}s`);

                assert.equal(ctx.externs.out.output, '', 'sleep should not write to stdout');
                assert.equal(ctx.externs.err.output, '', 'sleep should not write to stderr');
            });
        }
    });
};