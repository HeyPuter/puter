/*
 * Copyright (C) 2024 Puter Technologies Inc.
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
"use strict"
const eggspress = require('../../api/eggspress.js');
const APIError = require('../../api/APIError.js');
const { Context } = require('../../util/context.js');
const FSNodeParam = require('../../api/filesystem/FSNodeParam.js');
const { DB_WRITE } = require('../../services/database/consts.js');

// -----------------------------------------------------------------------//
// POST /rename
// -----------------------------------------------------------------------//
module.exports = eggspress('/rename', {
    subdomain: 'api',
    auth2: true,
    verified: true,
    fs: true,
    json: true,
    allowedMethods: ['POST'],
    alias: { uid: 'path' },
    parameters: {
        subject: new FSNodeParam('path'),
    },
}, async (req, res, next) => {
    console.log('ACTIVATED THIS ROUTE');

    if(!req.body.new_name) {
        throw APIError.create('field_missing', null, {
            key: 'new_name',
        });
    }
    if (typeof req.body.new_name !== 'string') {
        throw APIError.create('field_invalid', null, {
            key: 'new_name',
            expected: 'string',
            got: typeof req.body.new_name,
        });
    }

    // modules
    const db = req.services.get('database').get(DB_WRITE, 'filesystem');
    const mime = require('mime-types');
    const {get_app, validate_fsentry_name, id2path} = require('../../helpers.js');
    const _path = require('path');

    // new_name validation
    try{
        validate_fsentry_name(req.body.new_name)
    }catch(e){
        return res.status(400).send({
            error:{
                message: e.message
            }
        });
    }

    const { subject } = req.values;

    //get fsentry
    if ( ! await subject.exists() ) {
        throw APIError.create('subject_does_not_exist');
    }

    // Access control
    {
        const actor = Context.get('actor');
        const svc_acl = Context.get('services').get('acl');
        if ( ! await svc_acl.check(actor, subject, 'write') ) {
            throw await svc_acl.get_safe_acl_error(actor, subject, 'write');
        }
    }

    await subject.fetchEntry();
    let fsentry = subject.entry;

    // immutable
    if(fsentry.immutable){
        return res.status(400).send({
            error:{
                message: 'Immutable: cannot rename.'
            }
        })
    }

    let res1;

    // parent is root
    if(fsentry.parent_uid === null){
        try{
            res1 = await db.read(
                `SELECT uuid FROM fsentries WHERE parent_uid IS NULL AND name = ? AND id != ? LIMIT 1`,
                [
                    //name
                    req.body.new_name,
                    await subject.get('mysql-id'),
                ]);
        }catch(e){
            console.log(e)
        }
    }
    // parent is regular dir
    else{
        res1 = await db.read(
            `SELECT uuid FROM fsentries WHERE parent_uid = ? AND name = ? AND id != ? LIMIT 1`,
            [
                //parent_uid
                fsentry.parent_uid,
                //name
                req.body.new_name,
                await subject.get('mysql-id'),
            ]);
    }
    if(res1[0]){
        throw APIError.create('item_with_same_name_exists', null, {
            entry_name: req.body.new_name,
        });
    }

    const old_path = await id2path(await subject.get('mysql-id'));
    const new_path = _path.join(_path.dirname(old_path), req.body.new_name);

    // update `name`
    await db.write(
        `UPDATE fsentries SET name = ?, path = ? WHERE id = ?`,
        [req.body.new_name, new_path, await subject.get('mysql-id')]
    )

    const filesystem = req.services.get('filesystem');
    await filesystem.update_child_paths(old_path, new_path, req.user.id);

    // associated_app
    let associated_app;
    if(fsentry.associated_app_id){
        const app = await get_app({id: fsentry.associated_app_id})
        // remove some privileged information
        delete app.id;
        delete app.approved_for_listing;
        delete app.approved_for_opening_items;
        delete app.godmode;
        delete app.owner_user_id;
        // add to array
        associated_app = app;
    }else{
        associated_app = {};
    }

    // send the fsentry of the new object created
    const contentType = mime.contentType(req.body.new_name)
    const return_obj = {
        uid: req.body.uid,
        name: req.body.new_name,
        is_dir: fsentry.is_dir,
        path: new_path,
        old_path: old_path,
        type: contentType || null,
        associated_app: associated_app,
        original_client_socket_id: req.body.original_client_socket_id,
    };

    // send realtime success msg to client
    const svc_socketio = req.services.get('socketio');
    svc_socketio.send({ room: req.user.id }, 'item.renamed', return_obj);

    return res.send(return_obj);
});
