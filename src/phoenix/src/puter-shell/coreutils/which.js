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
    name: 'which',
    usage: 'which COMMAND...',
    description: 'Look up each COMMAND, and return the path name of its executable.\n\n' +
        'Returns 1 if any COMMAND is not found, otherwise returns 0.',
    args: {
        $: 'simple-parser',
        allowPositionals: true,
        options: {
            'all': {
                description: 'Return all matching path names of each COMMAND, not just the first',
                type: 'boolean',
                short: 'a',
            },
        },
    },
    execute: async ctx => {
        const { out, err, commandProvider } = ctx.externs;
        const { positionals, values } = ctx.locals;

        let anyCommandsNotFound = false;

        const printPath = async ( commandName, command ) => {
            if ( command.path ) {
                await out.write(`${command.path}\n`);
            } else {
                await out.write(`${commandName}: shell built-in command\n`);
            }
        };

        for ( const commandName of positionals ) {
            const result = values.all
                ? await commandProvider.lookupAll(commandName, { ctx })
                : await commandProvider.lookup(commandName, { ctx });

            if ( ! result ) {
                anyCommandsNotFound = true;
                await err.write(`${commandName} not found\n`);
                continue;
            }

            if ( values.all ) {
                for ( const command of result ) {
                    await printPath(commandName, command);
                }
            } else {
                await printPath(commandName, result);
            }
        }

        if ( anyCommandsNotFound ) {
            throw new Exit(1);
        }
    },
};
