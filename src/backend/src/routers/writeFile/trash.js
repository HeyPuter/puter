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

const { HLMove } = require('../../filesystem/hl_operations/hl_move');
const { NodePathSelector } = require('../../filesystem/node/selectors');

module.exports = async function writeFile_handle_trash ({
    req, res, actor, node,
}) {
    // metadata for trashed file
    const new_name = await node.get('uid');
    const metadata = {
        original_name: await node.get('name'),
        original_path: await node.get('path'),
        trashed_ts: Math.round(Date.now() / 1000),
    };

    // Get Trash fsentry
    const fs = req.services.get('filesystem');
    const trash = await fs.node(new NodePathSelector(`/${ actor.type.user.username }/Trash`));

    // No Trash?
    if ( ! trash ) {
        return res.status(400).send({
            error: {
                message: 'No Trash directory found.',
            },
        });
    }

    const hl_move = new HLMove();
    await hl_move.run({
        source: node,
        destination_or_parent: trash,
        user: actor.type.user,
        actor,
        new_name: new_name,
        new_metadata: metadata,
    });

    return res.status(200).send({
        message: 'Item trashed',
    });
};
