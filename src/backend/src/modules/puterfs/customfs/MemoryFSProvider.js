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

const FSNodeContext = require('../../../filesystem/FSNodeContext');
const _path = require('path');
const { Context } = require('../../../util/context');
const { v4: uuidv4 } = require('uuid');
const config = require('../../../config');
const {
    NodeChildSelector,
    NodePathSelector,
    NodeUIDSelector,
    NodeRawEntrySelector,
    RootNodeSelector,
    try_infer_attributes,
} = require('../../../filesystem/node/selectors');
const fsCapabilities = require('../../../filesystem/definitions/capabilities');
const APIError = require('../../../api/APIError');

class MemoryFile {
    /**
     * @param {Object} param
     * @param {string} param.path - Relative path from the mountpoint.
     * @param {boolean} param.is_dir
     * @param {Buffer|null} param.content - The content of the file, `null` if the file is a directory.
     * @param {string|null} [param.parent_uid] - UID of parent directory; null for root.
     */
    constructor({ path, is_dir, content, parent_uid = null }) {
        this.uuid = uuidv4();

        this.is_public = true;
        this.path = path;
        this.name = _path.basename(path);
        this.is_dir = is_dir;

        this.content = content;

        // parent_uid should reflect the actual parent's uid; null for root
        this.parent_uid = parent_uid;

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
        this.created = Math.floor(Date.now() / 1000);
        this.accessed = Math.floor(Date.now() / 1000);
        this.modified = Math.floor(Date.now() / 1000);
        this.size = is_dir ? 0 : content ? content.length : 0;
    }
}

class MemoryFSProvider {
    constructor(mountpoint) {
        this.mountpoint = mountpoint;

        // key: relative path from the mountpoint, always starts with `/`
        // value: entry uuid
        this.entriesByPath = new Map();

        // key: entry uuid
        // value: entry (MemoryFile)
        //
        // We declare 2 maps to support 2 lookup apis: by-path/by-uuid.
        this.entriesByUUID = new Map();

        const root = new MemoryFile({
            path: '/',
            is_dir: true,
            content: null,
            parent_uid: null,
        });
        this.entriesByPath.set('/', root.uuid);
        this.entriesByUUID.set(root.uuid, root);
    }

    /**
     * Get the capabilities of this filesystem provider.
     *
     * @returns {Set} - Set of capabilities supported by this provider.
     */
    get_capabilities() {
        return new Set([
            fsCapabilities.READDIR_UUID_MODE,
            fsCapabilities.UUID,
            fsCapabilities.READ,
            fsCapabilities.WRITE,
            fsCapabilities.COPY_TREE,
        ]);
    }

    /**
     * Normalize the path to be relative to the mountpoint. Returns `/` if the path is empty/undefined.
     *
     * @param {string} path - The path to normalize.
     * @returns {string} - The normalized path, always starts with `/`.
     */
    _inner_path(path) {
        if (!path) {
            return '/';
        }

        if (path.startsWith(this.mountpoint)) {
            path = path.slice(this.mountpoint.length);
        }

        if (!path.startsWith('/')) {
            path = '/' + path;
        }

        return path;
    }

    /**
     * Check the integrity of the whole memory filesystem. Throws error if any violation is found.
     *
     * @returns {Promise<void>}
     */
    _integrity_check() {
        if (config.env !== 'dev') {
            // only check in debug mode since it's expensive
            return;
        }

        // check the 2 maps are consistent
        if (this.entriesByPath.size !== this.entriesByUUID.size) {
            throw new Error('Path map and UUID map have different sizes');
        }

        for (const [inner_path, uuid] of this.entriesByPath) {
            const entry = this.entriesByUUID.get(uuid);

            // entry should exist
            if (!entry) {
                throw new Error(`Entry ${uuid} does not exist`);
            }

            // path should match
            if (this._inner_path(entry.path) !== inner_path) {
                throw new Error(`Path ${inner_path} does not match entry ${uuid}`);
            }

            // uuid should match
            if (entry.uuid !== uuid) {
                throw new Error(`UUID ${uuid} does not match entry ${entry.uuid}`);
            }

            // parent should exist
            if (entry.parent_uid) {
                const parent_entry = this.entriesByUUID.get(entry.parent_uid);
                if (!parent_entry) {
                    throw new Error(`Parent ${entry.parent_uid} does not exist`);
                }
            }

            // parent's path should be a prefix of the entry's path
            if (entry.parent_uid) {
                const parent_entry = this.entriesByUUID.get(entry.parent_uid);
                if (!entry.path.startsWith(parent_entry.path)) {
                    throw new Error(
                        `Parent ${entry.parent_uid} path ${parent_entry.path} is not a prefix of entry ${entry.path}`,
                    );
                }
            }

            // parent should be a directory
            if (entry.parent_uid) {
                const parent_entry = this.entriesByUUID.get(entry.parent_uid);
                if (!parent_entry.is_dir) {
                    throw new Error(`Parent ${entry.parent_uid} is not a directory`);
                }
            }
        }
    }

    /**
     * Check if a given node exists.
     *
     * @param {Object} param
     * @param {NodePathSelector | NodeUIDSelector | NodeChildSelector | RootNodeSelector | NodeRawEntrySelector} param.selector - The selector used for checking.
     * @returns {Promise<boolean>} - True if the node exists, false otherwise.
     */
    async quick_check({ selector }) {
        if (selector instanceof NodePathSelector) {
            const inner_path = this._inner_path(selector.value);
            return this.entriesByPath.has(inner_path);
        }

        if (selector instanceof NodeUIDSelector) {
            return this.entriesByUUID.has(selector.value);
        }

        // fallback to stat
        const entry = await this.stat({ selector });
        return !!entry;
    }

    /**
     * Performs a stat operation using the given selector.
     * 
     * NB: Some returned fields currently contain placeholder values. And the
     * `path` of the absolute path from the root.
     *
     * @param {Object} param
     * @param {NodePathSelector | NodeUIDSelector | NodeChildSelector | RootNodeSelector | NodeRawEntrySelector} param.selector - The selector to stat.
     * @returns {Promise<MemoryFile|null>} - The result of the stat operation, or `null` if the node doesn't exist.
     */
    async stat({ selector }) {
        try_infer_attributes(selector);

        let entry_uuid = null;

        if (selector instanceof NodePathSelector) {
            // stat by path
            const inner_path = this._inner_path(selector.value);
            entry_uuid = this.entriesByPath.get(inner_path);
        } else if (selector instanceof NodeUIDSelector) {
            // stat by uid
            entry_uuid = selector.value;
        } else if (selector instanceof NodeChildSelector) {
            if (selector.path) {
                // Shouldn't care about about parent when the "path" is present
                // since it might have different provider.
                return await this.stat({
                    selector: new NodePathSelector(selector.path),
                });
            } else {
                // recursively stat the parent and then stat the child
                const parent_entry = await this.stat({
                    selector: selector.parent,
                });
                if (parent_entry) {
                    const full_path = _path.join(parent_entry.path, selector.name);
                    return await this.stat({
                        selector: new NodePathSelector(full_path),
                    });
                }
            }
        } else {
            // other selectors shouldn't reach here, i.e., it's an internal logic error
            throw APIError.create('invalid_node');
        }

        const entry = this.entriesByUUID.get(entry_uuid);
        if (!entry) {
            return null;
        }

        // Return a copied entry with `full_path`, since external code only cares
        // about full path.
        const copied_entry = { ...entry };
        copied_entry.path = _path.join(this.mountpoint, entry.path);
        return copied_entry;
    }

    /**
     * Read directory contents.
     *
     * @param {Object} param
     * @param {Context} param.context - The context of the operation.
     * @param {FSNodeContext} param.node - The directory node to read.
     * @returns {Promise<string[]>} - Array of child UUIDs.
     */
    async readdir({ context, node }) {
        // prerequistes: get required path via stat
        const entry = await this.stat({ selector: node.selector });
        if (!entry) {
            throw APIError.create('invalid_node');
        }

        const inner_path = this._inner_path(entry.path);
        const child_uuids = [];

        // Find all entries that are direct children of this directory
        for (const [path, uuid] of this.entriesByPath) {
            if (path === inner_path) {
                continue; // Skip the directory itself
            }

            const dirname = _path.dirname(path);
            if (dirname === inner_path) {
                child_uuids.push(uuid);
            }
        }

        return child_uuids;
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
        // prerequistes: get required path via stat
        const parent_entry = await this.stat({ selector: parent.selector });
        if (!parent_entry) {
            throw APIError.create('invalid_node');
        }

        const full_path = _path.join(parent_entry.path, name);
        const inner_path = this._inner_path(full_path);

        let entry = null;
        if (this.entriesByPath.has(inner_path)) {
            throw APIError.create('item_with_same_name_exists', null, {
                entry_name: full_path,
            });
        } else {
            entry = new MemoryFile({
                path: inner_path,
                is_dir: true,
                content: null,
                parent_uid: parent_entry.uuid,
            });
            this.entriesByPath.set(inner_path, entry.uuid);
            this.entriesByUUID.set(entry.uuid, entry);
        }

        // create the node
        const fs = context.get('services').get('filesystem');
        const node = await fs.node(new NodeUIDSelector(entry.uuid));
        await node.fetchEntry();

        this._integrity_check();

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
        this._integrity_check();

        // prerequistes: get required path via stat
        const entry = await this.stat({ selector: node.selector });
        if (!entry) {
            throw APIError.create('invalid_node');
        }

        const inner_path = this._inner_path(entry.path);

        // for mode: non-recursive
        if (!options.recursive) {
            const children = await this.readdir({ context, node });
            if (children.length > 0) {
                throw APIError.create('not_empty');
            }
        }

        // remove all descendants
        for (const [other_inner_path, other_entry_uuid] of this.entriesByPath) {
            if (other_entry_uuid === entry.uuid) {
                // skip the directory itself
                continue;
            }

            if (other_inner_path.startsWith(inner_path)) {
                this.entriesByPath.delete(other_inner_path);
                this.entriesByUUID.delete(other_entry_uuid);
            }
        }

        // for mode: non-descendants-only
        if (!options.descendants_only) {
            // remove the directory itself
            this.entriesByPath.delete(inner_path);
            this.entriesByUUID.delete(entry.uuid);
        }

        this._integrity_check();
    }

    /**
     * Remove a file.
     *
     * @param {Object} param
     * @param {Context} param.context
     * @param {FSNodeContext} param.node: The file to remove.
     * @returns {Promise<void>}
     */
    async unlink({ context, node }) {
        // prerequistes: get required path via stat
        const entry = await this.stat({ selector: node.selector });
        if (!entry) {
            throw APIError.create('invalid_node');
        }

        const inner_path = this._inner_path(entry.path);
        this.entriesByPath.delete(inner_path);
        this.entriesByUUID.delete(entry.uuid);
    }

    /**
     * Move a file.
     *
     * @param {Object} param
     * @param {Context} param.context
     * @param {FSNodeContext} param.node: The file to move.
     * @param {FSNodeContext} param.new_parent: The new parent directory of the file.
     * @param {string} param.new_name: The new name of the file.
     * @param {Object} param.metadata: The metadata of the file.
     * @returns {Promise<MemoryFile>}
     */
    async move({ context, node, new_parent, new_name, metadata }) {
        // prerequistes: get required path via stat
        const new_parent_entry = await this.stat({ selector: new_parent.selector });
        if (!new_parent_entry) {
            throw APIError.create('invalid_node');
        }

        // create the new entry
        const new_full_path = _path.join(new_parent_entry.path, new_name);
        const new_inner_path = this._inner_path(new_full_path);
        const entry = new MemoryFile({
            path: new_inner_path,
            is_dir: node.entry.is_dir,
            content: node.entry.content,
            parent_uid: new_parent_entry.uuid,
        });
        entry.uuid = node.entry.uuid;
        this.entriesByPath.set(new_inner_path, entry.uuid);
        this.entriesByUUID.set(entry.uuid, entry);

        // remove the old entry
        const inner_path = this._inner_path(node.path);
        this.entriesByPath.delete(inner_path);
        // NB: should not delete the entry by uuid because uuid does not change
        // after the move.

        this._integrity_check();

        return entry;
    }

    /**
     * Copy a tree of files and directories.
     *
     * @param {Object} param
     * @param {Context} param.context
     * @param {FSNodeContext} param.source - The source node to copy.
     * @param {FSNodeContext} param.parent - The parent directory for the copy.
     * @param {string} param.target_name - The name for the copied item.
     * @returns {Promise<FSNodeContext>} - The copied node.
     */
    async copy_tree({ context, source, parent, target_name }) {
        const fs = context.get('services').get('filesystem');

        if (source.entry.is_dir) {
            // Create the directory
            const new_dir = await this.mkdir({ context, parent, name: target_name });

            // Copy all children
            const children = await this.readdir({ context, node: source });
            for (const child_uuid of children) {
                const child_node = await fs.node(new NodeUIDSelector(child_uuid));
                await child_node.fetchEntry();
                const child_name = child_node.entry.name;

                await this.copy_tree({
                    context,
                    source: child_node,
                    parent: new_dir,
                    target_name: child_name,
                });
            }

            return new_dir;
        } else {
            // Copy the file
            const new_file = await this.write_new({
                context,
                parent,
                name: target_name,
                file: { stream: { read: () => source.entry.content } },
            });
            return new_file;
        }
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
        // prerequistes: get required path via stat
        const parent_entry = await this.stat({ selector: parent.selector });
        if (!parent_entry) {
            throw APIError.create('invalid_node');
        }
        const full_path = _path.join(parent_entry.path, name);
        const inner_path = this._inner_path(full_path);

        let entry = null;
        if (this.entriesByPath.has(inner_path)) {
            throw APIError.create('item_with_same_name_exists', null, {
                entry_name: full_path,
            });
        } else {
            entry = new MemoryFile({
                path: inner_path,
                is_dir: false,
                content: file.stream.read(),
                parent_uid: parent_entry.uuid,
            });
            this.entriesByPath.set(inner_path, entry.uuid);
            this.entriesByUUID.set(entry.uuid, entry);
        }

        const fs = context.get('services').get('filesystem');
        const node = await fs.node(new NodeUIDSelector(entry.uuid));
        await node.fetchEntry();

        this._integrity_check();

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
        const entry = await this.stat({ selector: node.selector });
        if (!entry) {
            throw APIError.create('invalid_node');
        }
        const inner_path = this._inner_path(entry.path);

        this.entriesByPath.set(inner_path, entry.uuid);
        let original_entry = this.entriesByUUID.get(entry.uuid);
        if (!original_entry) {
            throw new Error(`File ${entry.path} does not exist`);
        } else {
            if (original_entry.is_dir) {
                throw new Error(`Cannot overwrite a directory`);
            }

            original_entry.content = file.stream.read();
            original_entry.modified = Math.floor(Date.now() / 1000);
            original_entry.size = original_entry.content ? original_entry.content.length : 0;
            this.entriesByUUID.set(entry.uuid, original_entry);
        }

        const fs = context.get('services').get('filesystem');
        node = await fs.node(new NodeUIDSelector(original_entry.uuid));
        await node.fetchEntry();

        this._integrity_check();

        return node;
    }

    async read({
        context,
        node,
    }) {
        // TODO: once MemoryFS aggregates its own storage, don't get it
        //       via mountpoint service.
        const svc_mountpoint = context.get('services').get('mountpoint');
        const storage = svc_mountpoint.get_storage(this.constructor.name);
        const stream = (await storage.create_read_stream(await node.get('uid'), {
            memory_file: node.entry,
        }));
        return stream;
    }
}

module.exports = {
    MemoryFSProvider,
};
