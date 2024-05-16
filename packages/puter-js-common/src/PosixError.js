/*
 * Copyright (C) 2024  Puter Technologies Inc.
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
const ErrorCodes = {
    EACCES: Symbol.for('EACCES'),
    EADDRINUSE: Symbol.for('EADDRINUSE'),
    ECONNREFUSED: Symbol.for('ECONNREFUSED'),
    ECONNRESET: Symbol.for('ECONNRESET'),
    EEXIST: Symbol.for('EEXIST'),
    EFBIG: Symbol.for('EFBIG'),
    EINVAL: Symbol.for('EINVAL'),
    EIO: Symbol.for('EIO'),
    EISDIR: Symbol.for('EISDIR'),
    EMFILE: Symbol.for('EMFILE'),
    ENOENT: Symbol.for('ENOENT'),
    ENOSPC: Symbol.for('ENOSPC'),
    ENOTDIR: Symbol.for('ENOTDIR'),
    ENOTEMPTY: Symbol.for('ENOTEMPTY'),
    EPERM: Symbol.for('EPERM'),
    EPIPE: Symbol.for('EPIPE'),
    ETIMEDOUT: Symbol.for('ETIMEDOUT'),

    // For when we need to convert errors that we don't recognise
    EUNKNOWN: Symbol.for('EUNKNOWN'),
};

// Codes taken from `errno` on Linux.
const ErrorMetadata = new Map([
    [ErrorCodes.EPERM, { code: 1, description: 'Operation not permitted' }],
    [ErrorCodes.ENOENT, { code: 2, description: 'File or directory not found' }],
    [ErrorCodes.EIO, { code: 5, description: 'IO error' }],
    [ErrorCodes.EACCES, { code: 13, description: 'Permission denied' }],
    [ErrorCodes.EEXIST, { code: 17, description: 'File already exists' }],
    [ErrorCodes.ENOTDIR, { code: 20, description: 'Is not a directory' }],
    [ErrorCodes.EISDIR, { code: 21, description: 'Is a directory' }],
    [ErrorCodes.EINVAL, { code: 22, description: 'Argument invalid' }],
    [ErrorCodes.EMFILE, { code: 24, description: 'Too many open files' }],
    [ErrorCodes.EFBIG, { code: 27, description: 'File too big' }],
    [ErrorCodes.ENOSPC, { code: 28, description: 'Device out of space' }],
    [ErrorCodes.EPIPE, { code: 32, description: 'Pipe broken' }],
    [ErrorCodes.ENOTEMPTY, { code: 39, description: 'Directory is not empty' }],
    [ErrorCodes.EADDRINUSE, { code: 98, description: 'Address already in use' }],
    [ErrorCodes.ECONNRESET, { code: 104, description: 'Connection reset'}],
    [ErrorCodes.ETIMEDOUT, { code: 110, description: 'Connection timed out' }],
    [ErrorCodes.ECONNREFUSED, { code: 111, description: 'Connection refused' }],

    [ErrorCodes.EUNKNOWN, { code: -1, description: 'Unknown error' }],
]);

const errorFromIntegerCode = (code) => {
    for (const [errorCode, metadata] of ErrorMetadata) {
        if (metadata.code === code) {
            return errorCode;
        }
    }
    return undefined;
};

class PosixError extends Error {
    // posixErrorCode can be either a string, or one of the ErrorCodes above.
    // If message is undefined, a default message will be used.
    constructor(posixErrorCode, message) {
        let posixCode;
        if (typeof posixErrorCode === 'symbol') {
            if (ErrorCodes[Symbol.keyFor(posixErrorCode)] !== posixErrorCode) {
                throw new Error(`Unrecognized POSIX error code: '${posixErrorCode}'`);
            }
            posixCode = posixErrorCode;
        } else {
            const code = ErrorCodes[posixErrorCode];
            if (!code) throw new Error(`Unrecognized POSIX error code: '${posixErrorCode}'`);
            posixCode = code;
        }

        super(message ?? ErrorMetadata.get(posixCode).description);
        this.posixCode = posixCode;
        this.code = posixCode.description;
    }

    static fromNodeJSError(e) {
        switch (e.code) {
            case 'EACCES': return new PosixError(ErrorCodes.EACCES, e.message);
            case 'EADDRINUSE': return new PosixError(ErrorCodes.EADDRINUSE, e.message);
            case 'ECONNREFUSED': return new PosixError(ErrorCodes.ECONNREFUSED, e.message);
            case 'ECONNRESET': return new PosixError(ErrorCodes.ECONNRESET, e.message);
            case 'EEXIST': return new PosixError(ErrorCodes.EEXIST, e.message);
            case 'EIO': return new PosixError(ErrorCodes.EIO, e.message);
            case 'EISDIR': return new PosixError(ErrorCodes.EISDIR, e.message);
            case 'EMFILE': return new PosixError(ErrorCodes.EMFILE, e.message);
            case 'ENOENT': return new PosixError(ErrorCodes.ENOENT, e.message);
            case 'ENOTDIR': return new PosixError(ErrorCodes.ENOTDIR, e.message);
            case 'ENOTEMPTY': return new PosixError(ErrorCodes.ENOTEMPTY, e.message);
            // ENOTFOUND is Node-specific. ECONNREFUSED is similar enough.
            case 'ENOTFOUND': return new PosixError(ErrorCodes.ECONNREFUSED, e.message);
            case 'EPERM': return new PosixError(ErrorCodes.EPERM, e.message);
            case 'EPIPE': return new PosixError(ErrorCodes.EPIPE, e.message);
            case 'ETIMEDOUT': return new PosixError(ErrorCodes.ETIMEDOUT, e.message);
        }
        // Some other kind of error
        return new PosixError(ErrorCodes.EUNKNOWN, e.message);
    }

    static fromPuterAPIError(e) {
        // Handle Puter SDK errors
        switch (e.code) {
            case 'item_with_same_name_exists': return new PosixError(ErrorCodes.EEXIST, e.message);
            case 'cannot_move_item_into_itself': return new PosixError(ErrorCodes.EPERM, e.message);
            case 'cannot_copy_item_into_itself': return new PosixError(ErrorCodes.EPERM, e.message);
            case 'cannot_move_to_root': return new PosixError(ErrorCodes.EACCES, e.message);
            case 'cannot_copy_to_root': return new PosixError(ErrorCodes.EACCES, e.message);
            case 'cannot_write_to_root': return new PosixError(ErrorCodes.EACCES, e.message);
            case 'cannot_overwrite_a_directory': return new PosixError(ErrorCodes.EPERM, e.message);
            case 'cannot_read_a_directory': return new PosixError(ErrorCodes.EISDIR, e.message);
            case 'source_and_dest_are_the_same': return new PosixError(ErrorCodes.EPERM, e.message);
            case 'dest_is_not_a_directory': return new PosixError(ErrorCodes.ENOTDIR, e.message);
            case 'dest_does_not_exist': return new PosixError(ErrorCodes.ENOENT, e.message);
            case 'source_does_not_exist': return new PosixError(ErrorCodes.ENOENT, e.message);
            case 'subject_does_not_exist': return new PosixError(ErrorCodes.ENOENT, e.message);
            case 'shortcut_target_not_found': return new PosixError(ErrorCodes.ENOENT, e.message);
            case 'shortcut_target_is_a_directory': return new PosixError(ErrorCodes.EISDIR, e.message);
            case 'shortcut_target_is_a_file': return new PosixError(ErrorCodes.ENOTDIR, e.message);
            case 'forbidden': return new PosixError(ErrorCodes.EPERM, e.message);
            case 'immutable': return new PosixError(ErrorCodes.EACCES, e.message);
            case 'field_empty': return new PosixError(ErrorCodes.EINVAL, e.message);
            case 'field_missing': return new PosixError(ErrorCodes.EINVAL, e.message);
            case 'xor_field_missing': return new PosixError(ErrorCodes.EINVAL, e.message);
            case 'field_only_valid_with_other_field': return new PosixError(ErrorCodes.EINVAL, e.message);
            case 'invalid_id': return new PosixError(ErrorCodes.EINVAL, e.message);
            case 'field_invalid': return new PosixError(ErrorCodes.EINVAL, e.message);
            case 'field_immutable': return new PosixError(ErrorCodes.EINVAL, e.message);
            case 'field_too_long': return new PosixError(ErrorCodes.EINVAL, e.message);
            case 'field_too_short': return new PosixError(ErrorCodes.EINVAL, e.message);
            case 'already_in_use': return new PosixError(ErrorCodes.EINVAL, e.message); // Not sure what this one is
            case 'invalid_file_name': return new PosixError(ErrorCodes.EINVAL, e.message);
            case 'storage_limit_reached': return new PosixError(ErrorCodes.ENOSPC, e.message);
            case 'internal_error': return new PosixError(ErrorCodes.ECONNRESET, e.message); // This isn't quite right
            case 'response_timeout': return new PosixError(ErrorCodes.ETIMEDOUT, e.message);
            case 'file_too_large': return new PosixError(ErrorCodes.EFBIG, e.message);
            case 'thumbnail_too_large': return new PosixError(ErrorCodes.EFBIG, e.message);
            case 'upload_failed': return new PosixError(ErrorCodes.ECONNRESET, e.message); // This isn't quite right
            case 'missing_expected_metadata': return new PosixError(ErrorCodes.EINVAL, e.message);
            case 'overwrite_and_dedupe_exclusive': return new PosixError(ErrorCodes.EINVAL, e.message);
            case 'not_empty': return new PosixError(ErrorCodes.ENOTEMPTY, e.message);

            // Write
            case 'offset_without_existing_file': return new PosixError(ErrorCodes.ENOENT, e.message);
            case 'offset_requires_overwrite': return new PosixError(ErrorCodes.EINVAL, e.message);
            case 'offset_requires_stream': return new PosixError(ErrorCodes.EPERM, e.message);

            // Batch
            case 'batch_too_many_files': return new PosixError(ErrorCodes.EINVAL, e.message);
            case 'batch_missing_file': return new PosixError(ErrorCodes.EINVAL, e.message);

            // TODO: Associate more of these with posix error codes

            // Open
            case 'no_suitable_app': break;
            case 'app_does_not_exist': break;

            // Apps
            case 'app_name_already_in_use': break;

            // Subdomains
            case 'subdomain_limit_reached': break;
            case 'subdomain_reserved': break;

            // Users
            case 'email_already_in_use': break;
            case 'username_already_in_use': break;
            case 'too_many_username_changes': break;
            case 'token_invalid': break;

            // drivers
            case 'interface_not_found': break;
            case 'no_implementation_available': break;
            case 'method_not_found': break;
            case 'missing_required_argument': break;
            case 'argument_consolidation_failed': break;

            // SLA
            case 'rate_limit_exceeded': break;
            case 'monthly_limit_exceeded': break;
            case 'server_rate_exceeded': break;

            // auth
            case 'token_missing': break;
            case 'token_auth_failed': break;
            case 'token_unsupported': break;
            case 'account_suspended': break;
            case 'permission_denied': break;
            case 'access_token_empty_permissions': break;

            // Object Mapping
            case 'field_not_allowed_for_create': break;
            case 'field_required_for_update': break;
            case 'entity_not_found': break;

            // Chat
            case 'max_tokens_exceeded': break;
        }
        // Some other kind of error
        return new PosixError(ErrorCodes.EUNKNOWN, e.message);
    }

    //
    // Helpers for constructing a PosixError when you don't already have an error message.
    //
    static AccessNotPermitted({ message, path } = {}) {
        return new PosixError(ErrorCodes.EACCES, message ?? (path ? `Access not permitted to: '${path}'` : undefined));
    }
    static AddressInUse({ message, address } = {}) {
        return new PosixError(ErrorCodes.EADDRINUSE, message ?? (address ? `Address '${address}' in use` : undefined));
    }
    static ConnectionRefused({ message } = {}) {
        return new PosixError(ErrorCodes.ECONNREFUSED, message);
    }
    static ConnectionReset({ message } = {}) {
        return new PosixError(ErrorCodes.ECONNRESET, message);
    }
    static PathAlreadyExists({ message, path } = {}) {
        return new PosixError(ErrorCodes.EEXIST, message ?? (path ? `Path already exists: '${path}'` : undefined));
    }
    static FileTooLarge({ message } = {}) {
        return new PosixError(ErrorCodes.EFBIG, message);
    }
    static InvalidArgument({ message } = {}) {
        return new PosixError(ErrorCodes.EINVAL, message);
    }
    static IO({ message } = {}) {
        return new PosixError(ErrorCodes.EIO, message);
    }
    static IsDirectory({ message, path } = {}) {
        return new PosixError(ErrorCodes.EISDIR, message ?? (path ? `Path is directory: '${path}'` : undefined));
    }
    static TooManyOpenFiles({ message } = {}) {
        return new PosixError(ErrorCodes.EMFILE, message);
    }
    static DoesNotExist({ message, path } = {}) {
        return new PosixError(ErrorCodes.ENOENT, message ?? (path ? `Path not found: '${path}'` : undefined));
    }
    static NotEnoughSpace({ message } = {}) {
        return new PosixError(ErrorCodes.ENOSPC, message);
    }
    static IsNotDirectory({ message, path } = {}) {
        return new PosixError(ErrorCodes.ENOTDIR, message ?? (path ? `Path is not a directory: '${path}'` : undefined));
    }
    static DirectoryIsNotEmpty({ message, path } = {}) {
        return new PosixError(ErrorCodes.ENOTEMPTY,  message ?? (path ?`Directory is not empty: '${path}'` : undefined));
    }
    static OperationNotPermitted({ message } = {}) {
        return new PosixError(ErrorCodes.EPERM, message);
    }
    static BrokenPipe({ message } = {}) {
        return new PosixError(ErrorCodes.EPIPE, message);
    }
    static TimedOut({ message } = {}) {
        return new PosixError(ErrorCodes.ETIMEDOUT, message);
    }
}

module.exports = {
    ErrorCodes,
    ErrorMetadata,
    errorFromIntegerCode,
    PosixError,
}
