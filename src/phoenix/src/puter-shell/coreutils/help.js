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
// TODO: fetch help information from command registry

import { printUsage } from './coreutil_lib/help.js';
import { Exit } from './coreutil_lib/exit.js';

export default {
    name: 'help',
    usage: ['help', 'help COMMAND'],
    description: 'Print help information for a specific command, or list available commands.\n\n' +
        'If COMMAND is provided, print the documentation for that command. ' +
        'Otherwise, list all the commands that are available.',
    args: {
        $: 'simple-parser',
        allowPositionals: true,
    },
    execute: async ctx => {
        const { positionals } = ctx.locals;
        const { builtins } = ctx.registries;

        const { out, err } = ctx.externs;

        if ( positionals.length > 1 ) {
            await err.write('help: Too many arguments, expected 0 or 1\n');
            throw new Exit(1);
        }

        if ( positionals.length === 1 ) {
            const commandName = positionals[0];
            const command = builtins[commandName];
            if ( ! command ) {
                await err.write(`help: No builtin found named '${commandName}'\n`);
                throw new Exit(1);
            }
            await printUsage(command, out, ctx.vars);
            return;
        }

        const heading = txt => {
            out.write(`\x1B[34;1m~ ${txt} ~\x1B[0m\n`);
        };

        heading('available commands');
        out.write('Use \x1B[34;1mhelp COMMAND-NAME\x1B[0m for more information\n');
        for ( const k in builtins ) {
            out.write(`  - ${ k }\n`);
        }
        out.write('\n');
        heading('available features');
        out.write('  - pipes; ex: ls | tail -n 2\n');
        out.write('  - redirects; ex: ls > some_file.txt\n');
        out.write('  - simple tab completion\n');
        out.write('  - in-memory command history\n');
        out.write('\n');
        heading('what\'s coming up?');
        out.write('  - keep watching for \x1B[34;1mmore\x1B[0m (est: v0.1.11)\n');
        // out.write('  - \x1B[34;1mcurl\x1B[0m up with your favorite terminal (est: TBA)\n')
    },
};
