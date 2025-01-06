// METADATA // {"ai-commented":{"service":"mistral","model":"mistral-large-latest"}}
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
const { BasicBase } = require("../../../../../putility/src/bases/BasicBase");
const types = require("../types");
const { hash_serializable_object, stringify_serializable_object } = require("../../../util/datautil");


/**
* @class Construct
* @extends BasicBase
* @classdesc The Construct class is a base class for building various types of constructs.
* It extends the BasicBase class and provides a framework for processing and serializing
* constructs. This class includes methods for processing raw data and serializing the
* constructed object into a JSON-compatible format.
*/
class Construct extends BasicBase {
    constructor (json, { name } = {}) {
        super();
        this.name = name;
        this.raw = json;
        this.__process();
    }


    /**
    * Processes the raw JSON data to initialize the object's properties.
    * If a process function is defined, it will be executed with the raw JSON data.
    */
    __process () {
        if ( this._process ) this._process(this.raw);
    }


    /**
    * Serializes the properties of the object into a JSON-compatible format.
    *
    * This method iterates over the properties defined in the static `PROPERTIES`
    * object and serializes each property according to its type.
    *
    * @returns {Object} The serialized representation of the object.
    */
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


/**
* @class Parameter
* @extends Construct
* @description The Parameter class extends the Construct class and is used to define a parameter in a method.
* It includes properties such as type, whether it's optional, and a description.
* The class processes raw data to initialize these properties.
*/
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


/**
* @class Method
* @extends Construct
* @description Represents a method in the system, including its description, parameters, and result.
*              This class processes raw method data and structures it into a usable format.
*/
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


/**
* @class Interface
* @extends Construct
* @description The Interface class represents a collection of methods and their descriptions.
* It extends the Construct class and defines static properties and methods to process raw data
* into a structured format. Each method in the Interface is an instance of the Method class,
* which in turn contains Parameter instances for its parameters and result.
*/
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


/**
* @class TypeSpec
* @extends BasicBase
* @description The TypeSpec class is used to represent a type specification.
* It provides methods to adapt raw data into a TypeSpec instance, check equality,
* convert the raw data to a string, and generate a hash of the raw data.
*/
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


    /**
    * Converts the TypeSpec object to its string representation.
    *
    * @returns {string} The string representation of the TypeSpec object.
    */
    toString () {
        return stringify_serializable_object(this.raw);
    }


    /**
    * Generates a hash value for the serialized object.
    *
    * This method uses the `hash_serializable_object` utility function to create a hash
    * from the internal `raw` object. This hash can be used for comparison or indexing.
    *
    * @returns {string} The hash value of the serialized object.
    */
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
