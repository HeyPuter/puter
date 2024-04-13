/*
 * Copyright (C) 2024  Puter Technologies Inc.
 *
 * This file is part of Phoenix Shell.
 *
 * Phoenix Shell is free software: you can redistribute it and/or modify
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
export const ErrorCodes = {
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
};

// Codes taken from `errno` on Linux.
export const ErrorMetadata = new Map([
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
]);

export const errorFromIntegerCode = (code) => {
    for (const [errorCode, metadata] of ErrorMetadata) {
        if (metadata.code === code) {
            return errorCode;
        }
    }
    return undefined;
};

export class PosixError extends Error {
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
