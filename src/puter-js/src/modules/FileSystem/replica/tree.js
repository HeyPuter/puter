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

import stringify from 'safe-stable-stringify';
import xxhash from 'xxhash-wasm';

class FSTree {
    constructor(data) {
        if ( !data ) {
            throw new Error('FSTree requires valid data to initialize');
        }
        this.tree = data;
        this.nodes = data.nodes;
        this.rootId = data.root_uuid;

        // Get the root node to determine the root path
        const rootNode = this.nodes[this.rootId];
        if ( rootNode && rootNode.fs_entry ) {
            this.root = rootNode.fs_entry.path || '/';
        } else {
            this.root = '/';
        }
    }

    /**
     * Calculate Merkle hash for a node based on its metadata and children hashes
     * This matches the exact logic from server.go
     * @param {Object} node - The node to calculate hash for
     * @param {Array} childrenHashes - Array of child node hashes (strings)
     * @returns {string} - String representation of the hash
     */
    async calculateMerkleHash(node, childrenHashes = []) {
        const { create64 } = await xxhash();

        const hasher = create64(0n);

        if ( node.fs_entry ) {
            const metadata = stringify(node.fs_entry);
            hasher.update(metadata);
        }

        // Sort children hashes as strings for consistency
        const sortedChildrenHashes = [...childrenHashes].sort();
        for ( const childHash of sortedChildrenHashes ) {
            hasher.update(childHash);
        }

        const hash = hasher.digest();
        return hash.toString();
    }

    /**
     * Recalculate Merkle hashes for all ancestors of a given node
     * @param {string} nodeId - The ID of the node whose ancestors need recalculation
     */
    async recalculateAncestorHashes(nodeId) {
        const node = this.nodes[nodeId];
        if ( !node ) {
            return;
        }

        let currentNodeId = nodeId;

        while ( currentNodeId ) {
            const currentNode = this.nodes[currentNodeId];
            if ( !currentNode ) {
                break;
            }

            const childrenHashes = [];
            if ( currentNode.children_uuids ) {
                for ( const childId of Object.keys(currentNode.children_uuids) ) {
                    const childNode = this.nodes[childId];
                    if ( childNode && childNode.merkle_hash ) {
                        childrenHashes.push(childNode.merkle_hash);
                    }
                }
            }

            currentNode.merkle_hash = await this.calculateMerkleHash(currentNode, childrenHashes);

            currentNodeId = currentNode.parent_uuid;
        }
    }

    /**
     * Find a node by path in the tree
     * @param {string} path - Path to find (e.g., '/', '/folder', '/folder/file.txt')
     * @returns {Object|null} - Node object or null if not found
     */
    findNodeByPath(path) {
        // we're already in the root, so remove it
        path = path.replace(this.root, '');

        const parts = path.split('/').filter(part => part !== '');
        let currentId = this.rootId;

        for ( const part of parts ) {
            const currentNode = this.nodes[currentId];
            if ( !currentNode || !currentNode.children_uuids ) {
                return null;
            }

            // Find child with matching name
            const foundId = Object.keys(currentNode.children_uuids).find(childId => {
                const childNode = this.nodes[childId];
                return childNode && childNode.fs_entry && childNode.fs_entry.name === part;
            });

            if ( !foundId ) {
                return null;
            }
            currentId = foundId;
        }

        return this.nodes[currentId];
    }

    /**
     * Find a node by UUID in the tree
     * @param {string} uid - UUID to find
     * @returns {Object|null} - Node object or null if not found
     */
    findNodeByUUID(uid) {
        // Direct lookup in nodes map
        return this.nodes[uid] || null;
    }

    /**
     * Read directory contents.
     *
     * @param {Object} options - Options object
     * @param {string} [options.path] - Path to read directory for
     * @param {string} [options.uid] - UUID to read directory for
     * @returns {Array} - Array of child fs_entry objects
     */
    readdir(options) {
        const path = options.path;
        const uid = options.uid;
        let node = null;

        if ( uid ) {
            node = this.findNodeByUUID(uid);
        } else if ( path ) {
            node = this.findNodeByPath(path);
        } else {
            throw new Error('Either path or uid must be provided');
        }

        if ( !node ) {
            throw new Error(`Path not found: ${path}`);
        }

        if ( !node.fs_entry?.is_dir ) {
            throw new Error(`Not a directory: ${path}`);
        }

        // Get children by their UUIDs
        const childrenUuids = Object.keys(node.children_uuids || {});
        return childrenUuids
            .map(childId => this.nodes[childId])
            .filter(childNode => childNode && childNode.fs_entry)
            .map(childNode => childNode.fs_entry);
    }

    /**
     * Get node fs_entry
     * @param {Object} options - Options object
     * @param {string} [options.path] - Path to get fs_entry for
     * @param {string} [options.uid] - UUID to get fs_entry for
     * @returns {Object|null} - fs_entry object or null if not found
     */
    stat(options) {
        const path = options.path;
        const uid = options.uid;
        let node = null;

        if ( uid ) {
            node = this.findNodeByUUID(uid);
        } else if ( path ) {
            node = this.findNodeByPath(path);
        } else {
            throw new Error('Either path or uid must be provided');
        }

        return node?.fs_entry;
    }

    // mimic rpc:
    // rpc NewFSEntry(NewFSEntryRequest) returns (google.protobuf.Empty);
    async newFSEntry(fs_entry) {
        if ( !fs_entry || !fs_entry.uid ) {
            throw new Error('Invalid fs_entry: must have uid');
        }

        const newNode = {
            uuid: fs_entry.uid,
            merkle_hash: '',
            parent_uuid: fs_entry.parent_uid,
            fs_entry: fs_entry,
            children_uuids: {},
        };

        this.nodes[newNode.uuid] = newNode;

        if ( !newNode.parent_uuid ) {
            throw new Error('Invalid fs_entry: must have parent_uid');
        }

        const parentNode = this.findNodeByUUID(newNode.parent_uuid);
        if ( !parentNode ) {
            throw new Error(`Parent directory not found: ${newNode.parent_uuid}`);
        }

        if ( !parentNode.children_uuids ) {
            parentNode.children_uuids = {};
        }
        parentNode.children_uuids[newNode.uuid] = true;

        await this.recalculateAncestorHashes(newNode.uuid);
    }

    // mimic rpc:
    // rpc RemoveFSEntry(RemoveFSEntryRequest) returns (google.protobuf.Empty);
    async removeFSEntry(uuid) {
        const node = this.findNodeByUUID(uuid);
        if ( !node ) {
            throw new Error(`Node not found: ${uuid}`);
        }

        if ( node.parent_uuid ) {
            const parentNode = this.findNodeByUUID(node.parent_uuid);
            if ( parentNode ) {
                delete parentNode.children_uuids[uuid];
            } else {
                throw new Error(`Parent directory not found: ${node.parent_uuid}`);
            }
        }

        delete this.nodes[uuid];

        this.recalculateAncestorHashes(node.parent_uuid);
    }

    async rename(uuid, new_name, new_path) {
        const node = this.findNodeByUUID(uuid);
        if ( !node ) {
            throw new Error(`Node not found: ${uuid}`);
        }
        
        node.fs_entry.name = new_name;
        node.fs_entry.path = new_path;

        this.recalculateAncestorHashes(uuid);
    }
}

export default FSTree;
