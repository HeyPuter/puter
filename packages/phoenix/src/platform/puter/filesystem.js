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
import { ErrorCodes, PosixError } from '../PosixError.js';

function convertPuterError(e) {
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
    return e;
}

// DRY: Almost the same as node/filesystem.js
function wrapAPIs(apis) {
    for (const method in apis) {
        if (typeof apis[method] !== 'function') {
            continue;
        }
        const original = apis[method];
        apis[method] = async (...args) => {
            try {
                return await original(...args);
            } catch (e) {
                throw convertPuterError(e);
            }
        };
    }
    return apis;
}

export const CreateFilesystemProvider = ({
    puterSDK,
}) => {
    return wrapAPIs({
        capabilities: {
            'readdir.www': true,
        },
        // The interface for Puter SDK is a good interface for any filesystem
        // provider, so we will use that as the basis for the Puter Shell's
        // own filesystem provider interface.
        readdir: puterSDK.fs.readdir.bind(puterSDK.fs),
        stat: puterSDK.fs.stat.bind(puterSDK.fs),
        mkdir: puterSDK.fs.mkdir.bind(puterSDK.fs),
        read: puterSDK.fs.read.bind(puterSDK.fs),
        write: puterSDK.fs.write.bind(puterSDK.fs),
        
        // The `rm` method should fail if the destination is a directory
        rm: async (path, { recursive = false }) => {
            const stat = await puterSDK.fs.stat(path);

            if ( stat.is_dir && ! recursive ) {
                throw PosixError.IsDirectory({ path });
            }

            return await puterSDK.fs.delete(path, { recursive });
        },

        // The Puter SDK does not implement `rmdir`
        rmdir: async (path) => {
            const stat = await puterSDK.fs.stat(path);

            if ( ! stat.is_dir ) {
                throw PosixError.IsNotDirectory({ path });
            }

            return await puterSDK.fs.delete(path, { recursive: false });
        },

        // For move and copy the interface is a compromise between the
        // Puter SDK and node.js's `fs` module. This compromise is
        // effectively the same behaviour provided by the POSIX `mv`
        // command; we accept a new name in newPath (contrary to Puter SDK),
        // and we do not throw an error if the destination is a directory
        // (contrary to node.js's `fs`).
        move: async (oldPath, newPath) => {
            let dst_stat = null;
            try {
                dst_stat = await puterSDK.fs.stat(newPath);
            } catch (e) {
                if ( e.code !== 'subject_does_not_exist' ) throw e;
            }

            // In the Puter SDK, the destination specified is always
            // the parent directory to move the source under.

            let new_name = undefined;
            if ( ! dst_stat ) {
                // take last part of destination path and use it as the new name
                const parts = newPath.split('/');
                new_name = parts[parts.length - 1];

                // remove new name from destination path
                parts.pop();
                newPath = parts.join('/');
            }

            return await puterSDK.fs.move(oldPath, newPath, {
                ...(new_name ? { newName: new_name } : {}),
            });
        },
        copy: async (oldPath, newPath) => {
            let dst_stat = null;
            try {
                dst_stat = await puterSDK.fs.stat(newPath);
            } catch (e) {
                if ( e.code !== 'subject_does_not_exist' ) throw e;
            }

            let new_name = undefined;
            if ( ! dst_stat ) {
                // take last part of destination path and use it as the copy's name
                const parts = newPath.split('/');
                new_name = parts[parts.length - 1];

                // remove new name from destination path
                parts.pop();
                newPath = parts.join('/');
            }

            return await puterSDK.fs.copy(oldPath, newPath, {
                ...(new_name ? { newName: new_name } : {}),
            });
        },
    });
};
