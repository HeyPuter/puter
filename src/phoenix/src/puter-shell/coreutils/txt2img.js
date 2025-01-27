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
    name: 'txt2img',
    usage: 'txt2img PROMPT',
    description: 'Send PROMPT to an image-drawing AI, and print the result to standard output.',
    args: {
        $: 'simple-parser',
        allowPositionals: true,
    },
    execute: async ctx => {
        const { positionals } = ctx.locals;
        const [ prompt ] = positionals;

        if ( ! prompt ) {
            await ctx.externs.err.write('txt2img: missing prompt\n');
            throw new Exit(1);
        }
        if ( positionals.length > 1 ) {
            await ctx.externs.err.write('txt2img: prompt must be wrapped in quotes\n');
            throw new Exit(1);
        }

        const { drivers } = ctx.platform;

        let a_interface, a_method, a_args;

        a_interface = 'puter-image-generation';
        a_method = 'generate';
        a_args = { prompt };

        const result = await drivers.call({
            interface: a_interface,
            method: a_method,
            args: a_args,
        });

        await ctx.externs.out.write(result);
    }
}
