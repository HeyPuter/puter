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
import { processEscapes } from './coreutil_lib/echo_escapes.js';

export default {
    name: 'echo',
    usage: 'echo [OPTIONS] INPUTS...',
    description: 'Print the inputs to standard output.',
    args: {
        $: 'simple-parser',
        allowPositionals: true,
        options: {
            'no-newline': {
                description: 'Do not print a trailing newline',
                type: 'boolean',
                short: 'n',
            },
            'enable-escapes': {
                description: 'Interpret backslash escape sequences',
                type: 'boolean',
                short: 'e',
            },
            'disable-escapes': {
                description: 'Disable interpreting backslash escape sequences',
                type: 'boolean',
                short: 'E',
            },
        },
    },
    execute: async ctx => {
        const { positionals, values } = ctx.locals;

        let output = '';
        let notFirst = false;
        for ( const positional of positionals ) {
            if ( notFirst ) {
                output += ' ';
            } else notFirst = true;
            output += positional;
        }

        if ( ! values.n ) {
            output += '\n';
        }

        if ( values.e && !values.E ) {
            console.log('processing');
            output = processEscapes(output);
        }

        const lines = output.split('\n');
        for ( let i = 0 ; i < lines.length ; i++ ) {
            const line = lines[i];
            const isLast = i === lines.length - 1;
            await ctx.externs.out.write(line + (isLast ? '' : '\n'));
        }
    },
};
