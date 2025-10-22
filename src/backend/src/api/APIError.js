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
const { URLSearchParams } = require('node:url');
const { quot } = require('@heyputer/putility').libs.string;

/**
 * APIError represents an error that can be sent to the client.
 * @class APIError
 * @property {number} status the HTTP status code
 * @property {string} message the error message
 * @property {object} source the source of the error
 */
module.exports = class APIError {
    static codes = {
        // General
        'unknown_error': {
            status: 500,
            message: () => 'An unknown error occurred',
        },
        'format_error': {
            status: 400,
            message: ({ message }) => `format error: ${message}`,
        },
        'temp_error': {
            status: 400,
            message: ({ message }) => `error: ${message}`,
        },
        'disallowed_value': {
            status: 400,
            message: ({ key, allowed }) =>
                `value of ${quot(key)} must be one of: ${
                    allowed.map(v => quot(v)).join(', ')}`,
        },
        'invalid_token': {
            status: 400,
            message: () => 'Invalid token',
        },
        'unrecognized_offering': {
            status: 400,
            message: ({ name }) => {
                return `offering ${quot(name)} was not recognized.`;
            },
        },
        'error_400_from_delegate': {
            status: 400,
            message: ({ delegate, message }) => `Error 400 from delegate ${quot(delegate)}: ${message}`,
        },
        // Things
        'disallowed_thing': {
            status: 400,
            message: ({ thing_type, accepted }) =>
                `Request contained a ${quot(thing_type)} in a ` +
                `place where ${quot(thing_type)} isn't accepted${

                    accepted
                        ? '; ' +
                        `accepted types are: ${
                            accepted.map(v => quot(v)).join(', ')}`
                        : ''}.`,
        },

        // Unorganized
        'item_with_same_name_exists': {
            status: 409,
            message: ({ entry_name }) => entry_name
                ? `An item with name ${quot(entry_name)} already exists.`
                : 'An item with the same name already exists.'
            ,
        },
        'cannot_move_item_into_itself': {
            status: 422,
            message: 'Cannot move an item into itself.',
        },
        'cannot_copy_item_into_itself': {
            status: 422,
            message: 'Cannot copy an item into itself.',
        },
        'cannot_move_to_root': {
            status: 422,
            message: 'Cannot move an item to the root directory.',
        },
        'cannot_copy_to_root': {
            status: 422,
            message: 'Cannot copy an item to the root directory.',
        },
        'cannot_write_to_root': {
            status: 422,
            message: 'Cannot write an item to the root directory.',
        },
        'cannot_overwrite_a_directory': {
            status: 422,
            message: 'Cannot overwrite a directory.',
        },
        'cannot_read_a_directory': {
            status: 422,
            message: 'Cannot read a directory.',
        },
        'source_and_dest_are_the_same': {
            status: 422,
            message: 'Source and destination are the same.',
        },
        'dest_is_not_a_directory': {
            status: 422,
            message: 'Destination must be a directory.',
        },
        'dest_does_not_exist': {
            status: 422,
            message: 'Destination was not found.',
        },
        'source_does_not_exist': {
            status: 404,
            message: 'Source was not found.',
        },
        'subject_does_not_exist': {
            status: 404,
            message: 'File or directory not found.',
        },
        'shortcut_target_not_found': {
            status: 404,
            message: 'Shortcut target not found.',
        },
        'shortcut_target_is_a_directory': {
            status: 422,
            message: 'Shortcut target is a directory; expected a file.',
        },
        'shortcut_target_is_a_file': {
            status: 422,
            message: 'Shortcut target is a file; expected a directory.',
        },
        'forbidden': {
            status: 403,
            message: 'Permission denied.',
        },
        'immutable': {
            status: 403,
            message: 'File is immutable.',
        },
        'field_empty': {
            status: 400,
            message: ({ key }) => `Field ${quot(key)} is required.`,
        },
        'too_many_keys': {
            status: 400,
            message: ({ key }) => `Field ${quot(key)} cannot contain more than 100 elements.`,
        },
        'field_missing': {
            status: 400,
            message: ({ key }) => `Field ${quot(key)} is required.`,
        },
        'xor_field_missing': {
            status: 400,
            message: ({ names }) => {
                let s = 'One of these mutually-exclusive fields is required: ';
                s += names.map(quot).join(', ');
                return s;
            },
        },
        'field_only_valid_with_other_field': {
            status: 400,
            message: ({ key, other_key }) => `Field ${quot(key)} is only valid when field ${quot(other_key)} is specified.`,
        },
        'invalid_id': {
            status: 400,
            message: ({ id }) => {
                return `Invalid id ${id}`;
            },
        },
        'invalid_operation': {
            status: 400,
            message: ({ operation }) => `Invalid operation: ${quot(operation)}.`,
        },
        'field_invalid': {
            status: 400,
            message: ({ key, expected, got }) => {
                return `Field ${quot(key)} is invalid.${
                    expected ? ` Expected ${expected}.` : ''
                }${got ? ` Got ${got}.` : ''}`;
            },
        },
        'field_immutable': {
            status: 400,
            message: ({ key }) => `Field ${quot(key)} is immutable.`,
        },
        'field_too_long': {
            status: 400,
            message: ({ key, max_length }) => `Field ${quot(key)} is too long. Max length is ${max_length}.`,
        },
        'field_too_short': {
            status: 400,
            message: ({ key, min_length }) => `Field ${quot(key)} is too short. Min length is ${min_length}.`,
        },
        'already_in_use': {
            status: 409,
            message: ({ what, value }) => `The ${what} ${quot(value)} is already in use.`,
        },
        'invalid_file_name': {
            status: 400,
            message: ({ name, reason }) => `Invalid file name: ${quot(name)}${reason ? `; ${reason}` : '.'}`,
        },
        'storage_limit_reached': {
            status: 400,
            message: 'Storage capacity limit reached.',
        },
        'internal_error': {
            status: 500,
            message: ({ message }) => message
                ? `An internal error occurred: ${quot(message)}`
                : 'An internal error occurred.',
        },
        'response_timeout': {
            status: 504,
            message: 'Response timed out.',
        },
        'file_too_large': {
            status: 413,
            message: ({ max_size }) => `File too large. Max size is ${max_size} bytes.`,
        },
        'thumbnail_too_large': {
            status: 413,
            message: ({ max_size }) => `Thumbnail too large. Max size is ${max_size} bytes.`,
        },
        'upload_failed': {
            status: 500,
            message: 'Upload failed.',
        },
        'missing_expected_metadata': {
            status: 400,
            message: ({ keys }) => `These fields must come first: ${(keys ?? []).map(quot).join(', ')}.`,
        },
        'overwrite_and_dedupe_exclusive': {
            status: 400,
            message: 'Cannot specify both overwrite and dedupe_name.',
        },
        'not_empty': {
            status: 422,
            message: 'Directory is not empty.',
        },
        'readdir_of_non_directory': {
            status: 422,
            message: 'Readdir target must be a directory.',
        },

        // Write
        'offset_without_existing_file': {
            status: 404,
            message: 'An offset was specified, but the file doesn\'t exist.',
        },
        'offset_requires_overwrite': {
            status: 400,
            message: 'An offset was specified, but overwrite conditions were not met.',
        },
        'offset_requires_stream': {
            status: 400,
            message: 'The offset option for write is not available for this upload.',
        },

        // Batch
        'batch_too_many_files': {
            status: 400,
            message: 'Received an extra file with no corresponding operation.',
        },
        'batch_missing_file': {
            status: 400,
            message: 'Missing fileinfo entry or BLOB for operation.',
        },
        'invalid_file_metadata': {
            status: 400,
            message: 'Invalid file metadata.',
        },
        'unresolved_relative_path': {
            status: 400,
            message: ({ path }) => `Unresolved relative path: ${quot(path)}. ` +
                    "You may need to specify a full path starting with '/'.",
        },

        // Open
        'no_suitable_app': {
            status: 422,
            message: ({ entry_name }) => `No suitable app found for ${quot(entry_name)}.`,
        },
        'app_does_not_exist': {
            status: 422,
            message: ({ identifier }) => `App ${quot(identifier)} does not exist.`,
        },

        // Apps
        'app_name_already_in_use': {
            status: 409,
            message: ({ name }) => `App name ${quot(name)} is already in use.`,
        },

        // Subdomains
        'subdomain_limit_reached': {
            status: 400,
            message: ({ limit, isWorker }) => isWorker ? `You have exceeded the maximum number of workers for your plan! (${limit})` : `You have exceeded the number of subdomains under your current plan (${limit}).`,
        },
        'subdomain_reserved': {
            status: 400,
            message: ({ subdomain }) => `Subdomain ${quot(subdomain)} is not available.`,
        },

        // Users
        'email_already_in_use': {
            status: 409,
            message: ({ email }) => `Email ${quot(email)} is already in use.`,
        },
        'email_not_allowed': {
            status: 400,
            message: ({ email }) => `The email ${quot(email)} is not allowed.`,
        },
        'username_already_in_use': {
            status: 409,

            message: ({ username }) => `Username ${quot(username)} is already in use.`,
        },
        'too_many_username_changes': {
            status: 429,
            message: 'Too many username changes this month.',
        },
        'token_invalid': {
            status: 400,
            message: () => 'Invalid token.',
        },

        // SLA
        'rate_limit_exceeded': {
            status: 429,
            message: ({ method_name, rate_limit }) =>
                `Rate limit exceeded for method ${quot(method_name)}: ${rate_limit.max} requests per ${rate_limit.period}ms.`,
        },
        'server_rate_exceeded': {
            status: 503,
            message: 'System-wide rate limit exceeded. Please try again later.',
        },

        // New cost system
        'insufficient_funds': {
            status: 402,
            message: 'Available funding is insufficient for this request.',
        },

        // auth
        'token_missing': {
            status: 401,
            message: 'Missing authentication token.',
        },
        'unexpected_undefined': {
            status: 401,
            message: msg => msg ?? 'unexpected string undefined',
        },
        'token_auth_failed': {
            status: 401,
            message: 'Authentication failed.',
        },
        'user_not_found': {
            status: 401,
            message: 'User not found.',
        },
        'token_unsupported': {
            status: 401,
            message: 'This authentication token is not supported here.',
        },
        'token_expired': {
            status: 401,
            message: 'Authentication token has expired.',
        },
        'account_suspended': {
            status: 403,
            message: 'Account suspended.',
        },
        'permission_denied': {
            status: 403,
            message: 'Permission denied.',
        },
        'access_token_empty_permissions': {
            status: 403,
            message: 'Attempted to create an access token with no permissions.',
        },
        'invalid_action': {
            status: 400,
            message: ({ action }) => `Invalid action: ${quot(action)}.`,
        },
        '2fa_already_enabled': {
            status: 409,
            message: '2FA is already enabled.',
        },
        '2fa_not_configured': {
            status: 409,
            message: '2FA is not configured.',
        },

        // protected endpoints
        'too_many_requests': {
            status: 429,
            message: 'Too many requests.',
        },
        'user_tokens_only': {
            status: 403,
            message: 'This endpoint must be requested with a user session',
        },
        'temporary_accounts_not_allowed': {
            status: 403,
            message: 'Temporary accounts cannot perform this action',
        },
        'password_required': {
            status: 400,
            message: 'Password is required.',
        },
        'password_mismatch': {
            status: 403,
            message: 'Password does not match.',
        },

        // Object Mapping
        'field_not_allowed_for_create': {
            status: 400,
            message: ({ key }) => `Field ${quot(key)} is not allowed for create.`,
        },
        'field_required_for_update': {
            status: 400,
            message: ({ key }) => `Field ${quot(key)} is required for update.`,
        },
        'entity_not_found': {
            status: 422,
            message: ({ identifier }) => `Entity not found: ${quot(identifier)}`,
        },

        // Share
        'user_does_not_exist': {
            status: 422,
            message: ({ username }) => `The user ${quot(username)} does not exist.`,
        },
        'invalid_username_or_email': {
            status: 400,
            message: ({ value }) =>
                `The value ${quot(value)} is not a valid username or email.`,
        },
        'invalid_path': {
            status: 400,
            message: ({ value }) =>
                `The value ${quot(value)} is not a valid path.`,
        },
        'future': {
            status: 400,
            message: ({ what }) => `Not supported yet: ${what}`,
        },
        // Temporary solution for lack of error composition
        'field_errors': {
            status: 400,
            message: ({ key, errors }) =>
                `The value for ${quot(key)} has the following errors: ${
                    errors.join('; ')}`,
        },
        'share_expired': {
            status: 422,
            message: 'This share is expired.',
        },
        'email_must_be_confirmed': {
            status: 422,
            message: ({ action }) =>
                `Email must be confirmed to ${action ?? 'apply a share'}.`,
        },
        'no_need_to_request': {
            status: 422,
            message: 'This share is already valid for this user; ' +
                'POST to /apply for access.',
        },
        'can_not_apply_to_this_user': {
            status: 422,
            message: 'This share can not be applied to this user.',
        },
        'no_origin_for_app': {
            status: 400,
            message: 'Puter apps must have a valid URL.',
        },
        'anti-csrf-incorrect': {
            status: 400,
            message: 'Incorrect or missing anti-CSRF token.',
        },

        'not_yet_supported': {
            status: 400,
            message: ({ message }) => message,
        },

        // Captcha errors
        'captcha_required': {
            status: 400,
            message: ({ message }) => message || 'Captcha verification required',
        },
        'captcha_invalid': {
            status: 400,
            message: ({ message }) => message || 'Invalid captcha response',
        },

        // TTS Errors
        'invalid_engine': {
            status: 400,
            message: ({ engine, valid_engines }) => `Invalid engine: ${quot(engine)}. Valid engines are: ${valid_engines.map(quot).join(', ')}.`,
        },
        
        // Abuse prevention
        'moderation_failed': {
            status: 422,
            message: `Content moderation failed`,
        },
    };

    /**
     * create() is a factory method for creating APIError instances.
     * It accepts either a string or an Error object as the second
     * argument. If a string is passed, it is used as the error message.
     * If an Error object is passed, its message property is used as the
     * error message. The Error object itself is stored in the source
     * property. If no second argument is passed, the source property
     * is set to null. The first argument is used as the status code.
     *
     * @static
     * @param {number|string} status
     * @param {object} source
     * @param {string|Error|object} fields one of the following:
     * - a string to use as the error message
     * - an Error object to use as the source of the error
     * - an object with a message property to use as the error message
     * @returns
     */
    static create(status, source, fields = {}) {
        // Just the error code
        if ( typeof status === 'string' ) {
            const code = this.codes[status];
            if ( ! code ) {
                return new APIError(500, 'Missing error message.', null, {
                    code: status,
                });
            }
            return new APIError(code.status, status, source, fields);
        }

        // High-level errors like this: APIError.create(400, '...')
        if ( typeof source === 'string' ) {
            return new APIError(status, source, null, fields);
        }

        // Errors from source like this: throw new Error('...')
        if (
            typeof source === 'object' &&
            source instanceof Error
        ) {
            return new APIError(status, source?.message, source, fields);
        }

        // Errors from sources like this: throw { message: '...', ... }
        if (
            typeof source === 'object' &&
            source.constructor.name === 'Object' &&
            Object.prototype.hasOwnProperty.call(source, 'message')
        ) {
            const allfields = { ...source, ...fields };
            return new APIError(status, source.message, source, allfields);
        }

        console.error('Invalid APIError source:', source);
        return new APIError(500, 'Internal Server Error', null, {});
    }
    static adapt(err) {
        if ( err instanceof APIError ) return err;

        return APIError.create('internal_error');
    }
    constructor(status, message, source, fields = {}) {
        this.codes = this.constructor.codes;
        this.status = status;
        this._message = message;
        this.source = source ?? new Error('error for trace');
        this.fields = fields;

        if ( Object.prototype.hasOwnProperty.call(this.codes, message) ) {
            this.fields.code = message;
            this._message = this.codes[message].message;
        }
    }
    write(res) {
        const message = typeof this.message === 'function'
            ? this.message(this.fields)
            : this.message;
        return res.status(this.status).send({
            message,
            ...this.fields,
        });
    }
    serialize() {
        return {
            ...this.fields,
            $: 'heyputer:api/APIError',
            message: this.message,
            status: this.status,
        };
    }

    querystringize(extra) {
        return new URLSearchParams(this.querystringize_(extra));
    }

    querystringize_(extra) {
        const fields = {};
        for ( const k in this.fields ) {
            fields[`field_${k}`] = this.fields[k];
        }
        return {
            ...extra,
            error: true,
            message: this.message,
            status: this.status,
            ...fields,
        };
    }

    get message() {
        const message = typeof this._message === 'function'
            ? this._message(this.fields)
            : this._message;
        return message;
    }

    toString() {
        return `APIError(${this.status}, ${this.message})`;
    }
};
