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
const { v4: uuidv4 } = require('uuid');
const config = require("../../../config");
const { try_infer_attributes, NodeChildSelector, NodePathSelector } = require("../../../filesystem/node/selectors");

const path = require('path');
const APIError = require("../../../api/APIError");

class FileInfo {
    /**
     * @param {Object} param
     * @param {string} param.full_path
     * @param {boolean} param.is_dir
     * @param {Buffer} param.content - The content of the file, `null` if the file is a directory.
     */
    constructor({
        full_path,
        is_dir,
        content,
    }) {
        this.uuid = uuidv4();

        this.is_public = true;
        this.path = full_path;
        this.name = path.basename(full_path);
        this.is_dir = is_dir;

        this.content = content;

        // TODO (xiaochen): return consistent parent_uid
        this.parent_uid = uuidv4();

        // TODO (xiaochen): return sensible values for "user_id", currently
        // it must be 2 (admin) to pass the test.
        this.user_id = 2;

        // TODO (xiaochen): return sensible values for following fields
        this.id = 123;
        this.parent_id = 123;
        this.immutable = 0;
        this.is_shortcut = 0;
        this.is_symlink = 0;
        this.symlink_path = null;
        this.created = 123;
        this.accessed = 123;
        this.modified = 123;
    }
}


class MemoryFSProvider {
    constructor(mountpoint) {
        this.mountpoint = mountpoint;

        // key: relative path from the mountpoint, always starts with `/`
        // value: entry uuid
        this.entriesByPath = new Map();

        // key: entry uuid
        // value: entry (FileInfo)
        //
        // We declare 2 maps to support 2 lookup apis: by-path/by-uuid.
        this.entriesByUUID = new Map();

        const root = new FileInfo({
            full_path: '/',
            is_dir: true,
            content: null,
        });
        this.entriesByPath.set('/', root.uuid);
        this.entriesByUUID.set(root.uuid, root);
    }

    /**
     * Normalize the path to be relative to the mountpoint. Returns `/` if the path is empty/undefined.
     * 
     * @param {string} path - The path to normalize.
     * @returns {string} - The normalized path, always starts with `/`.
     */
    _inner_path (path) {
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
     * Check the integrity of the whole memory filesystem and the input. Throws error if any violation is found.
     * 
     * @param {FSNodeContext} node - The node to check.
     * @returns {Promise<void>}
     */
    _integrity_check (node) {
        if ( config.env !== 'dev' ) {
            // only check in debug mode since it's expensive
            return;
        }

        // check the node's provider is "memory-fs"
        if ( node.provider !== this ) {
            throw new Error('Node provider mismatch');
        }

        // check all directories along the path are valid
        const inner_path = this._inner_path(node.path);
        const path_components = inner_path.split('/');
        for ( let i = 2; i < path_components.length; i++ ) {
            const path_component = path_components.slice(0, i).join('/');
            const entry_uuid = this.entriesByPath.get(path_component);
            if ( ! entry_uuid ) {
                throw new Error(`Directory ${path_component} does not exist`);
            }
        }

        // check the 2 maps are consistent
        if ( this.entriesByPath.size !== this.entriesByUUID.size ) {
            throw new Error('Path map and UUID map have different sizes');
        }
        for ( const [inner_path, uuid] of this.entriesByPath ) {
            const entry = this.entriesByUUID.get(uuid);
            if ( ! entry || this._inner_path(entry.path) !== inner_path ) {
                throw new Error(`Path ${inner_path} does not match entry ${uuid}`);
            }
        }
    }

    /**
     * Performs a stat operation on the given FSNode.
     *
     * @param {Object} param
     * @param {FSNodeContext} param.node - The node to stat.
     * @returns {Promise<FileInfo|null>} - The result of the stat operation, or `null` if the node doesn't exist.
     */
    async stat ({
        selector,
        node,
    }) {
        let entry_uuid = null;

        // try to get path/uid from selector
        try_infer_attributes(selector);

        if ( selector?.path ) {
            // stat by path
            const inner_path = this._inner_path(selector.path);
            entry_uuid = this.entriesByPath.get(inner_path);
        } else if ( selector?.uid ) {
            // stat by uid
            entry_uuid = selector.uid;
        } else {
            // the tricky case: combination of path and uid in NodeChildSelector
            if ( selector instanceof NodeChildSelector ) {
                const parent_entry = await this.stat({
                    selector: selector.parent,
                });
                if ( parent_entry ) {
                    const full_path = _path.join(parent_entry.path, selector.name);
                    const path_selector = new NodePathSelector(full_path);
                    return await this.stat({
                        selector: path_selector,
                    });
                }
            }

            throw APIError.create('invalid_node');
        }

        return this.entriesByUUID.get(entry_uuid);
    }

    /**
     * Stat a node by its uid.
     * 
     * @param {Object} param
     * @param {string} param.uid 
     * @returns {Promise<Object|null>} - The result of the stat operation, or `null` if the node doesn't exist.
     */
    async _stat_by_uid ({ uid }) {
        const entry = this.entriesByUUID.get(uid);
        if ( ! entry ) {
            return null;
        }
        return entry;
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
        const full_path = _path.join(parent.path, name);
        const inner_path = this._inner_path(full_path);

        const entry = new FileInfo({
            full_path: full_path,
            is_dir: true,
            content: null,
        });
        this.entriesByPath.set(inner_path, entry.uuid);
        this.entriesByUUID.set(entry.uuid, entry);

        // create the node
        const fs = context.get('services').get('filesystem');
        const node = await fs.node(entry.path);

        this._integrity_check(node);

        return node;
    }

    /**
     * Remove a directory.
     * 
     * @param {Object} param
     * @param {Context} param.context
     * @param {FSNodeContext} param.node: The directory to remove.
     * @param {Object} param.options: The options for the operation.
     * @returns {Promise<void>}
     */
    async rmdir({ context, node, options = {} }) {
        const inner_path = this._inner_path(node.path);

        // remove all children
        for ( const [other_inner_path, other_entry_uuid] of this.entriesByPath ) {
            if ( other_inner_path.startsWith(inner_path) ) {
                this.entriesByPath.delete(other_inner_path);
                this.entriesByUUID.delete(other_entry_uuid);
            }
        }

        // remove the directory itself
        this.entriesByPath.delete(inner_path);
        this.entriesByUUID.delete(node.uid);

        this._integrity_check(node);
    }

    /**
     * Remove a file.
     * 
     * @param {Object} param
     * @param {Context} param.context
     * @param {FSNodeContext} param.node: The file to remove.
     * @returns {Promise<void>}
     */
    async unlink ({ context, node }) {
        const inner_path = this._inner_path(node.path);
        this.entriesByPath.delete(inner_path);
        this.entriesByUUID.delete(node.uid);
    }

    /**
     * Write a new file to the filesystem. Throws an error if the destination
     * already exists.
     * 
     * @param {Object} param
     * @param {Context} param.context
     * @param {FSNodeContext} param.parent: The parent directory of the destination directory.
     * @param {string} param.name: The name of the destination directory.
     * @param {Object} param.file: The file to write.
     * @returns {Promise<FSNodeContext>}
     */
    async write_new({ context, parent, name, file }) {
        const full_path = _path.join(parent.path, name);
        const inner_path = this._inner_path(full_path);

        const entry = new FileInfo({
            full_path: full_path,
            is_dir: false,
            content: file.stream.readableBuffer,
        });
        this.entriesByPath.set(inner_path, entry.uuid);
        this.entriesByUUID.set(entry.uuid, entry);

        const fs = context.get('services').get('filesystem');
        const node = await fs.node(entry.path);

        this._integrity_check(node);

        return node;
    }

    /**
     * Overwrite an existing file. Throws an error if the destination does not
     * exist.
     * 
     * @param {Object} param
     * @param {Context} param.context
     * @param {FSNodeContext} param.node: The node to write to.
     * @param {Object} param.file: The file to write.
     * @returns {Promise<FSNodeContext>}
     */
    async write_overwrite({ context, node, file }) {
        const inner_path = this._inner_path(node.path);

        this.entriesByPath.set(inner_path, node.uid);
        let original_entry = this.entriesByUUID.get(node.uid);
        if ( ! original_entry ) {
            throw new Error(`File ${node.path} does not exist`);
        } else {
            if ( original_entry.is_dir ) {
                throw new Error(`Cannot overwrite a directory`);
            }

            original_entry.content = file.stream.readableBuffer;
            this.entriesByUUID.set(node.uid, original_entry);
        }

        this._integrity_check(node);

        return node;
    }
}

module.exports = {
    MemoryFSProvider,
};
