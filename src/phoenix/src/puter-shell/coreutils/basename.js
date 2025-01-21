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
import { Exit } from './coreutil_lib/exit.js';

export default {
    name: 'basename',
    usage: 'basename PATH [SUFFIX]',
    description: 'Print PATH without leading directory segments.\n\n' +
        'If SUFFIX is provided, it is removed from the end of the result.',
    args: {
        $: 'simple-parser',
        allowPositionals: true
    },
    execute: async ctx => {
        let string = ctx.locals.positionals[0];
        const suffix = ctx.locals.positionals[1];

        if (string === undefined) {
            await ctx.externs.err.write('basename: Missing path argument\n');
            throw new Exit(1);
        }
        if (ctx.locals.positionals.length > 2) {
            await ctx.externs.err.write('basename: Too many arguments, expected 1 or 2\n');
            throw new Exit(1);
        }

        // https://pubs.opengroup.org/onlinepubs/9699919799/utilities/basename.html

        // 1. If string is a null string, it is unspecified whether the resulting string is '.' or a null string.
        //    In either case, skip steps 2 through 6.
        if (string === '') {
            string = '.';
        } else {
            // 2. If string is "//", it is implementation-defined whether steps 3 to 6 are skipped or processed.
            // NOTE: We process it normally.

            // 3. If string consists entirely of <slash> characters, string shall be set to a single <slash> character.
            //    In this case, skip steps 4 to 6.
            if (/^\/+$/.test(string)) {
                string = '/';
            } else {
                // 4. If there are any trailing <slash> characters in string, they shall be removed.
                string = string.replace(/\/+$/, '');

                // 5. If there are any <slash> characters remaining in string, the prefix of string up to and including
                //    the last <slash> character in string shall be removed.
                const lastSlashIndex = string.lastIndexOf('/');
                if (lastSlashIndex !== -1) {
                    string = string.substring(lastSlashIndex + 1);
                }

                // 6. If the suffix operand is present, is not identical to the characters remaining in string, and is
                //    identical to a suffix of the characters remaining in string, the suffix suffix shall be removed
                //    from string. Otherwise, string is not modified by this step. It shall not be considered an error
                //    if suffix is not found in string.
                if (suffix !== undefined && suffix !== string && string.endsWith(suffix)) {
                    string = string.substring(0, string.length - suffix.length);
                }
            }
        }

        // The resulting string shall be written to standard output.
        await ctx.externs.out.write(string + '\n');
    }
};
