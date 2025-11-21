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

const { TYPE_DIRECTORY } = require('../../filesystem/FSNodeContext');
const { HLWrite } = require('../../filesystem/hl_operations/hl_write');
const { NodePathSelector } = require('../../filesystem/node/selectors');
const _path = require('path');
const { sign_file } = require('../../helpers');

module.exports = async function writeFile_handle_write ({
    req, res, actor, node,
}) {

    // Check if files were uploaded
    if ( ! req.files ) {
        return res.status(400).send('No files uploaded');
    }

    // Get fsentry
    let dirname;

    try {
        dirname = (await node.get('type') !== TYPE_DIRECTORY
            ? _path.dirname.bind(_path) : a => a)(await node.get('path'));
    } catch (e) {
        console.log(e);
        req.__error_source = e;
        return res.status(500).send(e);
    }

    const svc_fs = req.services.get('filesystem');
    const dirNode = await svc_fs.node(new NodePathSelector(dirname));

    // Upload files one by one
    const returns = [];
    for ( const uploaded_file of req.files ) {
        try {
            const hl_write = new HLWrite();
            const ret_obj = await hl_write.run({
                destination_or_parent: dirNode,
                specified_name: await node.get('type') === TYPE_DIRECTORY
                    ? req.body.name : await node.get('name'),
                fallback_name: uploaded_file.originalname,
                overwrite: true,
                user: actor.type.user,
                actor,

                file: uploaded_file,
            });

            // add signature to object
            ret_obj.signature = await sign_file(ret_obj, 'write');

            // send results back to app
            returns.push(ret_obj);
        } catch ( error ) {
            req.__error_source = error;
            console.log(error);
            return res.contentType('application/json').status(500).send(error);
        }
    }

    if ( returns.length === 1 ) {
        return res.send(returns[0]);
    }

    return res.send(returns);
};
