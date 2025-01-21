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
    name: 'man',
    usage: 'man',
    description: 'Stub command. Please use `help` instead.',
    args: {
        $: 'simple-parser',
        allowPositionals: true
    },
    execute: async ctx => {
        await ctx.externs.out.write('`\x1B[34;1mman\x1B[0m` is not supported. ' +
            'Please use `\x1B[34;1mhelp COMMAND\x1B[0m` for documentation.\n');
    }
};
