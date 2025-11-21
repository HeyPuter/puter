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
    name: 'sample-data',
    args: {
        $: 'simple-parser',
        allowPositionals: true,
    },
    execute: async ctx => {
        const { positionals } = ctx.locals;
        const [ what ] = positionals;

        if ( what === 'blob' ) {
            // Hello world blob
            const blob = new Blob([ 'Hello, world!' ]);
            console.log('before writing');
            await ctx.externs.out.write(blob);
            console.log('after writing');
            return;
        }

        console.log('before writing');
        await ctx.externs.out.write('Hello, World!\n');
        console.log('after writing');
    },
};
