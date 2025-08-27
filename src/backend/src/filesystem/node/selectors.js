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
const _path = require('path');
const { PuterPath } = require('../lib/PuterPath');

class NodePathSelector {
    constructor (path) {
        this.value = path;
    }

    setPropertiesKnownBySelector (node) {
        node.path = this.value;
        node.name = _path.basename(this.value);
    }

    describe () {
        return this.value;
    }
}

class NodeUIDSelector {
    constructor (uid) {
        this.value = uid;
    }

    setPropertiesKnownBySelector (node) {
        node.uid = this.value;
    }

    // Note: the selector could've been added by FSNodeContext
    // during fetch, but this was more efficient because the
    // object is created lazily, and it's somtimes not needed.
    static implyFromFetchedData (node) {
        if ( node.uid ) {
            return new NodeUIDSelector(node.uid);
        }
        return null;
    }

    describe () {
        return `[uid:${this.value}]`;
    }
}

class NodeInternalIDSelector {
    constructor (service, id, debugInfo) {
        this.service = service;
        this.id = id;
        this.debugInfo = debugInfo;
    }

    setPropertiesKnownBySelector (node) {
        if ( this.service === 'mysql' ) {
            node.mysql_id = this.id;
        }
    }

    describe (showDebug) {
        if ( showDebug ) {
            return `[db:${this.id}] (${
                JSON.stringify(this.debugInfo, null, 2)
            })`
        }
        return `[db:${this.id}]`
    }
}

class NodeChildSelector {
    constructor (parent, name) {
        this.parent = parent;
        this.name = name;
    }

    setPropertiesKnownBySelector (node) {
        node.name = this.name;
        // no properties known
    }

    describe () {
        return this.parent.describe() + '/' + this.name;
    }
}

class RootNodeSelector {
    static entry = {
        is_dir: true,
        is_root: true,
        uuid: PuterPath.NULL_UUID,
        name: '/',
    };
    setPropertiesKnownBySelector (node) {
        node.path = '/';
        node.root = true;
        node.uid = PuterPath.NULL_UUID;
    }
    constructor () {
        this.entry = this.constructor.entry;
    }

    describe () {
        return '[root]';
    }
}

class NodeRawEntrySelector {
    constructor (entry) {
        // Fix entries from get_descendants
        if ( ! entry.uuid && entry.uid ) {
            entry.uuid = entry.uid;
            if ( entry._id ) {
                entry.id = entry._id;
                delete entry._id;
            }
        }

        this.entry = entry;
    }

    setPropertiesKnownBySelector (node) {
        node.found = true;
        node.entry = this.entry;
        node.uid = this.entry.uid ?? this.entry.uuid;
        node.name = this.entry.name;
        if ( this.entry.path ) node.path = this.entry.path;
    }

    describe () {
        return '[raw entry]';
    }
}

const relativeSelector = (parent, path) => {
    if ( path === '.' ) return parent;
    if ( path.startsWith('..') ) {
        throw new Error('currently unsupported');
    }

    let selector = parent;

    const parts = path.split('/').filter(Boolean);
    for ( const part of parts ) {
        selector = new NodeChildSelector(selector, part);
    }

    return selector;
}

module.exports = {
    NodePathSelector,
    NodeUIDSelector,
    NodeInternalIDSelector,
    NodeChildSelector,
    RootNodeSelector,
    NodeRawEntrySelector,
    relativeSelector,
};
