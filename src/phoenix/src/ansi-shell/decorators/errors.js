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
    name: 'errors',
    decorate (fn, { command, ctx }) {
        return async (...a) => {
            try {
                await fn(...a);
            } catch (e) {
                console.log('GOT IT HERE');
                // message without "Error:"
                let message = e.message;
                if ( message.startsWith('Error: ') ) {
                    message = message.slice(7);
                }
                ctx.externs.err.write(`\x1B[31;1m${ command.name }: ${ message }\x1B[0m\n`);
            }
        };
    },
};
