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
import * as ck from 'chronokinesis';
import { MakeTestContext } from './harness.js'
import builtins from '../../src/puter-shell/coreutils/__exports__.js';

export const runDateTests = () => {
    // These tests are disabled for now.
    // (broken, very low priority)
    return;
    describe('date', function () {
        beforeEach(() => {
            ck.freeze();
            ck.timezone('UTC', '2024-03-07 13:05:07');
        });
        afterEach(() => {
            ck.reset();
        });

        const testCases = [
            {
                description: 'outputs the date and time in a standard format when no format parameter is given',
                input: [ ],
                options: { utc: true },
                expectedStdout: 'Thu Mar  7 13:05:07 UTC 2024\n',
                expectedStderr: '',
            },
            {
                description: 'outputs the format verbatim if no format sequences are included',
                input: [ '+hello' ],
                options: { utc: true },
                expectedStdout: 'hello\n',
                expectedStderr: '',
            },
            {
                description: '%a outputs abbreviated weekday name',
                input: [ '+%a' ],
                options: { utc: true },
                expectedStdout: 'Thu\n',
                expectedStderr: '',
            },
            {
                description: '%A outputs full weekday name',
                input: [ '+%A' ],
                options: { utc: true },
                expectedStdout: 'Thursday\n',
                expectedStderr: '',
            },
            {
                description: '%b outputs abbreviated month name',
                input: [ '+%b' ],
                options: { utc: true },
                expectedStdout: 'Mar\n',
                expectedStderr: '',
            },
            {
                description: '%B outputs full month name',
                input: [ '+%B' ],
                options: { utc: true },
                expectedStdout: 'March\n',
                expectedStderr: '',
            },
            {
                description: '%c outputs full date and time',
                input: [ '+%c' ],
                options: { utc: true },
                expectedStdout: '3/7/2024, 1:05:07 PM\n',
                expectedStderr: '',
            },
            {
                description: '%C outputs century as 2 digits',
                input: [ '+%C' ],
                options: { utc: true },
                expectedStdout: '20\n',
                expectedStderr: '',
            },
            {
                description: '%d outputs day of the month as 2 digits',
                input: [ '+%d' ],
                options: { utc: true },
                expectedStdout: '07\n',
                expectedStderr: '',
            },
            {
                description: '%D outputs date as mm/dd/yy',
                input: [ '+%D' ],
                options: { utc: true },
                expectedStdout: '03/07/24\n',
                expectedStderr: '',
            },
            {
                description: '%e outputs day of the month as 2 characters padded with a leading space',
                input: [ '+%e' ],
                options: { utc: true },
                expectedStdout: ' 7\n',
                expectedStderr: '',
            },
            {
                description: '%H outputs the 24-hour clock hour, as 2 digits',
                input: [ '+%H' ],
                options: { utc: true },
                expectedStdout: '13\n',
                expectedStderr: '',
            },
            {
                description: '%h outputs the same as %b',
                input: [ '+%h' ],
                options: { utc: true },
                expectedStdout: 'Mar\n',
                expectedStderr: '',
            },
            {
                description: '%I outputs the 12-hour clock hour, as 2 digits',
                input: [ '+%I' ],
                options: { utc: true },
                expectedStdout: '01\n',
                expectedStderr: '',
            },
            // TODO: %j outputs the day of the year as a 3-digit number, starting at 001.
            {
                description: '%m outputs the month, as 2 digits, with January as 01',
                input: [ '+%m' ],
                options: { utc: true },
                expectedStdout: '03\n',
                expectedStderr: '',
            },
            {
                description: '%M outputs the minute, as 2 digits',
                input: [ '+%M' ],
                options: { utc: true },
                expectedStdout: '05\n',
                expectedStderr: '',
            },
            {
                description: '%n outputs a newline character',
                input: [ '+%n' ],
                options: { utc: true },
                expectedStdout: '\n\n',
                expectedStderr: '',
            },
            {
                description: '%p outputs AM or PM',
                input: [ '+%p' ],
                options: { utc: true },
                expectedStdout: 'PM\n',
                expectedStderr: '',
            },
            {
                description: '%r outputs the 12-hour clock time',
                input: [ '+%r' ],
                options: { utc: true },
                expectedStdout: '01:05:07 PM\n',
                expectedStderr: '',
            },
            {
                description: '%S outputs seconds, as 2 digits',
                input: [ '+%S' ],
                options: { utc: true },
                expectedStdout: '07\n',
                expectedStderr: '',
            },
            {
                description: '%t outputs a tab character',
                input: [ '+%t' ],
                options: { utc: true },
                expectedStdout: '\t\n',
                expectedStderr: '',
            },
            {
                description: '%T outputs the 24-hour clock time',
                input: [ '+%T' ],
                options: { utc: true },
                expectedStdout: '13:05:07\n',
                expectedStderr: '',
            },
            {
                description: '%u outputs the week day as a number, with Monday = 1 and Sunday = 7',
                input: [ '+%u' ],
                options: { utc: true },
                expectedStdout: '4\n',
                expectedStderr: '',
            },
            // TODO: %U outputs the week of the year, as 2 digits, with weeks starting on Sunday, and the first being week 00
            // TODO: %V outputs the week of the year, as 2 digits, with weeks starting on Monday, and the first being week 01
            {
                description: '%w outputs the week day as a number, with Sunday = 0 and Saturday = 6',
                input: [ '+%w' ],
                options: { utc: true },
                expectedStdout: '4\n',
                expectedStderr: '',
            },
            // TODO: %W outputs the week of the year, as 2 digits,, with weeks starting on Monday, and the first being week 00
            {
                description: '%x outputs a local date representation',
                input: [ '+%x' ],
                options: { utc: true },
                expectedStdout: '3/7/2024\n',
                expectedStderr: '',
            },
            {
                description: '%X outputs a local time representation',
                input: [ '+%X' ],
                options: { utc: true },
                expectedStdout: '1:05:07 PM\n',
                expectedStderr: '',
            },
            {
                description: '%y outputs the year within a century, as 2 digits',
                input: [ '+%y' ],
                options: { utc: true },
                expectedStdout: '24\n',
                expectedStderr: '',
            },
            {
                description: '%Y outputs the year',
                input: [ '+%Y' ],
                options: { utc: true },
                expectedStdout: '2024\n',
                expectedStderr: '',
            },
            {
                description: '%Z outputs the timezone name',
                input: [ '+%Z' ],
                options: { utc: true },
                expectedStdout: 'UTC\n',
                expectedStderr: '',
            },
            {
                description: '%% outputs a percent sign',
                input: [ '+%%' ],
                options: { utc: true },
                expectedStdout: '%\n',
                expectedStderr: '',
            },
            {
                description: 'multiple format sequences can be included at once',
                input: [ '+%B is month %m' ],
                options: { utc: true },
                expectedStdout: 'March is month 03\n',
                expectedStderr: '',
            },
            {
                description: 'unrecognized formats are output verbatim',
                input: [ '+%4%L hello' ],
                options: { utc: true },
                expectedStdout: '%4%L hello\n',
                expectedStderr: '',
            },
        ];

        for (const { description, input, options, expectedStdout, expectedStderr, expectedFail } of testCases) {
            it(description, async () => {
                let ctx = MakeTestContext(builtins.date, { positionals: input, values: options });
                let hadError = false;
                try {
                    const result = await builtins.date.execute(ctx);
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
};
