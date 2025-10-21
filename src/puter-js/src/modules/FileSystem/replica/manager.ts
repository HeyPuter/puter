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

// @ts-ignore - No type definitions available for socket.io
import io from '../../../lib/socket.io/socket.io.esm.min.js';
// @ts-ignore - No type definitions available for tree.js
import FSTree from './tree.js';

interface Context {
    authToken: string;
    APIOrigin: string;
    username?: string;
}

interface FSEntry {
    path: string;
    parent_uid: string | null;
    [key: string]: unknown;
}

interface NodeData {
    uuid: string;
    merkle_hash: string;
    fs_entry: FSEntry;
    children?: NodeData[];
}

interface FSNode {
    uuid: string;
    merkle_hash: string;
    parent_uuid: string | null;
    fs_entry: FSEntry;
    children_uuids: { [uuid: string]: boolean };
}

interface FSTreeData {
    rootId: string;
    nodes: { [uuid: string]: FSNode };
}

interface PullRequestItem {
    uuid: string;
    merkle_hash: string;
}

interface PullRequest {
    user_name: string;
    pull_request: PullRequestItem[];
}

interface PushRequestItem {
    uuid: string;
    merkle_hash: string;
    fs_entry: FSEntry;
    children?: PushRequestItem[];
}

interface ReplicaFetchSuccessData {
    data: FSTreeData;
}

interface ReplicaPullDiffSuccessData {
    data: {
        push_request: PushRequestItem[];
    };
}

interface ReplicaErrorData {
    error: {
        message: string;
    };
}

interface Socket {
    disconnect(): void;
    on(event: string, callback: (...args: any[]) => void): void;
    emit(event: string, data: any): void;
}

class ReplicaManager {
    private socket: Socket | null = null;
    private username: string | null = null;
    private pullDiffInterval: ReturnType<typeof setInterval> | null = null;
    private authToken: string = '';
    private APIOrigin: string = '';

    public available: boolean = false;
    public fs_tree: FSTree | null = null;
    public last_local_update: number = 0; // milliseconds since epoch

    // debug variables
    public debug: boolean = false;
    public local_read: number = 0;
    public remote_read: number = 0;

    /**
     * Initialize the replica manager for the current user.
     */
    async initialize(context: Context): Promise<void> {
        // check input
        if ( !context || !context.authToken || !context.APIOrigin ) {
            console.error(`[replica manager] failed to initialize, context is invalid: ${JSON.stringify(context, null, 2)}`);
            return;
        }

        this.authToken = context.authToken;
        this.APIOrigin = context.APIOrigin;

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
    async fetchUsername(): Promise<string> {
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

    connect(): void {
        if ( this.socket ) {
            // The disconnect action will not impact other components since each socket
            // object get their own session.
            this.socket.disconnect();
        }

        this.socket = io(this.APIOrigin, {
            auth: {
                auth_token: this.authToken,
            },
        }) as Socket;

        this.bindEvents();
    }

    /**
     * Bind websocket events
     */
    bindEvents(): void {
        if ( !this.socket ) return;

        this.socket.on('connect', () => {
            console.log('[replica manager] websocket connected');

            this.fetchReplica();
            this.startPullDiff();
        });

        this.socket.on('disconnect', () => {
            console.log('[replica manager] websocket disconnected');

            this.cleanup('disconnected');
        });

        this.socket.on('reconnect', (_attempt: number) => {
            console.log('[replica manager] websocket reconnected');

            this.fetchReplica();
            this.startPullDiff();
        });

        this.socket.on('error', (error: unknown) => {
            this.cleanup(`error: ${error}`);
        });

        this.socket.on('replica/fetch/success', (data: ReplicaFetchSuccessData) => {
            this.handleFetchReplicaSuccess(data);
        });

        this.socket.on('replica/fetch/error', (data: ReplicaErrorData) => {
            this.cleanup(`failed to fetch replica: ${data.error.message}`);
        });

        this.socket.on('replica/pull_diff/success', (data: ReplicaPullDiffSuccessData) => {
            this.handlePullDiffSuccess(data);
        });

        this.socket.on('replica/pull_diff/error', (data: ReplicaErrorData) => {
            this.cleanup(`failed to pull diff: ${data.error.message}`);
        });
    }

    /**
     * Fetch the replica from server for the current user.
     */
    fetchReplica(): void {
        if ( !this.username ) {
            console.warn('Replica Manager: No username available for fetching replica');
            return;
        }

        if ( !this.socket ) return;

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
    handleFetchReplicaSuccess(data: ReplicaFetchSuccessData): void {
        // Initialize the FSTree
        this.fs_tree = new FSTree(data.data);
        this.available = true;

        console.log('client-replica initialized for user:', this.username);
    }

    handlePullDiffSuccess(data: ReplicaPullDiffSuccessData): void {
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

        const nextPullRequest: PullRequestItem[] = [];

        for ( const pushItem of pushRequest ) {
            // process level-1 node
            const node = this.fs_tree!.nodes[pushItem.uuid];
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
                // NB: Must use a snapshot to avoid the "mutate-while-iterating" trap.
                for ( const localChildId of [...localChildren] ) {
                    if ( !serverChildren.includes(localChildId) ) {
                        this.removeNodeAndDescendants(localChildId);
                    }
                }

                // NB: Must use a snapshot to avoid the "mutate-while-iterating" trap.
                for ( const child of [...pushItem.children] ) {
                    const localChild = this.fs_tree!.nodes[child.uuid];

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
        if ( nextPullRequest.length > 0 && this.socket ) {
            this.socket.emit('replica/pull_diff', {
                user_name: this.username,
                pull_request: nextPullRequest,
            });
        }
    }

    /**
     * Add a new node to the tree
     */
    addNode(nodeData: NodeData): void {
        const newNode: FSNode = {
            uuid: nodeData.uuid,
            merkle_hash: nodeData.merkle_hash,
            parent_uuid: nodeData.fs_entry.parent_uid,
            fs_entry: nodeData.fs_entry,
            children_uuids: {},
        };

        this.fs_tree!.nodes[nodeData.uuid] = newNode;

        // Add to parent's children
        if ( nodeData.fs_entry.parent_uid ) {
            const parentNode = this.fs_tree!.nodes[nodeData.fs_entry.parent_uid];
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
    removeNodeAndDescendants(nodeId: string): void {
        const node = this.fs_tree!.nodes[nodeId];
        if ( !node ) {
            return;
        }

        // Remove from parent's children
        if ( node.parent_uuid ) {
            const parentNode = this.fs_tree!.nodes[node.parent_uuid];
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
        delete this.fs_tree!.nodes[nodeId];
    }

    startPullDiff(): void {
        // Clear any existing interval
        if ( this.pullDiffInterval ) {
            clearInterval(this.pullDiffInterval);
        }

        // Set up interval to send pull diff every 5 seconds
        this.pullDiffInterval = setInterval(() => {
            this.pullDiff();
        }, 5000);
    }

    pullDiff(): void {
        // check terminal conditions
        if ( !this.available ) {
            return;
        }

        // check skip conditions
        if ( Date.now() - this.last_local_update < 3000 ) {
            return;
        }

        try {
            const rootNode = this.fs_tree!.nodes[this.fs_tree!.rootId];
            if ( rootNode && rootNode.merkle_hash ) {
                // Create PullRequest format according to proto definition
                const pullRequest: PullRequest = {
                    user_name: this.username!,
                    pull_request: [
                        {
                            uuid: rootNode.uuid,
                            merkle_hash: rootNode.merkle_hash,
                        },
                    ],
                };

                if ( this.socket ) {
                    this.socket.emit('replica/pull_diff', pullRequest);
                }
            }
        } catch( error: unknown ) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.cleanup(`error in pullDiff: ${errorMessage}`);
        }
    }

    // Do cleanup and mark replica as unavailable.
    cleanup(reason: string): void {
        console.log(`[replica manager] cleanup, reason: ${reason}`);

        if ( this.pullDiffInterval ) {
            clearInterval(this.pullDiffInterval);
            this.pullDiffInterval = null;
        }

        if ( this.socket ) {
            this.socket.disconnect();
        }

        this.available = false;
    }

    /**
     * Set the debug flag
     */
    setDebug(enabled: boolean): void {
        this.debug = enabled;

        // Update widget visibility if the function exists (in GUI environment)
        if ( typeof window !== 'undefined' && (window as unknown as { updateReplicaWidgetVisibility?: () => void }).updateReplicaWidgetVisibility ) {
            (window as unknown as { updateReplicaWidgetVisibility: () => void }).updateReplicaWidgetVisibility();
        }
    }
}

// Create singleton instance
const replica = new ReplicaManager();

export default replica;
