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

export default {
    name: 'mv',
    usage: 'mv SOURCE DESTINATION',
    description: 'Move SOURCE file or directory to DESTINATION.',
    args: {
        $: 'simple-parser',
        allowPositionals: true,
    },
    execute: async ctx => {
        const { positionals } = ctx.locals;
        const { out, err } = ctx.externs;
        const { filesystem } = ctx.platform;

        if ( positionals.length < 1 ) {
            await err.write('mv: missing file operand\n');
            throw new Exit(1);
        }

        const srcRelPath = positionals.shift();

        if ( positionals.length < 1 ) {
            const aft = positionals[0];
            await err.write(`mv: missing destination file operand after '${aft}'\n`);
            throw new Exit(1);
        }

        const dstRelPath = positionals.shift();

        const srcAbsPath = resolveRelativePath(ctx.vars, srcRelPath);
        let dstAbsPath = resolveRelativePath(ctx.vars, dstRelPath);

        await filesystem.move(srcAbsPath, dstAbsPath);
    },
};