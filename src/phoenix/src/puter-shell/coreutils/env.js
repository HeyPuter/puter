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
    name: 'env',
    usage: 'env',
    description: 'Print environment variables, one per line, as NAME=VALUE.',
    args: {
        // TODO: add 'none-parser'
        $: 'simple-parser',
        allowPositionals: false,
    },
    execute: async ctx => {
        const env = ctx.env;
        const out = ctx.externs.out;

        for ( const k in env ) {
            await out.write(`${k}=${env[k]}\n`);
        }
    },
};
