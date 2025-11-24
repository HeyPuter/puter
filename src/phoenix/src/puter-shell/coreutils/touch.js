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
import { resolveRelativePath } from '../../util/path.js';
import { ErrorCodes } from '@heyputer/putility/src/PosixError.js';

export default {
    name: 'touch',
    usage: 'touch FILE...',
    description: 'Mark the FILE(s) as accessed and modified at the current time, creating them if they do not exist.',
    args: {
        $: 'simple-parser',
        allowPositionals: true,
    },
    execute: async ctx => {
        const { positionals } = ctx.locals;
        const { filesystem } = ctx.platform;

        if ( positionals.length === 0 ) {
            await ctx.externs.err.write('touch: missing file operand\n');
            throw new Exit(1);
        }

        for ( let i = 0 ; i < positionals.length ; i++ ) {
            const path = resolveRelativePath(ctx.vars, positionals[i]);

            let stat = null;
            try {
                stat = await filesystem.stat(path);
            } catch (e) {
                if ( e.posixCode !== ErrorCodes.ENOENT ) {
                    await ctx.externs.err.write(`touch: ${e.message}\n`);
                    throw new Exit(1);
                }
            }

            if ( stat ) continue;

            await filesystem.write(path, '');
        }
    },
};
