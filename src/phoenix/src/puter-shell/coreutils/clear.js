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
export default {
    name: 'clear',
    usage: 'clear',
    description: 'Clear the terminal output.',
    args: {
        $: 'simple-parser',
        allowPositionals: false,
        options: {
            'keep-scrollback': {
                description: 'Only clear the visible portion of the screen, and keep the scrollback.',
                type: 'boolean',
                short: 'x',
            },
        },
    },
    execute: async ctx => {
        await ctx.externs.out.write('\x1B[H\x1B[2J');
        if ( ! ctx.locals.values['keep-scrollback'] )
        {
            await ctx.externs.out.write('\x1B[H\x1B[3J');
        }
    },
};
