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

/**
 * The command definition for `git` itself, in the same format as subcommands.
 */
export default {
    name: 'git',
    usage: 'git [--version] [--help] [command] [command-args...]',
    description: 'Git version-control client for Puter.',
    args: {
        options: {
            help: {
                description: 'Display help information for git itself, or a subcommand.',
                type: 'boolean',
            },
            version: {
                description: 'Display version information about git.',
                type: 'boolean',
            },
            debug: {
                description: 'Enable debug logging to the browser console.',
                type: 'boolean',
                default: false,
            },
        },
    },
};
