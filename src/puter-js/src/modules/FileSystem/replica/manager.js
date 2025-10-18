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

import io from '../../../lib/socket.io/socket.io.esm.min.js';
import FSTree from './tree.js';

class ReplicaManager {
    constructor() {
        this.socket = null;
        this.username = null;
        this.pullDiffInterval = null;

        this.available = false;
        this.fs_tree = null;
        this.last_local_update = 0; // milliseconds since epoch

        this.debug = false;
    }

    /**
     * Initialize the replica manager for the current user.
     */
    async initialize(context) {
        this.authToken = context.authToken;
        this.APIOrigin = context.APIOrigin;
        this.appID = context.appID;

        // Fetch username from whoami endpoint if not provided in context
        if ( !context.username ) {
            this.username = await this.fetchUsername();
        } else {
            this.username = context.username;
        }

        this.connect();
    }

    /**
     * Fetch username from whoami endpoint using direct API call
     */
    async fetchUsername() {
        try {
            const resp = await fetch(`${this.APIOrigin}/whoami`, {
                headers: {
                    Authorization: `Bearer ${this.authToken}`,
                },
            });

            const result = await resp.json();
            return result.username;
        } catch( error ) {
            console.error('Replica Manager: Failed to fetch username from whoami endpoint:', error);
            throw error;
        }
    }

    connect() {
        if ( this.socket ) {
            this.socket.disconnect();
        }

        this.socket = io(this.APIOrigin, {
            auth: {
                auth_token: this.authToken,
            },
        });

        this.bindEvents();
    }

    /**
     * Bind websocket events
     */
    bindEvents() {
        this.socket.on('connect', () => {
            this.fetchReplica();
            this.startPullDiff();
        });

        this.socket.on('disconnect', () => {
            this.cleanup('disconnected');
        });

        this.socket.on('reconnect', (_attempt) => {
            this.fetchReplica();
            this.startPullDiff();
        });

        this.socket.on('error', (error) => {
            this.cleanup(`error: ${error}`);
        });

        this.socket.on('replica/fetch/success', (data) => {
            this.handleFetchReplicaSuccess(data);
        });

        this.socket.on('replica/fetch/error', (data) => {
            this.cleanup(`failed to fetch replica: ${data.error.message}`);
        });

        this.socket.on('replica/pull_diff/success', (data) => {
            this.handlePullDiffSuccess(data);
        });

        this.socket.on('replica/pull_diff/error', (data) => {
            this.cleanup(`failed to pull diff: ${data.error.message}`);
        });
    }

    /**
     * Fetch the replica from server for the current user.
     */
    fetchReplica() {
        if ( !this.username ) {
            console.warn('Replica Manager: No username available for fetching replica');
            return;
        }

        const userRootPath = `/${this.username}`;

        this.socket.emit('replica/fetch', {
            path: userRootPath,

            // TODO (xiaochen): remove this
            requestId: 'user_root',
        });
    }

    /**
     * Handle successful replica fetch
     */
    handleFetchReplicaSuccess(data) {
        // Initialize the FSTree
        this.fs_tree = new FSTree(data.data);
        this.available = true;

        console.log('client-replica initialized for user:', this.username);
    }

    handlePullDiffSuccess(data) {
        const pushRequest = data?.data?.push_request;

        // check terminal conditions
        if ( !this.available ) {
            return;
        }

        // check skip conditions
        if ( !pushRequest || pushRequest.length === 0 ) {
            return;
        }

        const paths = pushRequest.map(item => item.fs_entry.path);
        if ( this.debug ) {
            console.log(`push request from server: ${paths}`);
        }

        const nextPullRequest = [];

        for ( const pushItem of pushRequest ) {
            // process level-1 node
            const node = this.fs_tree.nodes[pushItem.uuid];
            if ( node ) {
                // update existing
                node.fs_entry = pushItem.fs_entry;
                node.merkle_hash = pushItem.merkle_hash;
            } else {
                // new fsentry on remote, add it and fetch its children
                this.addNode(pushItem);

                nextPullRequest.push({
                    uuid: pushItem.uuid,
                    // use empty hash to force-fetch its children
                    merkle_hash: '',
                });
                continue;
            }

            // process children
            if ( pushItem.children ) {
                const localChildren = node ? Object.keys(node.children_uuids || {}) : [];
                const serverChildren = pushItem.children.map(child => child.uuid);

                // fsentry removed from server, remove it in local as well
                //
                // NB: Must use a snapshot to avoid the “mutate-while-iterating” trap.
                for ( const localChildId of [...localChildren] ) {
                    if ( !serverChildren.includes(localChildId) ) {
                        this.removeNodeAndDescendants(localChildId);
                    }
                }

                // NB: Must use a snapshot to avoid the “mutate-while-iterating” trap.
                for ( const child of [...pushItem.children] ) {
                    const localChild = this.fs_tree.nodes[child.uuid];

                    if ( !localChild ) {
                        // new fsentry on remote, add it and fetch its children
                        this.addNode(child);

                        nextPullRequest.push({
                            uuid: child.uuid,
                            // use empty hash to force-fetch its children
                            merkle_hash: '',
                        });
                    } else if ( localChild.merkle_hash !== child.merkle_hash ) {
                        // fsentry updated on remote, update and fetch its children
                        localChild.fs_entry = child.fs_entry;
                        localChild.merkle_hash = child.merkle_hash;
                        nextPullRequest.push({
                            uuid: child.uuid,
                            // use empty hash to force-fetch its children
                            merkle_hash: '',
                        });
                    }
                }
            }
        }

        // Send next pull request if there are nodes to update
        if ( nextPullRequest.length > 0 ) {
            this.socket.emit('replica/pull_diff', {
                user_name: this.username,
                pull_request: nextPullRequest,
            });
        }
    }

    /**
     * Add a new node to the tree
     */
    addNode(nodeData) {
        const newNode = {
            uuid: nodeData.uuid,
            merkle_hash: nodeData.merkle_hash,
            parent_uuid: nodeData.fs_entry.parent_uid,
            fs_entry: nodeData.fs_entry,
            children_uuids: {},
        };

        this.fs_tree.nodes[nodeData.uuid] = newNode;

        // Add to parent's children
        if ( nodeData.fs_entry.parent_uid ) {
            const parentNode = this.fs_tree.nodes[nodeData.fs_entry.parent_uid];
            if ( parentNode ) {
                if ( !parentNode.children_uuids ) {
                    parentNode.children_uuids = {};
                }
                parentNode.children_uuids[nodeData.uuid] = true;
            }
        }
    }

    /**
     * Remove a node and all its descendants from the local replica
     */
    removeNodeAndDescendants(nodeId) {
        const node = this.fs_tree.nodes[nodeId];
        if ( !node ) {
            return;
        }

        // Remove from parent's children
        if ( node.parent_uuid ) {
            const parentNode = this.fs_tree.nodes[node.parent_uuid];
            if ( parentNode && parentNode.children_uuids ) {
                delete parentNode.children_uuids[nodeId];
            }
        }

        // Remove all children recursively
        if ( node.children_uuids ) {
            for ( const childId of Object.keys(node.children_uuids) ) {
                this.removeNodeAndDescendants(childId);
            }
        }

        // Remove the node itself
        delete this.fs_tree.nodes[nodeId];
    }

    startPullDiff() {
        // Clear any existing interval
        if ( this.pullDiffInterval ) {
            clearInterval(this.pullDiffInterval);
        }

        // Set up interval to send pull diff every 5 seconds
        this.pullDiffInterval = setInterval(() => {
            this.pullDiff();
        }, 5000);
    }

    pullDiff() {
        // check terminal conditions
        if ( !this.available ) {
            return;
        }

        // check skip conditions
        if ( Date.now() - this.last_local_update < 3000 ) {
            return;
        }

        try {
            const rootNode = this.fs_tree.nodes[this.fs_tree.rootId];
            if ( rootNode && rootNode.merkle_hash ) {
                // Create PullRequest format according to proto definition
                const pullRequest = {
                    user_name: this.username,
                    pull_request: [
                        {
                            uuid: rootNode.uuid,
                            merkle_hash: rootNode.merkle_hash,
                        },
                    ],
                };

                this.socket.emit('replica/pull_diff', pullRequest);
            }
        } catch( error ) {
            this.cleanup(`error in pullDiff: ${error.message}`);
        }
    }

    // Do cleanup and mark replica as unavailable.
    cleanup(reason) {
        console.log(`replica manager cleanup, reason: ${reason}`);

        if ( this.pullDiffInterval ) {
            clearInterval(this.pullDiffInterval);
            this.pullDiffInterval = null;
        }

        if ( this.socket ) {
            // shouldn't disconnect since this socket is also used by the
            // other components
            //
            // this.socket.disconnect();
        }

        this.available = false;
    }

    /**
     * Set the debug flag
     */
    setDebug(enabled) {
        this.debug = enabled;

        // Update widget visibility if the function exists (in GUI environment)
        if ( typeof window !== 'undefined' && window.updateReplicaWidgetVisibility ) {
            window.updateReplicaWidgetVisibility();
        }
    }
}

// Create singleton instance
const replica = new ReplicaManager();

export default replica;
