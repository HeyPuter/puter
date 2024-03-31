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
const FSNodeContext = require("./FSNodeContext");

const { NodePathSelector, NodeUIDSelector, NodeInternalIDSelector } = require("./node/selectors");

/**
 * Container for access implementations.
 * 
 * Access implementations may vary depending on region,
 * user privileges, and other factors.
 * 
 * @class FSAccessContext
 */
module.exports = class FSAccessContext {
    constructor () {
        this.fsEntryFetcher = null;
    }

    /**
     * get_entry_by_path() returns a filesystem entry using
     * the path to the entry. Use this method when you need
     * to get a filesystem entry but don't need to collect
     * any other information about the entry.
     * 
     * @warning The entry returned by this method is not
     * client-safe. Use FSNodeContext to get a client-safe
     * entry by calling it's fetchEntry() method.
     * 
     * @param {*} path 
     * @returns 
     * @deprecated use get_entry({ path }) instead
     */
    async get_entry_by_path (path) {
        return await this.get_entry({ path });
    }

    /**
     * get_entry() returns a filesystem entry using
     * path, uid, or id associated with a filesystem
     * node. Use this method when you need to get a
     * filesystem entry but don't need to collect any
     * other information about the entry.
     * 
     * @warning The entry returned by this method is not
     * client-safe. Use FSNodeContext to get a client-safe
     * entry by calling it's fetchEntry() method.
     * 
     * @param {*} param0 options for getting the entry
     * @param {*} param0.path
     * @param {*} param0.uid
     * @param {*} param0.id please use mysql_id instead
     * @param {*} param0.mysql_id
     */
    async get_entry ({ path, uid, id, mysql_id, ...options }) {
        let fsNode = await this.node({ path, uid, id, mysql_id });
        await fsNode.fetchEntry(options);
        return fsNode.entry;
    }

    /**
     * node() returns a filesystem node using path, uid,
     * or id associated with a filesystem node. Use this
     * method when you need to get a filesystem node and
     * need to collect information about the entry.
     * 
     * @param {*} location - path, uid, or id associated with a filesystem node
     * @returns 
     */
    async node (selector) {
        if ( typeof selector === 'string' ) {
            if ( selector.startsWith('/') ) {
                selector = new NodePathSelector(selector);
            } else {
                selector = new NodeUIDSelector(selector);
            }
        }

        // TEMP: remove when these objects aren't used anymore
        if (
            typeof selector === 'object' &&
            selector.constructor.name === 'Object'
        ) {
            if ( selector.path ) {
                selector = new NodePathSelector(selector.path);
            } else if ( selector.uid ) {
                selector = new NodeUIDSelector(selector.uid);
            } else {
                selector = new NodeInternalIDSelector(
                    'mysql', selector.mysql_id);
            }
        }

        let fsNode = new FSNodeContext({
            services: this.services,
            selector,
            fs: this
        });
        return fsNode;
    }
};
