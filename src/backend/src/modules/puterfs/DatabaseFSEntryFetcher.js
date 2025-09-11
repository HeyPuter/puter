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
const { DB_READ } = require("../../services/database/consts");
const { NodePathSelector, NodeUIDSelector, NodeInternalIDSelector, NodeChildSelector, RootNodeSelector } = require("../../filesystem/node/selectors");
const BaseService = require("../../services/BaseService");

/**
 * Service for fetching filesystem entries from the database using various selector types.
 * Handles different methods of locating files and directories in the filesystem.
 */
module.exports = class DatabaseFSEntryFetcher extends BaseService {
    static CONCERN = 'filesystem';
    
    /**
     * Initializes the default properties that will be selected from the database.
     */
    _construct () {
        this.defaultProperties = [
            'id',
            'associated_app_id',
            'uuid',
            'public_token',
            'bucket',
            'bucket_region',
            'file_request_token',
            'user_id',
            'parent_uid',
            'is_dir',
            'is_public',
            'is_shortcut',
            'is_symlink',
            'symlink_path',
            'shortcut_to',
            'sort_by',
            'sort_order',
            'immutable',
            'name',
            'metadata',
            'modified',
            'created',
            'accessed',
            'size',
            'layout',
            'path',
        ]
    }

    /**
     * Initializes the database connection for filesystem operations.
     */
    _init () {
        this.db = this.services.get('database').get(DB_READ, 'filesystem');
    }

    /**
     * Finds a filesystem entry using the provided selector.
     * @param {Object} selector - The selector object specifying how to find the entry
     * @param {Object} fetch_entry_options - Options for fetching the entry
     * @returns {Promise<Object|null>} The filesystem entry or null if not found
     */
    async find (selector, fetch_entry_options) {
        if ( selector instanceof RootNodeSelector ) {
            return selector.entry;
        }
        if ( selector instanceof NodePathSelector ) {
            return await this.findByPath(
                selector.value, fetch_entry_options);
        }
        if ( selector instanceof NodeUIDSelector ) {
            return await this.findByUID(
                selector.value, fetch_entry_options);
        }
        if ( selector instanceof NodeInternalIDSelector ) {
            return await this.findByID(
                selector.id, fetch_entry_options);
        }
        if ( selector instanceof NodeChildSelector ) {
            let id;

            if ( selector.parent instanceof RootNodeSelector ) {
                id = await this.findNameInRoot(selector.name);
            } else {
                const parentEntry = await this.find(selector.parent);
                if ( ! parentEntry ) return null;
                id = await this.findNameInParent(
                    parentEntry.uuid, selector.name
                );
            }

            if ( id === undefined ) return null;
            if ( typeof id !== 'number' ) {
                throw new Error(
                    'unexpected type for id value',
                    typeof id,
                    id
                );
            }
            return this.find(new NodeInternalIDSelector('mysql', id));
        }
    }

    /**
     * Finds a filesystem entry by its UUID.
     * @param {string} uuid - The UUID of the entry to find
     * @param {Object} fetch_entry_options - Options including thumbnail flag
     * @returns {Promise<Object|undefined>} The filesystem entry or undefined if not found
     */
    async findByUID(uuid, fetch_entry_options = {}) {
        const { thumbnail } = fetch_entry_options;

        let fsentry = await this.db.tryHardRead(
            `SELECT ` +
                this.defaultProperties.join(', ') +
                (thumbnail ? `, thumbnail` : '') +
                ` FROM fsentries WHERE uuid = ? LIMIT 1`,
            [uuid]
        );

        return fsentry[0];
    }

    /**
     * Finds a filesystem entry by its internal database ID.
     * @param {number} id - The internal ID of the entry to find
     * @param {Object} fetch_entry_options - Options including thumbnail flag
     * @returns {Promise<Object|undefined>} The filesystem entry or undefined if not found
     */
    async findByID(id, fetch_entry_options = {}) {
        const { thumbnail } = fetch_entry_options;

        let fsentry = await this.db.tryHardRead(
            `SELECT ` +
                this.defaultProperties.join(', ') +
                (thumbnail ? `, thumbnail` : '') +
                ` FROM fsentries WHERE id = ? LIMIT 1`,
            [id]
        );

        return fsentry[0];
    }

    /**
     * Finds a filesystem entry by its full path.
     * @param {string} path - The full path of the entry to find
     * @param {Object} fetch_entry_options - Options including thumbnail flag and tracer
     * @returns {Promise<Object|false>} The filesystem entry or false if not found
     */
    async findByPath(path, fetch_entry_options = {}) {
        const { thumbnail } = fetch_entry_options;

        if ( path === '/' ) {
            return this.find(new RootNodeSelector());
        }

        const parts = path.split('/').filter(path => path !== '');
        if ( parts.length === 0 ) {
            // TODO: invalid path; this should be an error
            return false;
        }


        // TODO: use a closure table for more efficient path resolving
        let parent_uid = null;
        let result;

        const resultColsSql = this.defaultProperties.join(', ') +
            (thumbnail ? `, thumbnail` : '');

        result = await this.db.read(
            `SELECT ` + resultColsSql +
            ` FROM fsentries WHERE path=? LIMIT 1`,
            [path]
        );

        // using knex instead

        if ( result[0] ) return result[0];

        this.log.info(`findByPath (not cached): ${path}`)

        const loop = async () => {
            for ( let i=0 ; i < parts.length ; i++ ) {
                const part = parts[i];
                const isLast = i == parts.length - 1;
                const colsSql = isLast ? resultColsSql : 'uuid';
                if ( parent_uid === null ) {
                    result = await this.db.read(
                        `SELECT ` + colsSql +
                            ` FROM fsentries WHERE parent_uid IS NULL AND name=? LIMIT 1`,
                        [part]
                    );
                } else {
                    result = await this.db.read(
                        `SELECT ` + colsSql +
                            ` FROM fsentries WHERE parent_uid=? AND name=? LIMIT 1`,
                        [parent_uid, part]
                    );
                }

                if ( ! result[0] ) return false;
                parent_uid = result[0].uuid;
            }
        }

        if ( fetch_entry_options.tracer ) {
            const tracer = fetch_entry_options.tracer;
            const options = fetch_entry_options.trace_options;
            await tracer.startActiveSpan(`fs:sql:findByPath`,
                ...(options ? [options] : []),
                async span => {
                    await loop();
                    span.end();
                });
        } else {
            await loop();
        }

        return result[0];
    }

    /**
     * Finds the ID of a child entry with the given name in the root directory.
     * @param {string} name - The name of the child entry to find
     * @returns {Promise<number|undefined>} The ID of the child entry or undefined if not found
     */
    async findNameInRoot (name) {
        let child_id = await this.db.read(
            "SELECT `id` FROM `fsentries` WHERE `parent_uid` IS NULL AND name = ? LIMIT 1",
            [name]
        );
        return child_id[0]?.id;
    }

    /**
     * Finds the ID of a child entry with the given name under a specific parent.
     * @param {string} parent_uid - The UUID of the parent directory
     * @param {string} name - The name of the child entry to find
     * @returns {Promise<number|undefined>} The ID of the child entry or undefined if not found
     */
    async findNameInParent (parent_uid, name) {
        let child_id = await this.db.read(
            "SELECT `id` FROM `fsentries` WHERE `parent_uid` = ? AND name = ? LIMIT 1",
            [parent_uid, name]
        );
        return child_id[0]?.id;
    }

    /**
     * Checks if an entry with the given name exists under a specific parent.
     * @param {string} parent_uid - The UUID of the parent directory
     * @param {string} name - The name to check for
     * @returns {Promise<boolean>} True if the name exists under the parent, false otherwise
     */
    async nameExistsUnderParent (parent_uid, name) {
        let check_dupe = await this.db.read(
            "SELECT `id` FROM `fsentries` WHERE `parent_uid` = ? AND name = ? LIMIT 1",
            [parent_uid, name]
        );
        return !! check_dupe[0];
    }

    /**
     * Checks if an entry with the given name exists under a parent specified by ID.
     * @param {number} parent_id - The internal ID of the parent directory
     * @param {string} name - The name to check for
     * @returns {Promise<boolean>} True if the name exists under the parent, false otherwise
     */
    async nameExistsUnderParentID (parent_id, name) {
        const parent = await this.findByID(parent_id);
        if ( ! parent ) {
            return false;
        }
        return this.nameExistsUnderParent(parent.uuid, name);
    }
}
