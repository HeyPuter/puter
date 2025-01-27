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
import { parseArgs } from '@pkgjs/parseargs';
import { DEFAULT_OPTIONS } from '../../puter-shell/coreutils/coreutil_lib/help.js';

export default {
    name: 'simple-parser',
    async process (ctx, spec) {
        // Insert standard options
        spec.options = Object.assign(spec.options || {}, DEFAULT_OPTIONS);

        let result;
        try {
            result = parseArgs({ ...spec, args: ctx.locals.args });
        } catch (e) {
            await ctx.externs.out.write(
                '\x1B[31;1m' +
                'error parsing arguments: ' +
                e.message + '\x1B[0m\n');
            ctx.cmdExecState.valid = false;
            return;
        }

        if (result.values.help) {
            ctx.cmdExecState.printHelpAndExit = true;
        }

        ctx.locals.values = result.values;
        ctx.locals.positionals = result.positionals;
        if (result.tokens)
            ctx.locals.tokens = result.tokens;
    }
}
