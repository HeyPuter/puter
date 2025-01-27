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
 * Sets replacement.__proto__ to `delegate`
 * then iterates over members of `replacement` looking for
 * objects that are not arrays.
 *
 * When an object is found, a recursive call is made to
 * `deep_proto_merge` with the corresponding object in `delegate`.
 *
 * If `preserve_flag` is set to true, only objects containing
 * a truthy property named `$preserve` will be merged.
 *
 * @param {*} replacement
 * @param {*} delegate
 */
const deep_proto_merge = (replacement, delegate, options) => {
    const is_object = (obj) => obj &&
        typeof obj === 'object' && !Array.isArray(obj);

    replacement.__proto__ = delegate;

    for ( const key in replacement ) {
        if ( ! is_object(replacement[key]) ) continue;

        if ( options?.preserve_flag && ! replacement[key].$preserve ) {
            continue;
        }
        if ( ! is_object(delegate[key]) ) {
            continue;
        }
        replacement[key] = deep_proto_merge(
            replacement[key], delegate[key], options,
        );
    }

    // use a Proxy object to ensure all keys are present
    // when listing keys of `replacement`
    replacement = new Proxy(replacement, {
        // no get needed
        // no set needed
        ownKeys: (target) => {
            const ownProps = Reflect.ownKeys(target); // Get own property names and symbols, including non-enumerable
            const protoProps = Reflect.ownKeys(Object.getPrototypeOf(target)); // Get prototype's properties

            // Combine and deduplicate properties using a Set, then convert back to an array
            const s = new Set([
                ...protoProps,
                ...ownProps
            ]);

            if (options?.preserve_flag) {
                // remove $preserve if it exists
                s.delete('$preserve');
            }

            return Array.from(s);
        },
        getOwnPropertyDescriptor: (target, prop) => {
            // Real descriptor
            let descriptor = Object.getOwnPropertyDescriptor(target, prop);

            if (descriptor) return descriptor;

            // Immediate prototype descriptor
            const proto = Object.getPrototypeOf(target);
            descriptor = Object.getOwnPropertyDescriptor(proto, prop);

            if (descriptor) return descriptor;

            return undefined;
        }

    });

    return replacement;
};

module.exports = deep_proto_merge;
