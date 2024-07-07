/*
 * Copyright (C) 2024  Puter Technologies Inc.
 *
 * This file is part of Phoenix Shell.
 *
 * Phoenix Shell is free software: you can redistribute it and/or modify
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
    name: 'exit',
    usage: 'exit [CODE]',
    description: 'Exit the shell and return the given CODE. If no argument is given, uses the most recent return code.',
    args: {
        $: 'simple-parser',
        allowPositionals: true
    },
    execute: async ctx => {
        const { positionals, exit } = ctx.locals;

        let status_code = 0;

        if (positionals.length === 0) {
            status_code = exit;
        } else if (positionals.length === 1) {
            const maybe_number = Number(positionals[0]);
            if (Number.isInteger(maybe_number)) {
                status_code = maybe_number;
            }
        } else {
            await ctx.externs.err.write('exit: Too many arguments');
            throw new Exit(1);
        }

        ctx.platform.system.exit(status_code);
    }
};
