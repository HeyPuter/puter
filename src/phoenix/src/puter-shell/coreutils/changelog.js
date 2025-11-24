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
import { SHELL_VERSIONS } from '../../meta/versions.js';

async function printVersion (ctx, version) {
    await ctx.externs.out.write(`\x1B[35;1m[v${version.v}]\x1B[0m\n`);
    for ( const change of version.changes ) {
        await ctx.externs.out.write(`\x1B[32;1m+\x1B[0m ${change}\n`);
    }
}

export default {
    name: 'changelog',
    description: 'Print the changelog for the Phoenix Shell, ordered oldest to newest.',
    args: {
        $: 'simple-parser',
        allowPositionals: false,
        options: {
            latest: {
                description: 'Print only the changes for the most recent version',
                type: 'boolean',
            },
        },
    },
    execute: async ctx => {
        if ( ctx.locals.values.latest ) {
            await printVersion(ctx, SHELL_VERSIONS[0]);
            return;
        }

        for ( const version of SHELL_VERSIONS.toReversed() ) {
            await printVersion(ctx, version);
        }
    },
};
