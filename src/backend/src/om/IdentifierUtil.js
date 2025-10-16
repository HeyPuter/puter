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
const { AdvancedBase } = require("@heyputer/putility");
const { WeakConstructorFeature } = require("../traits/WeakConstructorFeature");
const { Eq, And } = require("./query/query");
const { Entity } = require("./entitystorage/Entity");

class IdentifierUtil extends AdvancedBase {
    static FEATURES = [
        new WeakConstructorFeature(),
    ]

    async detect_identifier (object, allow_mutation = false) {
        const redundant_identifiers = this.om.redundant_identifiers ?? [];

        let match_found = null;
        for ( let key_set of redundant_identifiers ) {
            key_set = Array.isArray(key_set) ? key_set : [key_set];
            key_set.sort();

            for ( let i=0 ; i < key_set.length ; i++ ) {
                const key = key_set[i];
                const has_key = object instanceof Entity ?
                    await object.has(key) : object[key] !== undefined;
                if ( ! has_key ) {
                    break;
                }
                if ( i === key_set.length - 1 ) {
                    match_found = key_set;
                    break;
                }
            }
        }

        if ( ! match_found ) return;

        // Construct a query predicate based on the keys
        const key_eqs = [];
        for ( const key of match_found ) {
            key_eqs.push(new Eq({
                key,
                value: object instanceof Entity ?
                    await object.get(key) : object[key],
            }));
            if ( object instanceof Entity ) {
                if ( allow_mutation ) await object.del(key);
            } else {
                if ( allow_mutation ) delete object[key];
            }
        }
        let predicate = new And({ children: key_eqs });

        return predicate;
    }
}

module.exports = {
    IdentifierUtil
};
