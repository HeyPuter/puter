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
function highlight (text) {
    return `\x1B[92m${text}\x1B[0m`;
}

export default {
    name: 'dcall',
    usage: 'dcall INTERFACE:METHOD [ARGS]',
    description: 'Send a request to a driver, and print the response.\n\n' +
        'INTERFACE is the name of the driver interface.\n\n' +
        `METHOD is the basic operation to perform, for example ${highlight('create')}, ${highlight('read')}, ${highlight('update')}, or ${highlight('delete')}. The valid methods will depend on the driver.\n\n` +
        'ARGS is a JSON string that will be passed as the arguments to the driver method. This will depend on the driver and method.',
    args: {
        $: 'simple-parser',
        allowPositionals: true,
    },
    execute: async ctx => {
        const { positionals } = ctx.locals;
        const [ method, json ] = positionals;

        const { drivers } = ctx.platform;

        let a_interface, a_method, a_args;
        if ( method === 'test' ) {
            // a_interface = 'puter-kvstore';
            // a_method = 'get';
            // a_args = { key: 'something' };
            a_interface = 'puter-image-generation',
            a_method = 'generate';
            a_args = {
                prompt: 'a blue cat',
            };
        } else {
            [a_interface, a_method] = method.split(':');
            try {
                a_args = JSON.parse(json);
            } catch (e) {
                a_args = {};
            }
        }

        const result = await drivers.call({
            interface: a_interface,
            method: a_method,
            args: a_args,
        });

        await ctx.externs.out.write(result);
    },
};
