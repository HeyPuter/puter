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
const { LLFilesystemOperation } = require('./definitions');
const APIError = require('../../api/APIError');

/**
 * The "overwrite" write operation.
 *
 * This operation is used to write a file to an existing path.
 *
 * @extends LLFilesystemOperation
 */
class LLOWrite extends LLFilesystemOperation {
    /**
     * Executes the overwrite operation by writing to an existing file node.
     * @returns {Promise<Object>} Result of the write operation
     * @throws {APIError} When the target node does not exist
     */
    async _run () {
        const node = this.values.node;

        // Embed fields into this.context
        this.context.set('immutable', this.values.immutable);
        this.context.set('tmp', this.values.tmp);
        this.context.set('fsentry_tmp', this.values.fsentry_tmp);
        this.context.set('message', this.values.message);
        this.context.set('actor', this.values.actor);
        this.context.set('app_id', this.values.app_id);

        // TODO: Add symlink write
        if ( ! await node.exists() ) {
            // TODO: different class of errors for low-level operations
            throw APIError.create('subject_does_not_exist');
        }

        return await node.provider.write_overwrite({
            context: this.context,
            node: node,
            file: this.values.file,
        });
    }
}

/**
 * The "non-overwrite" write operation.
 *
 * This operation is used to write a file to a non-existent path.
 *
 * @extends LLFilesystemOperation
 */
class LLCWrite extends LLFilesystemOperation {
    static MODULES = {
        _path: require('path'),
        uuidv4: require('uuid').v4,
        config: require('../../config.js'),
    };

    /**
     * Executes the create operation by writing a new file to the parent directory.
     * @returns {Promise<Object>} Result of the write operation
     * @throws {APIError} When the parent directory does not exist
     */
    async _run () {
        const parent = this.values.parent;

        // Embed fields into this.context
        this.context.set('immutable', this.values.immutable);
        this.context.set('tmp', this.values.tmp);
        this.context.set('fsentry_tmp', this.values.fsentry_tmp);
        this.context.set('message', this.values.message);
        this.context.set('actor', this.values.actor);
        this.context.set('app_id', this.values.app_id);

        if ( ! await parent.exists() ) {
            throw APIError.create('subject_does_not_exist');
        }

        return await parent.provider.write_new({
            context: this.context,
            parent,
            name: this.values.name,
            file: this.values.file,
        });
    }
}

module.exports = {
    LLCWrite,
    LLOWrite,
};
