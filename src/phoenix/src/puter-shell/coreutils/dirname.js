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
    name: 'dirname',
    usage: 'dirname PATH',
    description: 'Print PATH without its final segment.',
    args: {
        $: 'simple-parser',
        allowPositionals: true
    },
    execute: async ctx => {
        let string = ctx.locals.positionals[0];
        const removeTrailingSlashes = (input) => {
            return input.replace(/\/+$/, '');
        }

        if (string === undefined) {
            await ctx.externs.err.write('dirname: Missing path argument\n');
            throw new Exit(1);
        }
        if (ctx.locals.positionals.length > 1) {
            await ctx.externs.err.write('dirname: Too many arguments, expected 1\n');
            throw new Exit(1);
        }

        // https://pubs.opengroup.org/onlinepubs/9699919799/utilities/dirname.html
        let skipToAfterStep8 = false;

        // 1. If string is //, skip steps 2 to 5.
        if (string !== '//') {
            // 2. If string consists entirely of <slash> characters, string shall be set to a single <slash> character.
            //    In this case, skip steps 3 to 8.
            if (string === '/'.repeat(string.length)) {
                string = '/';
                skipToAfterStep8 = true;
            } else {
                // 3. If there are any trailing <slash> characters in string, they shall be removed.
                string = removeTrailingSlashes(string);

                // 4. If there are no <slash> characters remaining in string, string shall be set to a single <period> character.
                //    In this case, skip steps 5 to 8.
                if (string.indexOf('/') === -1) {
                    string = '.';
                    skipToAfterStep8 = true;
                }

                // 5. If there are any trailing non- <slash> characters in string, they shall be removed.
                else {
                    const lastSlashIndex = string.lastIndexOf('/');
                    if (lastSlashIndex === -1) {
                        string = '';
                    } else {
                        string = string.substring(0, lastSlashIndex);
                    }
                }
            }
        }

        if (!skipToAfterStep8) {
            // 6. If the remaining string is //, it is implementation-defined whether steps 7 and 8 are skipped or processed.
            // NOTE: We process it normally.

            // 7. If there are any trailing <slash> characters in string, they shall be removed.
            string = removeTrailingSlashes(string);

            // 8. If the remaining string is empty, string shall be set to a single <slash> character.
            if (string.length === 0) {
                string = '/';
            }
        }

        // The resulting string shall be written to standard output.
        await ctx.externs.out.write(string + '\n');
    }
};
