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

const { HLMkdir } = require("../../filesystem/hl_operations/hl_mkdir");
const { NodeUIDSelector } = require("../../filesystem/node/selectors");
const { sign_file } = require("../../helpers");

module.exports = async function writeFile_handle_mkdir ({
    req, res, actor, node
}) {
    if( ! req.body.name ) return res.status(400).send({
        error:{
            message: 'Name is required.'
        }
    })

    const hl_mkdir = new HLMkdir();
    const r = await hl_mkdir.run({
        parent: node,
        path: req.body.name,
        overwrite: false,
        dedupe_name: req.body.dedupe_name ?? false,
        user: actor.type.user,
        actor,
    });

    const svc_fs = req.services.get('filesystem');
    
    const newdir_node = await svc_fs.node(new NodeUIDSelector(r.uid));
    return res.send(await sign_file(await newdir_node.get('entry'), 'write'));
};
