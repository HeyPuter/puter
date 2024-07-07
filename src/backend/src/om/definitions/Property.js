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
const { WeakConstructorTrait } = require("../../traits/WeakConstructorTrait");

class Property extends AdvancedBase {
    static TRAITS = [
        new WeakConstructorTrait(),
    ]

    static create (context, name, descriptor) {
        // Adapt descriptor
        if ( typeof descriptor === 'string' ) {
            descriptor = { type: descriptor };
        }

        const registry = context.get('registry');
        const types = registry.get('om:proptype');
        const typ = types.get(descriptor['type']);

        if ( ! typ ) {
            throw new Error(`Failed to find type "${descriptor['type']}"`);
        }

        // NEXT

        return new Property({ name, descriptor, typ });
    }

    constructor (...a) {
        super(...a);
    }

    async adapt (value) {
        const { name, descriptor } = this;
        try {
            value = await this.typ.adapt(value, { name, descriptor });
            if ( descriptor.adapt && typeof descriptor.adapt === 'function' ) {
                value = await descriptor.adapt(value, { name, descriptor });
            }
        } catch ( e ) {
            throw new Error(`Failed to adapt ${name} to ${descriptor.type}: ${e.message}`);
        }
        return value;
    }

    async sql_dereference (value) {
        const { name, descriptor } = this;
        return await this.typ.sql_dereference(value, { name, descriptor });
    }

    async sql_reference (value) {
        const { name, descriptor } = this;
        return await this.typ.sql_reference(value, { name, descriptor });
    }

    async validate (value) {
        const { name, descriptor } = this;
        if ( this.descriptor.validate ) {
            let result = await this.descriptor.validate(value);
            if ( result && result !== true ) return result;
        }
        return await this.typ.validate(value, { name, descriptor });
    }

    async factory () {
        const { name, descriptor } = this;
        if ( this.descriptor.factory ) {
            let value = await this.descriptor.factory();
            if ( value ) return value;
        }
        return await this.typ.factory({ name, descriptor });
    }

    async is_set (value) {
        return await this.typ.is_set(value);
    }
}

module.exports = {
    Property
};
