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

'use strict';

const { Context } = require('../../../util/context');

// -----------------------------------------------------------------------//
// WebSocket handler for replica/fetch
// -----------------------------------------------------------------------//
module.exports = {
    event: 'replica/fetch',
    handler: async (socket, _data) => {
        console.log('[xiaochen-debug] fetch_replica.handler, socket.user.id:', socket.user.id);

        // const svc_permission = Context.get('services').get('permission');
        // const can_access = await svc_permission.check('endpoint:replica/fetch');
        // if ( ! can_access ) {
        //     return socket.emit('replica/fetch/error', {
        //         success: false,
        //         error: { message: 'permission denied' },
        //     });
        // }

        // Import gRPC client and protobuf classes from common
        const {
            getClient,
            FetchReplicaRequest,
        } = require('./common');

        const client = getClient();
        if ( !client ) {
            // Client-replica service is not available
            return socket.emit('replica/fetch/error', {
                success: false,
                error: { message: 'client-replica service is not available' },
            });
        }

        // Build the request message
        const requestMsg = new FetchReplicaRequest();
        requestMsg.setUserId(socket.user.id);

        client.fetchReplica(requestMsg, (err, resp) => {
            if ( err ) {
                console.error(`FetchReplica error: ${err.message}`);
                return socket.emit('replica/fetch/error', {
                    success: false,
                    error: { message: 'failed to fetch replica', details: err.message },
                });
            }

            // Convert protobuf response to plain JavaScript
            // The response is directly a MerkleTree, not wrapped in another object

            // Get the nodes map and root UUID
            const nodesMap = resp.getNodesMap();
            const rootUuid = resp.getRootUuid();

            // Convert nodes map to plain JavaScript object
            const nodes = {};
            nodesMap.forEach((node, nodeUuid) => {
                // Convert the map-based children_uuids to a JavaScript object
                const childrenUuidsMap = node.getChildrenUuidsMap();
                const childrenUuids = {};
                childrenUuidsMap.forEach((value, key) => {
                    childrenUuids[key] = value;
                });

                nodes[nodeUuid] = {
                    uuid: node.getUuid(),
                    merkle_hash: node.getMerkleHash(),
                    children_uuids: childrenUuids,
                    parent_uuid: node.getParentUuid(),
                    fs_entry: node.getFsEntry() ? node.getFsEntry().getMetadata().toJavaScript() : {},
                };
            });

            socket.emit('replica/fetch/success', {
                success: true,
                data: {
                    root_uuid: rootUuid,
                    nodes: nodes,
                },
            });
        });
    },
};
