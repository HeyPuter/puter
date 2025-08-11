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
const APIError = require("../../api/APIError");
const { NodeUIDSelector, NodeInternalIDSelector, NodePathSelector } = require("../../filesystem/node/selectors");
const { is_valid_uuid4, is_valid_uuid } = require("../../helpers");
const validator = require("validator");
const { Context } = require("../../util/context");
const { is_valid_path } = require("../../filesystem/validation");
const FSNodeContext = require("../../filesystem/FSNodeContext");
const { Entity } = require("../entitystorage/Entity");

/**
 * Error class for object mapping type validation failures
 */
class OMTypeError extends Error {
    /**
     * Creates a new OMTypeError instance
     * @param {Object} options - Error options
     * @param {string} options.expected - The expected type
     * @param {string} options.got - The actual type received
     */
    constructor ({ expected, got }) {
        const message = `expected ${expected}, got ${got}`;
        super(message);
        this.name = 'OMTypeError';
    }
}

module.exports = {
    base: {
        /**
         * Checks if a value is set (truthy)
         * @param {*} value - The value to check
         * @returns {boolean} True if value is truthy, false otherwise
         */
        is_set (value) {
            return !! value;
        },
    },
    json: {
        from: 'base',
    },
    string: {
        from: 'base',
        /**
         * Adapts a value to a string type
         * @param {*} value - The value to adapt
         * @returns {Promise<string>} The adapted string value
         * @throws {OMTypeError} When value cannot be converted to string
         */
        async adapt (value) {
            if ( value === undefined ) return '';

            // SQL stores strings as null. If one-way adapt from db is supported
            // then this should become an sql-to-entity adapt only.
            if ( value === null ) return '';

            if ( typeof value !== 'string' ) {
                throw new OMTypeError({ expected: 'string', got: typeof value });
            }
            return value;
        },
        /**
         * Validates a string value against descriptor constraints
         * @param {string} value - The string value to validate
         * @param {Object} options - Validation options
         * @param {string} options.name - The field name
         * @param {Object} options.descriptor - Field descriptor with validation rules
         * @returns {boolean|Error} True if valid, Error object if invalid
         * @throws {APIError} When string length constraints are violated
         */
        validate (value, { name, descriptor }) {
            if ( typeof value !== 'string' ) {
                return new OMTypeError({ expected: 'string', got: typeof value });
            }
            if ( descriptor.hasOwnProperty('maxlen') && value.length > descriptor.maxlen ) {
                throw APIError.create('field_too_long', null, { key: name, max_length: descriptor.maxlen });
            }
            if ( descriptor.hasOwnProperty('minlen') && value.length > descriptor.minlen ) {
                throw APIError.create('field_too_short', null, { key: name, min_length: descriptor.maxlen });
            }
            if ( descriptor.hasOwnProperty('regex') && ! value.match(descriptor.regex) ) {
                return new Error(`string does not match regex ${descriptor.regex}`);
            }
            return true;
        }
    },
    array: {
        from: 'base',
        /**
         * Validates an array value against descriptor constraints
         * @param {Array} value - The array value to validate
         * @param {Object} options - Validation options
         * @param {string} options.name - The field name
         * @param {Object} options.descriptor - Field descriptor with validation rules
         * @returns {boolean|OMTypeError} True if valid, OMTypeError if invalid
         * @throws {APIError} When array length or modulo constraints are violated
         */
        validate (value, { name, descriptor }) {
            if ( ! Array.isArray(value) ) {
                return new OMTypeError({ expected: 'array', got: typeof value });
            }
            if ( descriptor.hasOwnProperty('maxlen') && value.length > descriptor.maxlen ) {
                throw APIError.create('field_too_long', null, { key: name, max_length: descriptor.maxlen });
            }
            if ( descriptor.hasOwnProperty('minlen') && value.length > descriptor.minlen ) {
                throw APIError.create('field_too_short', null, { key: name, min_length: descriptor.maxlen });
            }
            if ( descriptor.hasOwnProperty('mod') && value.length % descriptor.mod !== 0 ) {
                throw APIError.create('field_invalid', null, { key: name, mod: descriptor.mod });
            }
            return true;
        }
    },
    flag: {
        /**
         * Adapts various value types to boolean flags
         * @param {*} value - The value to adapt to boolean
         * @returns {boolean} The adapted boolean value
         * @throws {OMTypeError} When value cannot be converted to boolean
         */
        adapt: value => {
            if ( value === undefined ) return false;
            if ( value === 0 ) value = false;
            if ( value === 1 ) value = true;
            if ( value === '0' ) value = false;
            if ( value === '1' ) value = true;
            if ( typeof value !== 'boolean' ) {
                throw new OMTypeError({ expected: 'boolean', got: typeof value });
            }
            return value;
        }
    },
    uuid: {
        from: 'string',
        /**
         * Validates that a string is a valid UUID v4
         * @param {string} value - The UUID string to validate
         * @returns {boolean} True if valid UUID v4, false otherwise
         */
        validate (value) {
            return is_valid_uuid4(value);
        },
    },
    ['puter-uuid']: {
        from: 'string',
        /**
         * Validates that a string is a valid prefixed UUID
         * @param {string} value - The prefixed UUID string to validate
         * @param {Object} options - Validation options
         * @param {Object} options.descriptor - Field descriptor containing prefix
         * @returns {boolean|Error} True if valid, Error if invalid
         */
        validate (value, { descriptor }) {
            const prefix = descriptor.prefix + '-';
            if ( ! value.startsWith(prefix) ) {
                return new Error(`UUID does not start with prefix ${prefix}`);
            }
            return is_valid_uuid(value.slice(prefix.length));
        },
        /**
         * Creates a new prefixed UUID
         * @param {Object} options - Factory options
         * @param {Object} options.descriptor - Field descriptor containing prefix
         * @returns {string} A new prefixed UUID string
         */
        factory ({ descriptor }) {
            const prefix = descriptor.prefix + '-';
            const uuid = require('uuid').v4();
            return prefix + uuid;
        },
    },
    ['image-base64']: {
        from: 'string',
        /**
         * Validates that a string is a valid base64 encoded image
         * @param {string} value - The base64 image string to validate
         * @returns {boolean|Error} True if valid, Error if invalid
         */
        validate (value) {
            if ( ! value.startsWith('data:image/') ) {
                return new Error('image must be base64 encoded');
            }
            // XSS characters
            const chars = ['<', '>', '&', '"', "'", '`'];
            if ( chars.some(char => value.includes(char)) ) {
                return new Error('icon is not an image');
            }
        }
    },
    url: {
        from: 'string',
        /**
         * Validates that a string is a valid URL
         * @param {string} value - The URL string to validate
         * @returns {boolean} True if valid URL, false otherwise
         */
        validate (value) {
            let valid = validator.isURL(value);
            if ( ! valid ) {
                valid = validator.isURL(value, { host_whitelist: ['localhost'] });
            }
            return valid;
        }
    },
    reference: {
        from: 'base',
        /**
         * Converts an entity reference to its SQL representation
         * @param {*} value - The entity or reference value
         * @param {Object} options - Reference options
         * @param {Object} options.descriptor - Field descriptor
         * @returns {Promise<*>} The SQL reference value or original value
         */
        async sql_reference (value, { descriptor }) {
            if ( ! descriptor.service ) return value;
            if ( ! value ) return null;
            if ( value instanceof Entity ) {
                return value.private_meta.mysql_id;
            }
            return value.id;
        },
        /**
         * Converts a SQL reference back to an entity
         * @param {*} value - The SQL reference value
         * @param {Object} options - Dereference options
         * @param {Object} options.descriptor - Field descriptor
         * @returns {Promise<*>} The dereferenced entity or original value
         */
        async sql_dereference (value, { descriptor }) {
            if ( ! descriptor.service ) return value;
            if ( ! value ) return null;
            const svc = Context.get().get('services').get(descriptor.service);
            const entity = await svc.read(value);
            return entity;
        },
        /**
         * Adapts a value to an entity reference
         * @param {*} value - The value to adapt
         * @param {Object} options - Adaptation options
         * @param {Object} options.descriptor - Field descriptor
         * @returns {Promise<*>} The adapted entity or original value
         */
        async adapt (value, { descriptor }) {
            if ( descriptor.debug ) {
                debugger; // eslint-disable-line no-debugger
            }
            if ( ! descriptor.service ) return value;
            if ( ! value ) return null;
            if ( value instanceof Entity ) return value;
            const svc = Context.get().get('services').get(descriptor.service);
            console.log('VALUE BEING READ', value);
            const entity = await svc.read(value);
            return entity;
        }
    },
    datetime: {
        from: 'base',
    },
    ['puter-node']: {
        // from: 'base',
        /**
         * Converts a filesystem node to its SQL reference
         * @param {FSNodeContext|null} value - The filesystem node context
         * @returns {Promise<number|null>} The MySQL ID or null
         * @throws {Error} When value is not an FSNodeContext
         */
        async sql_reference (value) {
            if ( value === null ) return null;
            if ( ! (value instanceof FSNodeContext) ) {
                throw new Error('Cannot reference non-FSNodeContext');
            }
            await value.fetchEntry();
            return value.mysql_id ?? null;
        },
        /**
         * Checks if a filesystem node value is set
         * @param {*} value - The value to check
         * @returns {Promise<boolean>} True if value is set or explicitly null
         */
        async is_set (value) {
            return ( !! value ) || value === null;
        },
        /**
         * Converts a SQL reference back to a filesystem node
         * @param {number|null} value - The MySQL ID reference
         * @returns {Promise<FSNodeContext|null>} The filesystem node context or null
         * @throws {Error} When value is not a number
         */
        async sql_dereference (value) {
            if ( value === null ) return null;
            if ( typeof value !== 'number' ) {
                throw new Error(
                    `Cannot dereference non-number: ${value}`
                );
            }
            const svc_fs = Context.get().get('services').get('filesystem');
            return svc_fs.node(
                new NodeInternalIDSelector('mysql', value)
            );
        },
        /**
         * Adapts a string path or UUID to a filesystem node context
         * @param {string|FSNodeContext|null} value - The path, UUID, or node context
         * @param {Object} options - Adaptation options
         * @param {string} options.name - The field name
         * @returns {Promise<FSNodeContext|null>} The filesystem node context or null
         * @throws {Error} When user context is missing for ~ paths
         * @throws {APIError} When path is invalid
         */
        async adapt (value, { name }) {
            if ( value === null ) return null;

            if ( value instanceof FSNodeContext ) {
                return value;
            }
            const ctx = Context.get();

            if ( typeof value !== 'string' ) return;

            let selector;
            if ( ! ['/','.','~'].includes(value[0]) ) {
                if ( is_valid_uuid4(value) ) {
                    selector = new NodeUIDSelector(value);
                }
            } else {
                if ( value.startsWith('~') ) {
                    const user = ctx.get('user');
                    if ( ! user ) {
                        throw new Error('Cannot use ~ without a user');
                    }
                    const homedir = `/${user.username}`;
                    value = homedir + value.slice(1);
                }

                if ( ! is_valid_path(value) ) {
                    throw APIError.create('field_invalid', null, {
                        key: name,
                        expected: 'unix-style path or UUID',
                    });
                }

                selector = new NodePathSelector(value);
            }

            const svc_fs = ctx.get('services').get('filesystem');
            const node = await svc_fs.node(selector);
            return node;
        },
        /**
         * Validates filesystem node access permissions
         * @param {FSNodeContext|null} value - The filesystem node to validate
         * @param {Object} options - Validation options
         * @param {string} options.name - The field name
         * @param {Object} options.descriptor - Field descriptor with permission settings
         * @returns {Promise<void|APIError>} Nothing if valid, APIError if access denied
         */
        async validate (value, { name, descriptor }) {
            if ( value === null ) return;
            const actor = Context.get('actor');
            const permission = descriptor.fs_permission ?? 'see';

            console.log('actor??', actor, value, permission);

            const svc_acl = Context.get('services').get('acl');
            if ( await value.get('path') === '/' ) {
                return APIError.create('forbidden');
            }
            if ( ! await svc_acl.check(actor, value, permission) ) {
                return await svc_acl.get_safe_acl_error(actor, value, permission);
            }
        }
    },
};
