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
const { BasicBase } = require("@heyputer/puter-js-common/src/bases/BasicBase");
const types = require("../types");
const { hash_serializable_object, stringify_serializable_object } = require("../../../util/datautil");

class Construct extends BasicBase {
    constructor (json, { name } = {}) {
        super();
        this.name = name;
        this.raw = json;
        this.__process();
    }

    __process () {
        if ( this._process ) this._process(this.raw);
    }

    serialize () {
        const props = this._get_merged_static_object('PROPERTIES');
        const serialized = {};
        for ( const prop_name in props ) {
            const prop = props[prop_name];

            if ( prop.type === 'object' ) {
                serialized[prop_name] = this[prop_name]?.serialize?.() ?? null;
            } else if ( prop.type === 'map' ) {
                serialized[prop_name] = {};
                for ( const key in this[prop_name] ) {
                    const object = this[prop_name][key];
                    serialized[prop_name][key] = object.serialize();
                }
            } else {
                serialized[prop_name] = this[prop_name];
            }
        }
        return serialized;
    }
}

class Parameter extends Construct {
    static PROPERTIES = {
        type: { type: 'object' },
        optional: { type: 'boolean' },
        description: { type: 'string' },
    };

    _process (raw) {
        this.type = types[raw.type];
    }
}

class Method extends Construct {
    static PROPERTIES = {
        description: { type: 'string' },
        parameters: { type: 'map' },
        result: { type: 'object' },
    };

    _process (raw) {
        this.description = raw.description;
        this.parameters = {};

        for ( const parameter_name in raw.parameters ) {
            const parameter = raw.parameters[parameter_name];
            this.parameters[parameter_name] = new Parameter(
                parameter, { name: parameter_name });
        }

        if ( raw.result ) {
            this.result = new Parameter(raw.result, { name: 'result' });
        }
    }
}

class Interface extends Construct {
    static PROPERTIES = {
        description: { type: 'string' },
        methods: { type: 'map' },
    };

    _process (raw) {
        this.description = raw.description;
        this.methods = {};

        for ( const method_name in raw.methods ) {
            const method = raw.methods[method_name];
            this.methods[method_name] = new Method(
                method, { name: method_name });
        }
    }
}

class TypeSpec extends BasicBase {
    static adapt (raw) {
        if ( raw instanceof TypeSpec ) return raw;
        return new TypeSpec(raw);
    }
    constructor (raw) {
        super();
        this.raw = raw;
    }

    equals (other) {
        return this.raw.$ === other.raw.$;
    }

    toString () {
        return stringify_serializable_object(this.raw);
    }

    hash () {
        return hash_serializable_object(this.raw);
    }
}

// NEXT: class Type extends Construct

module.exports = {
    Construct,
    Parameter,
    Method,
    Interface,
    TypeSpec,
}
