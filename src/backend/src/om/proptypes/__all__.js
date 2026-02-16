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
const APIError = require('../../api/APIError');
const config = require('../../config');
const { NodeUIDSelector, NodeInternalIDSelector, NodePathSelector } = require('../../filesystem/node/selectors');
const { is_valid_uuid4, is_valid_uuid } = require('../../helpers');
const validator = require('validator');
const { Context } = require('../../util/context');
const { is_valid_path } = require('../../filesystem/validation');
const FSNodeContext = require('../../filesystem/FSNodeContext');
const { Entity } = require('../entitystorage/Entity');
const NULL = Symbol('NULL');
const APP_ICON_ENDPOINT_PATH_REGEX = /^\/app-icon\/[^/?#]+\/\d+\/?$/;
const ABSOLUTE_URL_REGEX = /^[a-zA-Z][a-zA-Z\d+\-.]*:/;

const getCanonicalAppIconBaseUrl = () => {
    const candidate = [config.api_base_url, config.origin]
        .find(value => typeof value === 'string' && value.trim());
    if ( ! candidate ) return null;
    try {
        return (new URL(candidate)).origin;
    } catch {
        return null;
    }
};

const isAppIconEndpointPath = value => {
    if ( typeof value !== 'string' ) return false;
    const trimmed = value.trim();
    if ( ! trimmed ) return false;
    try {
        const pathname = new URL(trimmed, 'http://localhost').pathname;
        return APP_ICON_ENDPOINT_PATH_REGEX.test(pathname);
    } catch {
        return false;
    }
};

const getAllowedAppIconOrigins = () => {
    const origins = new Set();
    for ( const candidate of [config.api_base_url, config.origin] ) {
        if ( typeof candidate !== 'string' || !candidate ) continue;
        try {
            origins.add((new URL(candidate)).origin);
        } catch {
            // Ignore invalid config values.
        }
    }
    return origins;
};

const isAllowedAppIconEndpointUrl = value => {
    if ( ! isAppIconEndpointPath(value) ) return false;

    const trimmed = value.trim();
    const isAbsoluteUrl = ABSOLUTE_URL_REGEX.test(trimmed) || trimmed.startsWith('//');
    if ( ! isAbsoluteUrl ) {
        return true;
    }

    try {
        const parsed = new URL(trimmed, 'http://localhost');
        return getAllowedAppIconOrigins().has(parsed.origin);
    } catch {
        return false;
    }
};

const migrateRelativeAppIconEndpointUrl = value => {
    if ( typeof value !== 'string' ) return value;
    const trimmed = value.trim();
    if ( ! isAppIconEndpointPath(trimmed) ) return value;

    const isAbsoluteUrl = ABSOLUTE_URL_REGEX.test(trimmed) || trimmed.startsWith('//');
    if ( isAbsoluteUrl ) return trimmed;

    const baseUrl = getCanonicalAppIconBaseUrl();
    if ( ! baseUrl ) return trimmed;

    try {
        return new URL(trimmed, `${baseUrl}/`).toString();
    } catch {
        return trimmed;
    }
};

class OMTypeError extends Error {
    constructor ({ expected, got }) {
        const message = `expected ${expected}, got ${got}`;
        super(message);
        this.name = 'OMTypeError';
    }
}

module.exports = {
    base: {
        is_set (value) {
            return !!value;
        },
    },
    json: {
        from: 'base',
    },
    string: {
        is_set (value) {
            return (!!value) || value === null;
        },
        async adapt (value) {
            if ( value === undefined ) return '';

            // SQL stores strings as null. If one-way adapt from db is supported
            // then this should become an sql-to-entity adapt only.
            if ( value === null ) return '';

            if ( value === NULL ) {
                return null;
            }

            if ( typeof value !== 'string' ) {
                throw new OMTypeError({ expected: 'string', got: typeof value });
            }
            return value;
        },
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
            if ( descriptor.hasOwnProperty('regex') && !value.match(descriptor.regex) ) {
                return new Error(`string does not match regex ${descriptor.regex}`);
            }
            return true;
        },
    },
    array: {
        from: 'base',
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
        },
    },
    flag: {
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
        },
    },
    uuid: {
        from: 'string',
        validate (value) {
            return is_valid_uuid4(value);
        },
    },
    ['puter-uuid']: {
        from: 'string',
        validate (value, { descriptor }) {
            const prefix = `${descriptor.prefix }-`;
            if ( ! value.startsWith(prefix) ) {
                return new Error(`UUID does not start with prefix ${prefix}`);
            }
            return is_valid_uuid(value.slice(prefix.length));
        },
        factory ({ descriptor }) {
            const prefix = `${descriptor.prefix }-`;
            const uuid = require('uuid').v4();
            return prefix + uuid;
        },
    },
    ['image-base64']: {
        from: 'string',
        adapt (value) {
            return migrateRelativeAppIconEndpointUrl(value);
        },
        validate (value) {
            if ( value.startsWith('data:image/') ) {
                // XSS characters
                const chars = ['<', '>', '&', '"', "'", '`'];
                if ( chars.some(char => value.includes(char)) ) {
                    return new Error('icon is not an image');
                }
                return true;
            }

            if ( isAllowedAppIconEndpointUrl(value) ) {
                return true;
            }

            return new Error('icon must be base64 encoded or an app-icon endpoint URL');
        },
    },
    url: {
        from: 'string',
        validate (value) {
            let valid = validator.isURL(value);
            if ( ! valid ) {
                valid = validator.isURL(value, { host_whitelist: ['localhost'] });
            }
            return valid;
        },
    },
    reference: {
        from: 'base',
        async sql_reference (value, { descriptor }) {
            if ( ! descriptor.service ) return value;
            if ( ! value ) return null;
            if ( value instanceof Entity ) {
                return value.private_meta.mysql_id;
            }
            return value.id;
        },
        async sql_dereference (value, { descriptor }) {
            if ( ! descriptor.service ) return value;
            if ( ! value ) return null;
            const svc = Context.get().get('services').get(descriptor.service);
            const entity = await svc.read(value);
            return entity;
        },
        async adapt (value, { descriptor }) {
            if ( descriptor.debug ) {
                debugger; // eslint-disable-line no-debugger
            }
            if ( ! descriptor.service ) return value;
            if ( ! value ) return null;
            if ( value instanceof Entity ) return value;
            const svc = Context.get().get('services').get(descriptor.service);
            const entity = await svc.read(value);
            return entity;
        },
    },
    datetime: {
        from: 'base',
    },
    ['puter-node']: {
        // from: 'base',
        async sql_reference (value) {
            if ( value === null ) return null;
            if ( ! (value instanceof FSNodeContext) ) {
                throw new Error('Cannot reference non-FSNodeContext');
            }
            await value.fetchEntry();
            return value.mysql_id ?? null;
        },
        async is_set (value) {
            return ( !!value ) || value === null;
        },
        async sql_dereference (value) {
            if ( value === null ) return null;
            if ( typeof value !== 'number' ) {
                throw new Error(`Cannot dereference non-number: ${value}`);
            }
            const svc_fs = Context.get().get('services').get('filesystem');
            return svc_fs.node(new NodeInternalIDSelector('mysql', value));
        },
        async adapt (value, { name }) {
            if ( value === null ) return null;

            if ( value instanceof FSNodeContext ) {
                return value;
            }
            const ctx = Context.get();

            if ( typeof value !== 'string' ) return;

            let selector;
            if ( ! ['/', '.', '~'].includes(value[0]) ) {
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
        async validate (value, { name, descriptor }) {
            if ( value === null ) return;
            const actor = Context.get('actor');
            const permission = descriptor.fs_permission ?? 'see';

            const svc_acl = Context.get('services').get('acl');
            if ( await value.get('path') === '/' ) {
                return APIError.create('forbidden');
            }
            if ( ! await svc_acl.check(actor, value, permission) ) {
                return await svc_acl.get_safe_acl_error(actor, value, permission);
            }
        },
    },
    NULL,
};
