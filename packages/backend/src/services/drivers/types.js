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
const { is_valid_path } = require("../../filesystem/validation");
const { is_valid_url, is_valid_uuid4 } = require("../../helpers");
const { FileFacade } = require("./FileFacade");
const APIError = require("../../api/APIError");

class BaseType extends AdvancedBase {}

class String extends BaseType {
    async consolidate (ctx, input) {
        // undefined means the optional parameter was not provided,
        // which is different from an empty string.
        return (
            input === undefined ||
            input === null
        ) ? undefined : '' + input;
    }

    serialize () { return 'string'; }
}

class Flag extends BaseType {
    async consolidate (ctx, input) {
        return !! input;
    }

    serialize () { return 'flag'; }
}

class NumberType extends BaseType {
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

    serialize () { return 'number'; }
}

class URL extends BaseType {
    async consolidate (ctx, input, { arg_name }) {
        if ( ! is_valid_url(input) ) {
            throw APIError.create('field_invalid', null, {
                key: arg_name,
                expected: 'URL',
            });
        }
        return input;
    }

    serialize () { return 'url'; }
}

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

    async consolidate (ctx, input, { arg_name }) {
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

    serialize () { return 'file'; }
}

class JSONType extends BaseType {
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

    serialize () { return 'json'; }
}

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
