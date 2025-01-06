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

const mime = require('mime-types');
const { validate_fsentry_name } = require("../../helpers");
const { DB_WRITE } = require('../../services/database/consts');

module.exports = async function writeFile_handle_rename ({
    req, res, node,
}) {
    const new_name = req.body.new_name;

    try {
        validate_fsentry_name(new_name);
    } catch(e) {
        return res.status(400).send({
            error:{
                message: e.message
            }
        });
    }
    
    if ( await node.get('immutable') ) {
        return res.status(400).send({
            error:{
                message: 'Immutable: cannot rename.'
            }
        })
    }
    
    if ( await node.isUserDirectory() || await node.isRoot ) {
        return res.status(403).send({
            error:{
                message: 'Not allowed to rename this item via writeFile.'
            }
        })
    }
    
    const old_path = await node.get('path');
    
    const db = req.services.get('database').get(DB_WRITE, 'writeFile:rename');
    const mysql_id = await node.get('mysql-id');
    await db.write(
        `UPDATE fsentries SET name = ? WHERE id = ?`,
        [new_name, mysql_id]
    );

    const contentType = mime.contentType(req.body.new_name)
    const return_obj = {
        ...await node.getSafeEntry(),
        old_path,
        type: contentType ? contentType : null,
        original_client_socket_id: req.body.original_client_socket_id,
    };
    
    return res.send(return_obj);
}
