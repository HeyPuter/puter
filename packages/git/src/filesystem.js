/*
 * Copyright (C) 2024  Puter Technologies Inc.
 *
 * This file is part of Puter's Git client.
 *
 * Puter's Git client is free software: you can redistribute it and/or modify
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
import { PosixError } from '@heyputer/puter-js-common/src/PosixError.js';
import path_ from 'path-browserify';

let debug = false;

// Takes a Puter stat() result and converts it to the format expected by isomorphic-git
const convert_stat = (stat, options) => {
    // Puter returns the times as timestamps in seconds
    const timestamp_date = (timestamp) => new Date(timestamp * 1000);
    const timestamp_ms = (timestamp) => options.bigint ? BigInt(timestamp) * 1000n : timestamp * 1000;
    const timestamp_ns = (timestamp) => options.bigint ? BigInt(timestamp) * 1000000n : undefined;

    // We don't record ctime, but the most recent of atime and mtime is a reasonable approximation
    const ctime = Math.max(stat.accessed, stat.modified);

    const mode = (() => {
        // Puter doesn't expose this, but we can approximate it based on the stats we have.
        let user = stat.immutable ? 4 : 6;
        let group = stat.immutable ? 4 : 6;
        let other = stat.is_public ? 4 : 0;
        // Octal number
        return user << 6 | group << 3 | other;
    })();

    return {
        dev: 1, // Puter doesn't expose this
        ino: stat.id,
        mode: mode,
        nlink: 1, // Definition of hard-link number is platform-defined. Linux includes subdir count, Mac includes child count.
        uid: stat.uid,
        gid: stat.uid, // Puter doesn't have gids
        rdev: 0,
        size: stat.size,
        blksize: 4096, // Abitrary!
        blocks: Math.ceil(stat.size / 4096),
        atime: timestamp_date(stat.accessed),
        mtime: timestamp_date(stat.modified),
        ctime: timestamp_date(ctime),
        birthtime: timestamp_date(stat.created),
        atimeMs: timestamp_ms(stat.accessed),
        mtimeMs: timestamp_ms(stat.modified),
        ctimeMs: timestamp_ms(ctime),
        birthtimeMs: timestamp_ms(stat.created),
        atimeNs: timestamp_ns(stat.accessed),
        mtimeNs: timestamp_ns(stat.modified),
        ctimeNs: timestamp_ns(ctime),
        birthtimeNs: timestamp_ns(stat.created),

        isBlockDevice: () => false,
        isCharacterDevice: () => false,
        isDirectory: () => stat.is_dir,
        isFIFO: () => false,
        isFile: () => !stat.is_dir,
        isSocket: () => false,
        isSymbolicLink: () => stat.is_symlink,
    };
};

const adapt_path = (input_path) => {
    if (input_path[0] === '/') return input_path;
    return path_.relative(window.process.cwd(), input_path);
};

// Implements the API expected by isomorphic-git
// See: https://isomorphic-git.org/docs/en/fs#using-the-promise-api-preferred
export default {
    enable_debugging: () => { debug = true; },
    promises: {
        readFile: async (path, options = {}) => {
            if (debug) console.trace('readFile', path, options);
            // TODO: Obey options
            try {
                const blob = await puter.fs.read(adapt_path(path));
                if (options.encoding === 'utf8')
                    return await blob.text();
                return blob.arrayBuffer();
            } catch (e) {
                throw PosixError.fromPuterAPIError(e);
            }
        },
        writeFile: async (path, data, options = {}) => {
            if (debug) console.trace('writeFile', path, data, options);
            // TODO: Obey options

            // Convert data into a type puter.fs.write() understands.
            // Can be: <string> | <Buffer> | <TypedArray> | <DataView>
            // Puter supports: <string> | <File> | <Blob>
            if (
                data instanceof window.Buffer // Buffer
                || ArrayBuffer.isView(data)   // TypedArray
                || data instanceof DataView   // DataView
            ) {
                data = new File([data], path_.basename(path));
            }

            try {
                return await puter.fs.write(adapt_path(path), data);
            } catch (e) {
                throw PosixError.fromPuterAPIError(e);
            }
        },
        unlink: async (path) => {
            if (debug) console.trace('unlink', path);
            // TODO: If `path` is a symlink, only remove the link
            try {
                return await puter.fs.delete(adapt_path(path), { recursive: false });
            } catch (e) {
                throw PosixError.fromPuterAPIError(e);
            }
        },
        readdir: async (path, options = {}) => {
            if (debug) console.trace('readdir', path, options);
            // TODO: Obey options
            try {
                const results = await puter.fs.readdir(adapt_path(path));
                // Puter returns an array of stat entries, but we only want the file names
                return results.map(it => path_.basename(it.path));
            } catch (e) {
                throw PosixError.fromPuterAPIError(e);
            }
        },
        mkdir: async (path, mode) => {
            if (debug) console.trace('mkdir', path, mode);
            // NOTE: Puter filesystem doesn't have file permissions
            try {
                return await puter.fs.mkdir(adapt_path(path));
            } catch (e) {
                throw PosixError.fromPuterAPIError(e);
            }
        },
        rmdir: async (path) => {
            if (debug) console.trace('rmdir', path);
            // TODO: Only delete dir if it's empty
            try {
                return await puter.fs.delete(adapt_path(path), { recursive: true });
            } catch (e) {
                throw PosixError.fromPuterAPIError(e);
            }
        },
        stat: async (path, options = {}) => {
            if (debug) console.trace('stat', path, options);
            // TODO: Obey options
            try {
                return convert_stat(await puter.fs.stat(adapt_path(path)), options);
            } catch (e) {
                throw PosixError.fromPuterAPIError(e);
            }
        },
        lstat: async (path, options = {}) => {
            if (debug) console.trace('lstat', path, options);
            // TODO: Obey options
            // TODO: Stat the link itself.
            try {
                return convert_stat(await puter.fs.stat(adapt_path(path)), options);
            } catch (e) {
                throw PosixError.fromPuterAPIError(e);
            }
        },
        readlink: async (path, options = {}) => {
            if (debug) console.trace('readlink', path, options);
            try {
                const stat = await puter.fs.stat(adapt_path(path));
                return stat.symlink_path;
            } catch (e) {
                throw PosixError.fromPuterAPIError(e);
            }
        },
        symlink: async (target, path, type) => {
            if (debug) console.trace('symlink', target, path, type);
            // TODO: Add symlink creation to puter.fs API
            throw PosixError.OperationNotPermitted({ message: 'Puter.fs API does not support creating symlinks' });
        },
        chmod: async (path, mode) => {
            if (debug) console.trace('chmod', path, mode);
            // NOTE: No-op, Puter doesn't have file permissions
        },
    },
};