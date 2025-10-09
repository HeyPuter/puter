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

class PropType extends AdvancedBase {
    static FEATURES = [
        new WeakConstructorFeature(),
    ]

    static create (context, data, k) {
        const chains = {};
        const super_type = data.from && (() => {
            const registry = context.get('registry');
            const types = registry.get('om:proptype');
            const super_type = types.get(data.from);
            if ( ! super_type ) {
                throw new Error(`Failed to find super type "${data.from}"`);
            }
            return super_type;
        })();

        data = { ...data };
        delete data.from;

        if ( super_type ) {
            super_type.populate_subtype_(chains);
        }

        for ( const k in data ) {
            if ( ! chains.hasOwnProperty(k) ) {
                chains[k] = [];
            }
            chains[k].push(data[k]);
        }

        return new PropType({
            chains, name: k,
        });
    }

    populate_subtype_ (chains) {
        for ( const k in this.chains ) {
            if ( ! chains.hasOwnProperty(k) ) {
                chains[k] = [];
            }
            chains[k].push(...this.chains[k]);
        }
    }

    async adapt (value, extra) {
        const adapters = this.chains.adapt || [];
        adapters.reverse();

        for ( const adapter of adapters ) {
            value = await adapter(value, extra);
        }

        return value;
    }

    async sql_dereference (value, extra) {
        const sql_dereferences = this.chains.sql_dereference || [];

        for ( const sql_dereference of sql_dereferences ) {
            value = await sql_dereference(value, extra);
        }

        return value;
    }

    async sql_reference (value, extra) {
        const sql_references = this.chains.sql_reference || [];

        for ( const sql_reference of sql_references ) {
            value = await sql_reference(value, extra);
        }

        return value;
    }

    async validate (value, extra) {
        const validators = this.chains.validate || [];

        for ( const validator of validators ) {
            const result = await validator(value, extra);
            if ( result !== true && result !== undefined ) {
                return result;
            }
        }

        return true;
    }

    async factory (extra) {
        const factories = (
            this.chains.factory && [...this.chains.factory].reverse()
        ) || [];

        if ( process.env.DEBUG ) {
            console.log('FACTORIES', factories);
        }

        for ( const factory of factories ) {
            const result = await factory(extra);
            if ( result !== undefined ) {
                return result;
            }
        }

        return undefined;
    }

    async is_set (value) {
        const is_setters = this.chains.is_set || [];

        for ( const is_setter of is_setters ) {
            const result = await is_setter(value);
            if ( ! result ) {
                return false;
            }
        }

        return true;
    }
}

module.exports = {
    PropType,
};
