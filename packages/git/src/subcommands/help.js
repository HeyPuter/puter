/*
 * Copyright (C) 2024  Puter Technologies Inc.
 *
 * This file is part of Puter's Git client.
 *
 * Puter's Git client is free software: you can redistribute it and/or modify
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
import subcommands from './__exports__.js';
import git_command from '../git-command-definition.js';
import { produce_help_string } from '../help.js';

export default {
    name: 'help',
    usage: ['git help [-a|--all]', 'git help <command>'],
    description: `Display help information for git itself, or a subcommand.`,
    args: {
        allowPositionals: true,
        options: {
            all: {
                description: 'List all available subcommands.',
                type: 'boolean',
            }
        },
    },
    execute: async (ctx) => {
        const { io, fs, env, args } = ctx;
        const { stdout, stderr } = io;
        const { options, positionals } = args;

        if (options.all) {
            stdout(`See 'git help <command>' for more information.\n`);
            const max_name_length = Object.keys(subcommands).reduce((max, name) => Math.max(max, name.length), 0);
            for (const [name, command] of Object.entries(subcommands)) {
                stdout(`    ${name} ${' '.repeat(Math.max(max_name_length - name.length, 0))} ${command.description || ''}`);
            }
            return;
        }

        if (positionals.length > 0) {
            // Try and display help page for the subcommand
            const subcommand_name = positionals[0];
            const subcommand = subcommands[subcommand_name];
            if (!subcommand)
                throw new Error(`No manual entry for ${subcommand_name}`);

            stdout(produce_help_string(subcommand));

            return;
        }

        // No subcommand name, so show general help
        stdout(produce_help_string(git_command));
    }
}
