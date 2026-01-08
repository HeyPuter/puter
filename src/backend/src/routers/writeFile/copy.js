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

const { HLCopy } = require('../../filesystem/hl_operations/hl_copy');

module.exports = async function writeFile_handle_copy ({
    api,
    req, res, actor, node,
}) {

    // check if destination_write_url provided

    // check if destination_write_url is valid
    const dest_node = await api.get_dest_node();
    if ( ! dest_node ) return;

    const overwrite      = req.body.overwrite ?? false;
    const change_name    = req.body.auto_rename ?? false;

    const opts = {
        source: node,
        destination_or_parent: dest_node,
        dedupe_name: change_name,
        overwrite,
        user: actor.type.user,
    };

    const hl_copy = new HLCopy();

    const r =  await hl_copy.run({
        ...opts,
        actor,
    });
    return res.send([r]);
};
