// METADATA // {"ai-commented":{"service":"claude"}}
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
const { AdvancedBase } = require("../../../../putility");
const { is_valid_path } = require("../../filesystem/validation");
const { is_valid_url, is_valid_uuid4 } = require("../../helpers");
const { FileFacade } = require("./FileFacade");
const APIError = require("../../api/APIError");


/**
* @class BaseType
* @extends AdvancedBase
* @description Base class for all type validators in the Puter type system.
* Extends AdvancedBase to provide core functionality for type checking and validation.
* Serves as the foundation for specialized type classes like String, Flag, NumberType, etc.
* Each type has a consolidate method that takes an input value and
* returns a sanitized or coerced value appropriate for that input.
*/
class BaseType extends AdvancedBase {}


/**
* @class String
* @extends AdvancedBase
* @description A class that handles string values in the type system.
*/
class String extends BaseType {
    /**
    * Consolidates input into a string value
    * @param {Object} ctx - The context object
    * @param {*} input - The input value to consolidate
    * @returns {string|undefined} The consolidated string value, or undefined if input is null/undefined
    */
    async consolidate (ctx, input) {
        // undefined means the optional parameter was not provided,
        // which is different from an empty string.
        return (
            input === undefined ||
            input === null
        ) ? undefined : '' + input;
    }


    /**
    * Serializes the type to a string representation
    * @returns {string} Always returns 'string' to identify this as a string type
    */
    serialize () { return 'string'; }
}


/**
* @class Flag
* @description A class that handles boolean flag values in the type system. 
* Converts any input value to a boolean using double negation, 
* making it useful for command line flags and boolean parameters.
* Extends BaseType to integrate with the type validation system.
*/
class Flag extends BaseType {
    /**
    * Consolidates input into a boolean flag value
    * @param {Object} ctx - The context object
    * @param {*} input - The input value to consolidate
    * @returns {boolean} The consolidated boolean value, using double negation to coerce to boolean
    */
    async consolidate (ctx, input) {
        return !! input;
    }


    /**
    * Serializes the Flag type to a string representation
    * @returns {string} Returns 'flag' as the type identifier
    */
    serialize () { return 'flag'; }
}


/**
* @class NumberType
* @extends BaseType
* @description Represents a number type validator and consolidator for API parameters.
* Handles both regular and unsigned numbers, performs type checking, and validates
* numeric constraints. Supports optional values and throws appropriate API errors
* for invalid inputs.
*/
class NumberType extends BaseType {
    /**
    * Validates and consolidates number inputs for API parameters
    * @param {Object} ctx - The context object
    * @param {*} input - The input value to validate
    * @param {Object} options - Options object containing arg_name and arg_descriptor
    * @param {string} options.arg_name - Name of the argument being validated
    * @param {Object} options.arg_descriptor - Descriptor containing validation rules
    * @returns {number|undefined} The validated number or undefined if input was undefined
    * @throws {APIError} If input is not a valid number or violates unsigned constraint
    */
    async consolidate (ctx, input, { arg_name, arg_descriptor }) {
        // Case for optional values
        if ( input === undefined ) return undefined;

        if ( typeof input !== 'number' ) {
            throw APIError.create('field_invalid', null, {
                key: arg_name,
                expected: 'number',
            });
        }

        if ( arg_descriptor.unsigned && input < 0 ) {
            throw APIError.create('field_invalid', null, {
                key: arg_name,
                expected: 'unsigned number',
            });
        }

        return input;
    }


    /**
    * Validates and consolidates a number input value
    * @param {Object} ctx - The context object
    * @param {number} input - The input number to validate
    * @param {Object} options - Options object containing arg_name and arg_descriptor
    * @param {string} options.arg_name - The name of the argument being validated
    * @param {Object} options.arg_descriptor - Descriptor containing validation rules like 'unsigned'
    * @returns {number|undefined} The validated number or undefined if input was undefined
    * @throws {APIError} If input is not a valid number or violates unsigned constraint
    */
    serialize () { return 'number'; }
}


/**
* @class URL
* @description A class for validating and handling URL inputs. This class extends BaseType and provides
* functionality to validate whether a given input is a properly formatted URL. It throws an APIError if
* the input is invalid. Used within the type system to ensure URL parameters meet the required format
* specifications.
*/
class URL extends BaseType {
    /**
    * Validates and consolidates URL inputs
    * @param {Object} ctx - The context object
    * @param {string} input - The URL string to validate
    * @param {Object} options - Options object containing arg_name
    * @param {string} options.arg_name - Name of the argument being validated
    * @returns {string} The validated URL string
    * @throws {APIError} If the input is not a valid URL
    */
    async consolidate (ctx, input, { arg_name }) {
        if ( ! is_valid_url(input) ) {
            throw APIError.create('field_invalid', null, {
                key: arg_name,
                expected: 'URL',
            });
        }
        return input;
    }


    /**
    * Serializes the URL type identifier
    * @returns {string} Returns 'url' as the type identifier for URL validation
    */
    serialize () { return 'url'; }
}


/**
* @class File
* @description Represents a file type that can handle various input formats for files in the Puter system.
* Accepts and processes multiple file reference formats including:
* - Puter filepaths
* - Filesystem UUIDs
* - URLs
* - Base64 encoded data strings
* Converts these inputs into a FileFacade instance for standardized file handling.
* @extends BaseType
*/
class File extends BaseType {
    static DOC_INPUT_FORMATS = [
        'A puter filepath, like /home/user/file.txt',
        'A puter filesystem UUID, like 12345678-1234-1234-1234-123456789abc',
        'A URL, like https://example.com/file.txt',
        'A base64-encoded string, like data:image/png;base64,iVBORw0K...',
    ]
    static DOC_INTERNAL_TYPE = 'An instance of FileFacade'

    static MODULES = {
        _path: require('path'),
    }


    /**
    * Validates and consolidates file input into a FileFacade instance.
    * Handles multiple input formats including:
    * - Puter filepaths
    * - Filesystem UUIDs 
    * - URLs (web and data URLs)
    * - Existing FileFacade instances
    * Resolves home directory (~) references for authenticated users.
    * 
    * @param {Object} ctx - Context object containing user info
    * @param {string|FileFacade} input - The file input to consolidate
    * @param {Object} options - Options object
    * @param {string} options.arg_name - Name of the argument for error messages
    * @returns {Promise<FileFacade>} A FileFacade instance representing the file
    * @throws {APIError} If input format is invalid
    */
    async consolidate (ctx, input, { arg_name }) {
        if ( input === undefined ) return undefined;

        if ( input instanceof FileFacade ) {
            return input;
        }

        const result = new FileFacade();
        // DRY: Part of this is duplicating FSNodeParam, but FSNodeParam is
        //      subject to change in PR #647, so this should be updated later.

        if ( ! ['/','.','~'].includes(input[0]) ) {
            if ( is_valid_uuid4(input) ) {
                result.set('uid', input);
                return result;
            }

            if ( is_valid_url(input) ) {
                if ( input.startsWith('data:') ) {
                    result.set('data_url', input);
                    return result;
                }
                result.set('web_url', input);
                return result;
            }

        }

        if ( input.startsWith('~') ) {
            const user = ctx.get('user');
            if ( ! user ) {
                throw new Error('Cannot use ~ without a user');
            }
            const homedir = `/${user.username}`;
            input = homedir + input.slice(1);
        }

        if ( ! is_valid_path(input) ) {
            throw APIError.create('field_invalid', null, {
                key: arg_name,
                expected: 'unix-style path or UUID',
            });
        }

        result.set('path', this.modules._path.resolve('/', input));
        return result;
    }


    /**
    * Serializes the File type identifier
    * @returns {string} Returns 'file' as the type identifier for File parameters
    */
    serialize () { return 'file'; }
}


/**
* @class JSONType
* @extends BaseType
* @description Handles JSON data type validation and consolidation. This class validates JSON input
* against specified subtypes (array, object, string, etc) if provided in the argument descriptor.
* It ensures type safety for JSON data structures while allowing null and undefined values when
* appropriate. The class supports optional parameters and performs type checking against the
* specified subtype constraint.
*/
class JSONType extends BaseType {
    /**
    * Validates and processes JSON input values according to specified type constraints
    * @param {Context} ctx - The execution context
    * @param {*} input - The input value to validate and process
    * @param {Object} options - Validation options
    * @param {string} options.arg_descriptor - Descriptor containing subtype constraints
    * @param {string} options.arg_name - Name of the argument being validated
    * @returns {*} The validated input value, or undefined if input is undefined
    * @throws {APIError} If input type doesn't match specified subtype constraint
    */
    async consolidate (ctx, input, { arg_descriptor, arg_name }) {
        if ( input === undefined ) return undefined;

        if ( arg_descriptor.subtype ) {
            const input_json_type =
                Array.isArray(input) ? 'array' :
                input === null ? 'null' :
                typeof input;

            if ( input_json_type === 'null' || input_json_type === 'undefined' ) {
                return input;
            }

            if ( input_json_type !== arg_descriptor.subtype ) {
                throw APIError.create('field_invalid', null, {
                    key: arg_name,
                    expected: `JSON value of type ${arg_descriptor.subtype}`,
                    got: `JSON value of type ${input_json_type}`,
                });
            }
        }
        return input;
    }


    /**
    * Serializes the type identifier for JSON type parameters
    * @returns {string} Returns 'json' as the type identifier
    */
    serialize () { return 'json'; }
}


/**
* @class WebURLString
* @extends BaseType
* @description A class for validating and handling web URL strings. This class extends BaseType
* and is designed to specifically handle and validate web-based URL strings. Currently commented
* out in the codebase, it would provide functionality for ensuring URLs conform to web standards
* and protocols (http/https).
*/
// class WebURLString extends BaseType {
// }

module.exports = {
    file: new File(),
    string: new String(),
    flag: new Flag(),
    json: new JSONType(),
    number: new NumberType(),
    // 'string:url:web': WebURLString,
};
