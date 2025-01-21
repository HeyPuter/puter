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
const { WeakConstructorFeature } = require("../../traits/WeakConstructorFeature");

class Entity extends AdvancedBase {
    static FEATURES = [
        new WeakConstructorFeature(),
    ]

    constructor (args) {
        super(args);
        this.init_arg_keys_ = Object.keys(args);

        this.found = undefined;
        this.private_meta = {};

        this.values_ = {};
    }

    static async create (args, data) {
        const entity = new Entity(args);

        for ( const prop of Object.values(args.om.properties) ) {
            if ( ! data.hasOwnProperty(prop.name) ) continue;

            await entity.set(prop.name, data[prop.name]);
        }

        return entity;
    }

    async clone () {
        const args = {};
        for ( const k of this.init_arg_keys_ ) {
            args[k] = this[k];
        }
        const entity = new Entity(args);

        const BEHAVIOUR = 'A';

        if ( BEHAVIOUR === 'A' ) {
            entity.found = this.found;
            entity.private_meta = { ...this.private_meta };
            entity.values_ = { ...this.values_ };
        }
        if ( BEHAVIOUR === 'B' ) {
            for ( const prop of Object.values(this.om.properties) ) {
                if ( ! this.has(prop.name) ) continue;

                await entity.set(prop.name, await this.get(prop.name));
            }
        }

        return entity;
    }

    async apply (other) {
        for ( const prop of Object.values(this.om.properties) ) {
            if ( ! await other.has(prop.name) ) continue;
            await this.set(prop.name, await other.get(prop.name));
        }

        return this;
    }

    async set (key, value) {
        const prop = this.om.properties[key];
        if ( ! prop ) {
            throw Error(`property ${key} unrecognized`);
        }
        this.values_[key] = await prop.adapt(value);
    }

    async get (key) {
        const prop = this.om.properties[key];
        if ( ! prop ) {
            throw Error(`property ${key} unrecognized`);
        }
        let value = this.values_[key];
        let is_set = await prop.is_set(value);

        // If value is not set but we have a factory, use it.
        if ( ! is_set ) {
            value = await prop.factory();
            value = await prop.adapt(value);
            is_set = await prop.is_set(value);
            if ( is_set ) this.values_[key] = value;
        }

        // If value is not set but we have an implicator, use it.
        if ( ! is_set && prop.descriptor.imply ) {
            const { given, make } = prop.descriptor.imply;
            let imply_available = true;
            for ( const g of given ) {
                if ( ! await this.has(g) ) {
                    imply_available = false;
                    break;
                }
            }
            if ( imply_available ) {
                value = await make(this.values_);
                value = await prop.adapt(value);
                is_set =  await prop.is_set(value);
            }
            if ( is_set ) this.values_[key] = value;
        }

        return value;
    }

    async del (key) {
        const prop = this.om.properties[key];
        if ( ! prop ) {
            throw Error(`property ${key} unrecognized`);
        }
        delete this.values_[key];
    }

    async has (key) {
        const prop = this.om.properties[key];
        if ( ! prop ) {
            throw Error(`property ${key} unrecognized`);
        }
        return await prop.is_set(await this.get(key));
    }

    async check (condition) {
        return await condition.check(this);
    }

    om_has_property (key) {
        return this.om.properties.hasOwnProperty(key);
    }

    // alias for `has`
    async is_set (key) {
        return await this.has(key);
    }

    async get_client_safe () {
        return await this.om.get_client_safe(this.values_);
    }
}

module.exports = {
    Entity,
};
