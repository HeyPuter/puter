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

module.exports = async function writeFile_handle_move ({
    api,
    req, res, actor, node,
}) {
    // check if destination_write_url provided
    if ( ! req.body.destination_write_url ) {
        return res.status(400).send({
            error: {
                message: 'No destination specified.',
            },
        });
    }

    const dest_node = await api.get_dest_node();
    if ( ! dest_node ) return;

    const hl_move = new HLMove();

    const opts = {
        user: actor.type.user,
        source: node,
        destination_or_parent: dest_node,
        overwrite: req.body.overwrite ?? false,
        new_name: req.body.new_name,
        new_metadata: req.body.new_metadata,
        create_missing_parents: req.body.create_missing_parents,
    };

    const r = await hl_move.run({
        ...opts,
        actor,
    });

    return res.send({
        ...r.moved,
        old_path: r.old_path,
        new_path: r.moved.path,
    });
};
