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
import fs from 'fs';
import path_ from 'path';

import modeString from 'fs-mode-to-string';
import { ErrorCodes, PosixError } from '@heyputer/putility/src/PosixError.js';

// DRY: Almost the same as puter/filesystem.js
function wrapAPIs (apis) {
    for ( const method in apis ) {
        if ( typeof apis[method] !== 'function' ) {
            continue;
        }
        const original = apis[method];
        apis[method] = async (...args) => {
            try {
                return await original(...args);
            } catch (e) {
                throw PosixError.fromNodeJSError(e);
            }
        };
    }
    return apis;
}

export const CreateFilesystemProvider = () => {
    return wrapAPIs({
        capabilities: {
            'readdir.posix-mode': true,
        },
        readdir: async (path) => {
            const names = await fs.promises.readdir(path);

            const items = [];

            const users = {};
            const groups = {};

            for ( const name of names ) {
                const filePath = path_.join(path, name);
                const stat = await fs.promises.lstat(filePath);

                items.push({
                    name,
                    is_dir: stat.isDirectory(),
                    is_symlink: stat.isSymbolicLink(),
                    symlink_path: stat.isSymbolicLink() ? await fs.promises.readlink(filePath) : null,
                    size: stat.size,
                    modified: stat.mtimeMs / 1000,
                    created: stat.ctimeMs / 1000,
                    accessed: stat.atimeMs / 1000,
                    mode: stat.mode,
                    mode_human_readable: modeString(stat.mode),
                    uid: stat.uid,
                    gid: stat.gid,
                });
            }

            return items;
        },
        stat: async (path) => {
            const stat = await fs.promises.lstat(path);
            const fullPath = await fs.promises.realpath(path);
            const parsedPath = path_.parse(fullPath);
            // TODO: Fill in more of these?
            return {
                id: stat.ino,
                associated_app_id: null,
                public_token: null,
                file_request_token: null,
                uid: stat.uid,
                parent_id: null,
                parent_uid: null,
                is_dir: stat.isDirectory(),
                is_public: null,
                is_shortcut: null,
                is_symlink: stat.isSymbolicLink(),
                symlink_path: stat.isSymbolicLink() ? await fs.promises.readlink(path) : null,
                sort_by: null,
                sort_order: null,
                immutable: null,
                name: parsedPath.base,
                path: fullPath,
                dirname: parsedPath.dir,
                dirpath: parsedPath.dir,
                metadata: null,
                modified: stat.mtime,
                created: stat.birthtime,
                accessed: stat.atime,
                size: stat.size,
                layout: null,
                owner: null,
                type: null,
                is_empty: await (async (stat) => {
                    if ( ! stat.isDirectory() )
                    {
                        return null;
                    }
                    const children = await fs.promises.readdir(path);
                    return children.length === 0;
                })(stat),
            };
        },
        mkdir: async (path, options = { createMissingParents: false }) => {
            const createMissingParents = options['createMissingParents'] || false;
            return await fs.promises.mkdir(path, { recursive: createMissingParents });
        },
        read: async (path) => {
            return await fs.promises.readFile(path);
        },
        write: async (path, data) => {
            if ( data instanceof Blob ) {
                return await fs.promises.writeFile(path, data.stream());
            }
            return await fs.promises.writeFile(path, data);
        },
        rm: async (path, options = { recursive: false }) => {
            const recursive = options['recursive'] || false;
            const stat = await fs.promises.stat(path);

            if ( stat.isDirectory() && !recursive ) {
                throw PosixError.IsDirectory({ path });
            }

            return await fs.promises.rm(path, { recursive });
        },
        rmdir: async (path) => {
            const stat = await fs.promises.stat(path);

            if ( ! stat.isDirectory() ) {
                throw PosixError.IsNotDirectory({ path });
            }

            return await fs.promises.rmdir(path);
        },
        move: async (oldPath, newPath) => {
            let destStat = null;
            try {
                destStat = await fs.promises.stat(newPath);
            } catch (e) {
                if ( e.code !== 'ENOENT' ) throw e;
            }

            // fs.promises.rename() expects the new path to include the filename.
            // So, if newPath is a directory, append the old filename to it to produce the target path and name.
            if ( destStat && destStat.isDirectory() ) {
                if ( ! newPath.endsWith('/') ) newPath += '/';
                newPath += path_.basename(oldPath);
            }

            return await fs.promises.rename(oldPath, newPath);
        },
        copy: async (oldPath, newPath) => {
            const srcStat = await fs.promises.stat(oldPath);
            const srcIsDir = srcStat.isDirectory();

            let destStat = null;
            try {
                destStat = await fs.promises.stat(newPath);
            } catch (e) {
                if ( e.code !== 'ENOENT' ) throw e;
            }
            const destIsDir = destStat && destStat.isDirectory();

            // fs.promises.cp() is experimental, but does everything we want. Maybe implement this manually if needed.

            // `dir -> file`: invalid
            if ( srcIsDir && destStat && !destStat.isDirectory() ) {
                throw new PosixError(ErrorCodes.ENOTDIR, 'Cannot copy a directory into a file');
            }

            // `file -> dir`: fs.promises.cp() expects the new path to include the filename.
            if ( !srcIsDir && destIsDir ) {
                if ( ! newPath.endsWith('/') ) newPath += '/';
                newPath += path_.basename(oldPath);
            }

            return await fs.promises.cp(oldPath, newPath, { recursive: srcIsDir });
        },
    });
};
