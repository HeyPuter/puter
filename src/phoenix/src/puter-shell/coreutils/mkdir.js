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
import { validate_string } from "./coreutil_lib/validate.js";
import { EMPTY } from "../../util/singleton.js";
import { Exit } from './coreutil_lib/exit.js';
import { resolveRelativePath } from '../../util/path.js';

// DRY: very similar to `cd`
export default {
    name: 'mkdir',
    usage: 'mkdir [OPTIONS] PATH',
    description: 'Create a directory at PATH.',
    args: {
        $: 'simple-parser',
        allowPositionals: true,
        options: {
            parents: {
                description: 'Create parent directories if they do not exist. Do not treat existing directories as an error',
                type: 'boolean',
                short: 'p'
            }
        }
    },
    decorators: { errors: EMPTY },
    execute: async ctx => {
        // ctx.params to access processed args
        // ctx.args to access raw args
        const { positionals, values } = ctx.locals;
        const { filesystem } = ctx.platform;

        let [ target ] = positionals;

        try {
            validate_string(target, { name: 'path' });
        } catch (e) {
            await ctx.externs.err.write(`mkdir: ${e.message}\n`);
            throw new Exit(1);
        }

        target = resolveRelativePath(ctx.vars, target);

        const result = await filesystem.mkdir(target, { createMissingParents: values.parents });

        if ( result && result.$ === 'error' ) {
            await ctx.externs.err.write(`mkdir: ${result.message}\n`);
            throw new Exit(1);
        }
    }
};
