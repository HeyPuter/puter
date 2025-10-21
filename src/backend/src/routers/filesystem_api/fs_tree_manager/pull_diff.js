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

// -----------------------------------------------------------------------//
// WebSocket handler for replica/pull_diff
// -----------------------------------------------------------------------//
module.exports = {
    event: 'replica/pull_diff',
    handler: async (socket, data) => {
        // Import gRPC client and protobuf classes from common
        const {
            client,
            PullRequest,
            PullRequestItem,
        } = require('./common');

        try {
            // Build the PullRequest message
            const requestMsg = new PullRequest();

            // Set the user_name at the top level
            requestMsg.setUserId(socket.user.id);

            // Add each pull request item
            if ( data.pull_request && Array.isArray(data.pull_request) ) {
                data.pull_request.forEach(item => {
                    const pullRequestItem = new PullRequestItem();
                    pullRequestItem.setUuid(item.uuid);
                    pullRequestItem.setMerkleHash(item.merkle_hash);
                    requestMsg.addPullRequest(pullRequestItem);
                });
            }

            client.pullDiff(requestMsg, (err, resp) => {
                if ( err ) {
                    console.error('PullDiff error:', err);
                    // TODO (xiaochen): what should we do when pull diff fails?
                    return socket.emit('replica/pull_diff/error', {
                        success: false,
                        error: { message: 'Failed to pull diff', details: err.message },
                    });
                }

                const pushRequestItems = resp.getPushRequestList();

                if ( pushRequestItems.length === 0 ) {
                    return;
                }

                // Convert protobuf response to plain JavaScript
                const pushRequest = {
                    push_request: pushRequestItems.map(item => ({
                        uuid: item.getUuid(),
                        merkle_hash: item.getMerkleHash(),
                        fs_entry: item.getFsEntry() ? item.getFsEntry().getMetadata().toJavaScript() : {},
                        children: item.getChildrenList().map(child => ({
                            uuid: child.getUuid(),
                            merkle_hash: child.getMerkleHash(),
                            fs_entry: child.getFsEntry() ? child.getFsEntry().getMetadata().toJavaScript() : {},
                            children: [], // Note: this is a simplified structure, real implementation might need recursive handling
                        })),
                    })),
                };

                socket.emit('replica/pull_diff/success', {
                    success: true,
                    data: pushRequest,
                });
            });
        } catch( error ) {
            console.error('Error in pull_diff handler:', error);
            socket.emit('replica/pull_diff/error', {
                success: false,
                error: { message: 'Internal error in pull_diff handler', details: error.message },
            });
        }
    },
};
