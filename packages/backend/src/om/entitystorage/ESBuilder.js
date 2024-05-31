/*
 * Copyright (C) 2024 Puter Technologies Inc.
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
class ESBuilder {
    static create (list) {
        let stack = [];
        let head = null;
        const apply_next = () => {
            const args = [];
            let last_was_cons = false;
            while ( ! last_was_cons ) {
                const item = stack.pop();
                if ( typeof item === 'function' ) {
                    last_was_cons = true;
                }
                args.unshift(item);
            }

            const cls = args.shift();
            head = new cls({
                ...(args[0] ?? {}),
                ...(head ? { upstream: head } : {}),
            });
        }
        for ( const item of list ) {
            const is_cons = typeof item === 'function';

            if ( is_cons ) {
                if ( stack.length > 0 ) apply_next();
            }

            stack.push(item);
        }

        if ( stack.length > 0 ) apply_next();

        // Print the classes in order
        let current = head;
        while ( current ) {
            current = current.upstream;
        }

        return head;
    }
}

module.exports = {
    ESBuilder,
};
