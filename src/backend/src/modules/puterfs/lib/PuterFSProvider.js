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

const putility = require('@heyputer/putility');
const config = require('../../../config.js');

class PuterFSProvider extends putility.AdvancedBase {

    constructor (...a) {
        super(...a);
        this.log_fsentriesNotFound = (config.logging ?? [])
            .includes('fsentries-not-found');
    }

    get_capabilities () {
        console.error('This .get_capabilities should not be called!');
        throw new Error('This .get_capabilities should not be called!');
    }

    /**
     * Check if a given node exists.
     *
     * @param {Object} param
     * @param {NodeSelector} param.selector - The selector used for checking.
     * @returns {Promise<boolean>} - True if the node exists, false otherwise.
     */
    async quick_check () {
        console.error('This .quick_check should not be called!');
        throw new Error('This .quick_check should not be called!');
    }

    async stat () {
        console.error('This .stat should not be called!');
        throw new Error('This .stat should not be called!');
    }

    async readdir () {
        console.error('This .readdir should not be called!');
        throw new Error('This .readdir should not be called!');
    }

    async move () {
        console.error('This .move should not be called!');
        throw new Error('This .move should not be called!');
    }

    async copy_tree () {
        console.error('This .copy_tree should not be called!');
        throw new Error('This .copy_tree should not be called!');
    }

    async unlink () {
        console.error('This .unlink should not be called!');
        throw new Error('This .unlink should not be called!');
    }

    async rmdir () {
        console.error('This .rmdir should not be called!');
        throw new Error('This .rmdir should not be called!');
    }

    /**
     * Create a new directory.
     *
     * @param {Object} param
     * @param {Context} param.context
     * @param {FSNode} param.parent
     * @param {string} param.name
     * @param {boolean} param.immutable
     * @returns {Promise<FSNode>}
     */
    async mkdir () {
        console.error('This .mkdir should not be called!');
        throw new Error('This .mkdir should not be called!');
    }

    async update_thumbnail ({ context, node, thumbnail }) {
        console.error('This .update_thumbnail should not be called!');
        throw new Error('This .update_thumbnail should not be called!');
    }

    /**
     * Write a new file to the filesystem. Throws an error if the destination
     * already exists.
     *
     * @param {Object} param
     * @param {Context} param.context
     * @param {FSNode} param.parent: The parent directory of the file.
     * @param {string} param.name: The name of the file.
     * @param {File} param.file: The file to write.
     * @returns {Promise<FSNode>}
     */
    async write_new () {
        console.error('This .write_new should not be called!');
        throw new Error('This .write_new should not be called!');
    }

    /**
     * Overwrite an existing file. Throws an error if the destination does not
     * exist.
     *
     * @param {Object} param
     * @param {Context} param.context
     * @param {FSNodeContext} param.node: The node to write to.
     * @param {File} param.file: The file to write.
     * @returns {Promise<FSNodeContext>}
     */
    async write_overwrite () {
        console.error('This .write_overwrite should not be called!');
        throw new Error('This .write_overwrite should not be called!');
    }

    async read () {
        console.error('This .read should not be called!');
        throw new Error('This .read should not be called!');
    }
}

module.exports = {
    PuterFSProvider,
};
