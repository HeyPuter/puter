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
import { PosixError } from '@heyputer/putility/src/PosixError.js';

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
                throw PosixError.fromPuterAPIError(e);
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
