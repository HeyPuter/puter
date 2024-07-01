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
const { AdvancedBase } = require("@heyputer/puter-js-common");

/**
 * MutliValue represents a subject with multiple values or a value with multiple
 * formats/types. It can be used for lazy evaluation of values and prioritizing
 * equally-suitable outputs with lower resource cost.
 *
 * For example, a MultiValue representing a file could have a key called
 * `stream` as well as a key called `s3-info`. It would always be possible
 * to obtain a `stream` but when the `s3-info` is available and applicable
 * it will be less costly to obtain.
 */
class MultiValue extends AdvancedBase {
    constructor () {
        super();
        this.factories = {};
        this.values = {};
    }

    async add_factory (key_desired, key_available, fn, cost) {
        if ( ! this.factories[key_desired] ) {
            this.factories[key_desired] = [];
        }
        this.factories[key_desired].push({
            key_available,
            fn,
            cost,
        });
    }

    async get (key) {
        return this._get(key);
    }

    set (key, value) {
        this.values[key] = value;
    }

    async _get (key) {
        if ( this.values[key] ) {
            return this.values[key];
        }
        const factories = this.factories[key];
        if ( ! factories || ! factories.length ) {
            console.log('no factory for key', key)
            return undefined;
        }
        for ( const factory of factories ) {
            const available = await this._get(factory.key_available);
            if ( ! available ) {
                console.log('no available for key', key, factory.key_available);
                continue;
            }
            const value = await factory.fn(available);
            this.values[key] = value;
            return value;
        }
        return undefined;
    }
}

module.exports = {
    MultiValue,
};
