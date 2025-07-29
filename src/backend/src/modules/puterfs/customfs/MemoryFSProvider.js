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

const FSNodeContext = require("../../../filesystem/FSNodeContext");
const _path = require('path');
const { Context } = require("../../../util/context");

class MemoryFSProvider {
    constructor(mountpoint) {
        this.mountpoint = mountpoint;

        // key: relative path from the mountpoint, always starts with `/`
        // value: file content
        this.files = new Map();

        // key: relative path from the mountpoint, always starts with `/`
        // value: directory content
        this.directories = new Set();

        // The root directory (of the mountpoint) always exists.
        this.directories.add('/');
    }

    /**
     * Normalize the path to be relative to the mountpoint. Returns `/` if the path is empty/undefined.
     * 
     * @param {string} path - The path to normalize.
     * @returns {string} - The normalized path, always starts with `/`.
     */
    _normalize_path (path) {
        if ( ! path ) {
            return '/';
        }

        if ( path.startsWith(this.mountpoint) ) {
            path = path.slice(this.mountpoint.length);
        }

        if ( ! path.startsWith('/') ) {
            path = '/' + path;
        }

        return path;
    }

    /**
     * Performs a stat operation on the given FSNode.
     *
     * @param {Object} param
     * @param {FSNodeContext} param.node - The node to stat.
     * @returns {Promise<Object|null>} - The result of the stat operation, or `null` if the node doesn't exist.
     *
     * If the result is not null, the returned object includes following fields:
     * - `is_dir` {boolean} — `true` if the node is a directory.
     * - `public` {boolean} — `true` if the node is public (read/write access for everyone).
     * - `user_id` {number} — The ID of the user who owns the node.
     * 
     * (ref: https://github.com/HeyPuter/puter/blob/8e58fabb7156d02c0e396ad26788e25ab0138db8/src/backend/src/services/database/sqlite_setup/0001_create-tables.sql#L70-L99)
     */
    async stat ({
        node,
    }) {
        const inner_path = this._normalize_path(node?.path);

        // for now, assume the path is a dir
        if ( this.directories.has(inner_path) ) {
            const full_path = _path.join(this.mountpoint, inner_path);

            return {
                is_public: true,

                path: full_path,

                name: _path.basename(full_path),

                // TODO (xiaochen): get the user id from database, the `user_id` must be set no
                // matter what.
                user_id: 1,

                is_dir: true,
            };
        }

        return null;
    }

    /**
     * Create a new directory.
     * 
     * @param {Object} param
     * @param {Context} param.context - The context of the operation.
     * @param {FSNodeContext} param.parent - The parent node to create the directory in. Must exist and be a directory.
     * @param {string} param.name - The name of the new directory.
     * @returns {Promise<FSNodeContext>} - The new directory node.
     */
    async mkdir({ context, parent, name }) {
        const inner_path = this._normalize_path(_path.join(parent.path, name));
        const full_path = _path.join(this.mountpoint, inner_path);

        this.directories.add(inner_path);

        // create the node
        const fs = context.get('services').get('filesystem');
        const node = await fs.node(full_path);
        return node;
    }
}

module.exports = {
    MemoryFSProvider,
};
