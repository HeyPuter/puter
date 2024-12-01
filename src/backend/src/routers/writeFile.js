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
const express = require('express');
const {uuid2fsentry, validate_signature_auth, get_url_from_req, sign_file} = require('../helpers');
const fs = require('../middleware/fs.js');
const { NodePathSelector, NodeUIDSelector } = require('../filesystem/node/selectors');
const eggspress = require('../api/eggspress');
const { HLWrite } = require('../filesystem/hl_operations/hl_write');
const { TYPE_DIRECTORY } = require('../filesystem/FSNodeContext');
const { Context } = require('../util/context');
const { Actor } = require('../services/auth/Actor');
const { DB_WRITE } = require('../services/database/consts');
const FSNodeParam = require('../api/filesystem/FSNodeParam');
const { HLMove } = require('../filesystem/hl_operations/hl_move');
const { HLCopy } = require('../filesystem/hl_operations/hl_copy');
const { HLMkdir } = require('../filesystem/hl_operations/hl_mkdir');
const { HLRemove } = require('../filesystem/hl_operations/hl_remove');

// TODO: eggspressify

// -----------------------------------------------------------------------//
// POST /writeFile
// -----------------------------------------------------------------------//
module.exports = eggspress('/writeFile', {
    fs: true,
    files: ['file'],
    allowedMethods: ['POST'],
}, async (req, res, next) => {
    // check subdomain
    if(require('../helpers').subdomain(req) !== 'api')
        next();

    const log = req.services.get('log-service').create('writeFile');
    const errors = req.services.get('error-service').create(log);

    // validate URL signature
    try{
        validate_signature_auth(get_url_from_req(req), 'write');
    }
    catch(e){
        return res.status(403).send(e);
    }

    log.info('writeFile context: ' + (
        Context.get(undefined, { allow_fallback: true })
    ).describe())
    log.info('writeFile req context: ' + res.locals.ctx?.describe?.());

    // Get fsentry
    // todo this is done again in the following section, super inefficient
    let requested_item = await uuid2fsentry(req.query.uid);

    if ( ! requested_item ) {
        return res.status(404).send({ error: 'Item not found' });
    }

    // check if requested_item owner is suspended
    const owner_user = await require('../helpers').get_user({id: requested_item.user_id});

    if ( ! owner_user ) {
        errors.report('writeFile_no_owner', {
            message: `User not found: ${requested_item.user_id}`,
            trace: true,
            alarm: true,
            extra: {
                requested_item,
                body: req.body,
                query: req.query,
            }
        })

        return res.status(500).send({ error: 'User not found' });
    }

    if(owner_user.suspended)
        return res.status(401).send({error: 'Account suspended'});

    const db = req.services.get('database').get(DB_WRITE, 'filesystem');

    // -----------------------------------------------------------------------//
    // move
    // -----------------------------------------------------------------------//
    if(req.query.operation && req.query.operation === 'move'){
        console.log(req.body)
        const { get_user } = require('../helpers')
        const _path = require('path');
        const mime = require('mime-types');

        // check if destination_write_url provided
        if(!req.body.destination_write_url){
            return res.status(400).send({
                error:{
                    message: 'No destination specified.'
                }
            })
        }

        // check if destination_write_url is valid
        try{
            validate_signature_auth(req.body.destination_write_url, 'write');
        }catch(e){
            return res.status(403).send(e);
        }

        try{
            const hl_move = new HLMove();

            // TODO: [fs:operation:param-coercion]
            const source_node = await (new FSNodeParam('uid')).consolidate({
                req, getParam: () => req.query.uid
            });

            // TODO: [fs:operation:param-coercion]
            const dest_node = await (new FSNodeParam('dest_path')).consolidate({
                req, getParam: () => req.body.dest_path ?? req.body.destination_uid
            });

            const user = await get_user({id: await source_node.get('user_id')});

            const opts = {
                // TODO: [fs:normalize-writeFile-user]
                user,
                source: source_node,
                destination_or_parent: dest_node,
                overwrite: req.body.overwrite ?? false,
                new_name: req.body.new_name,
                new_metadata: req.body.new_metadata,
                create_missing_parents: req.body.create_missing_parents,
            };

            // TODO: [fs:DRY-writeFile-context]
            const r = await Context.get().sub({ actor: Actor.adapt(user) }).arun(async () => {
                return await hl_move.run({
                    ...opts,
                    actor: Context.get('actor'),
                });
            });

            return res.send({
                ...r.moved,
                old_path: r.old_path,
                new_path: r.moved.path,
            });
        }catch(e){
            console.log(e)
            return res.status(400).send(e)
        }
    }

    // -----------------------------------------------------------------------//
    // copy
    // -----------------------------------------------------------------------//
    else if(req.query.operation && req.query.operation === 'copy'){
        const {is_shared_with_anyone, suggest_app_for_fsentry, cp, validate_fsentry_name, convert_path_to_fsentry, uuid2fsentry, get_user, id2path, id2uuid} = require('../helpers')
        const _path = require('path');
        const mime = require('mime-types');

        // check if destination_write_url provided
        if(!req.body.destination_write_url){
            return res.status(400).send({
                error:{
                    message: 'No destination specified.'
                }
            })
        }

        // check if destination_write_url is valid
        try{
            validate_signature_auth(req.body.destination_write_url, 'write');
        }catch(e){
            return res.status(403).send(e);
        }

        const overwrite      = req.body.overwrite ?? false;
        const change_name    = req.body.auto_rename ?? false;

        // TODO: [fs:operation:param-coercion]
        const source_node = await (new FSNodeParam('uid')).consolidate({
            req, getParam: () => req.query.uid
        });

        // TODO: [fs:operation:param-coercion]
        const dest_node = await (new FSNodeParam('dest_path')).consolidate({
            req, getParam: () => req.body.dest_path ?? req.body.destination_uid
        });

        // Get user
        let user = await get_user({id: await source_node.get('user_id')});

        const opts = {
            source: source_node,
            destination_or_parent: dest_node,
            dedupe_name: change_name,
            overwrite,
            user,
        };

        let new_fsentries
        try{
            const hl_copy = new HLCopy();

            const r = await Context.get().sub({ actor: Actor.adapt(user) }).arun(async () => {
                return await hl_copy.run({
                    ...opts,
                    actor: Context.get('actor'),
                });
            });
            return res.send([r]);
        }catch(e){
            console.log(e)
            return res.status(400).send(e)
        }
    }

    // -----------------------------------------------------------------------//
    // mkdir
    // -----------------------------------------------------------------------//
    else if(req.query.operation && req.query.operation === 'mkdir'){
        const {mkdir, uuid2fsentry, get_user, id2path} = require('../helpers')

        // name is required
        if(!req.body.name){
            return res.status(400).send({
                error:{
                    message: 'Name is required.'
                }
            })
        }

        // TODO: [fs:operation:param-coercion]
        const source_node = await (new FSNodeParam('uid')).consolidate({
            req, getParam: () => req.query.uid
        });


        // Get user
        let user = await get_user({id: await source_node.get('user_id')});

        // Create new dir and return
        try{
            // TODO: [fs:remove-old-methods]
            const hl_mkdir = new HLMkdir();
            const r = await Context.get().sub({ actor: Actor.adapt(user) }).arun(async () => {
                return await hl_mkdir.run({
                    parent: source_node,
                    path: req.body.name,
                    overwrite: false,
                    dedupe_name: req.body.dedupe_name ?? false,
                    user,
                    actor: Context.get('actor'),
                });
            });
            const newdir_node = await req.fs.node(new NodeUIDSelector(r.uid));
            return res.send(await sign_file(
                await newdir_node.get('entry'), 'write'));
        }catch(e){
            console.log(e)
            return res.status(400).send(e);
        }
    }

    // -----------------------------------------------------------------------//
    // Trash
    // -----------------------------------------------------------------------//
    if(req.query.operation && req.query.operation === 'trash'){
        const {validate_fsentry_name, convert_path_to_fsentry, uuid2fsentry, get_user, id2path, id2uuid} = require('../helpers')
        const _path = require('path');
        const mime = require('mime-types');

        // Get fsentry
        const fs = req.services.get('filesystem');

        // TODO: [fs:move-FSNodeParam]
        const node = await (new FSNodeParam('path')).consolidate({
            req, getParam: () => req.query.uid
        });

        // Get user
        // TODO: [avoid-database-user-id]
        let user = await get_user({id: await node.get('user_id')});

        // metadata for trashed file
        const new_name = await node.get('uid');
        const metadata = {
            original_name: await node.get('name'),
            original_path: await node.get('path'),
            trashed_ts: Math.round(Date.now() / 1000),
        };

        // Get Trash fsentry
        const trash = await fs.node(
            new NodePathSelector('/' + user.username + '/Trash')
        );
        // let trash_path = '/' + user.username + '/Trash';
        // let trash = await convert_path_to_fsentry(trash_path);

        console.log('what is trash?', trash);

        const hl_move = new HLMove();
        await Context.get().sub({ actor: Actor.adapt(user) }).arun(async () => {
            await hl_move.run({
                source: node,
                destination_or_parent: trash,
                // TODO: [fs:decouple-user]
                user,
                actor: Context.get('actor'),
                new_name: new_name,
                new_metadata: metadata,
            });
        });

        // No Trash?
        if(!trash){
            return res.status(400).send({
                error:{
                    message: 'No Trash directory found.'
                }
            })
        }

        return res.status(200).send({
            message: 'Item trashed'
        })
    }
    // -----------------------------------------------------------------------//
    // Rename
    // -----------------------------------------------------------------------//
    if(req.query.operation && req.query.operation === 'rename'){
        const {validate_fsentry_name, uuid2fsentry, get_app, id2path} = require('../helpers')
        const _path = require('path');
        const mime = require('mime-types');

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

        // Get fsentry
        let fsentry = await uuid2fsentry(req.query.uid);

        // Not found
        if(fsentry === false){
            return res.status(400).send({
                error:{
                    message: 'No entry found with this uid'
                }
            })
        }

        // Immutable?
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
                        fsentry.id,
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
                    fsentry.id,
                ]);
        }
        if(res1[0]){
            return res.status(400).send({
                error:{
                    message: 'An entry with the same name exists under target path.'
                }
            })
        }

        // old path
        const old_path = await id2path(fsentry.id);

        // update `name`
        await db.write(
            `UPDATE fsentries SET name = ? WHERE id = ?`,
            [req.body.new_name, fsentry.id]
        )

        // new path
        const new_path = _path.join(_path.dirname(old_path), req.body.new_name);

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
            uid: fsentry.uuid,
            name: req.body.new_name,
            is_dir: fsentry.is_dir,
            path: new_path,
            old_path: old_path,
            type: contentType ? contentType : null,
            associated_app: associated_app,
            original_client_socket_id: req.body.original_client_socket_id,
        };

        // send realtime success msg to client
        let socketio = require('../socketio.js').getio();
        if(socketio){
            socketio.to(fsentry.user_id).emit('item.renamed', return_obj)
        }

        return res.send(return_obj);
    }

    // -----------------------------------------------------------------------//
    // Delete
    // -----------------------------------------------------------------------//
    if(req.query.operation && req.query.operation === 'delete'){
        const {get_user, uuid2fsentry, id2path} = require('../helpers')
        const _path = require('path');
        const mime = require('mime-types');

        // TODO: [fs:operation:param-coercion]
        const source_node = await (new FSNodeParam('uid')).consolidate({
            req, getParam: () => req.query.uid
        });

        const user = await get_user({id: await source_node.get('user_id')});

        // Delete
        try{
            const hl_remove = new HLRemove();
            await Context.get().sub({ actor: Actor.adapt(user) }).arun(async () => {
                await hl_remove.run({
                    target: source_node,
                    user,
                    actor: Context.get('actor'),
                });
            });
        }catch(error){
            console.log(error)
            res.status(400).send(error);
        }

        // Send success msg
        return res.send();
    }

    // -----------------------------------------------------------------------//
    // Write
    // -----------------------------------------------------------------------//
    else{
        // modules
        const {uuid2fsentry, id2path} = require('../helpers')
        const _path = require('path');

        // Check if files were uploaded
        if(!req.files)
            return res.status(400).send('No files uploaded');

        // Get fsentry
        let fsentry, dirname;
        let node;

        try{
            node = await req.fs.node(new NodeUIDSelector(req.query.uid));
            dirname = (await node.get('type') !== TYPE_DIRECTORY
                ? _path.dirname.bind(_path) : a=>a)(await node.get('path'));
        }catch(e){
            console.log(e)
            req.__error_source = e;
            return res.status(500).send(e);
        }

        const user = await (async () => {
            const { get_user } = require('../helpers');
            const user_id = await node.get('user_id')
            return await get_user({ id: user_id });
        })();
        Context.set('user', user);

        const dirNode = await req.fs.node(new NodePathSelector(dirname));

        const actor = Actor.adapt(user);

        const context = Context.get().sub({
            actor, user,
        });

        log.noticeme('writeFile: ' + context.describe());

        // Upload files one by one
        const returns = [];
        for ( const uploaded_file of req.files ) {
            try{
                await context.arun(async () => {
                    const hl_write = new HLWrite();
                    const ret_obj = await hl_write.run({
                        destination_or_parent: dirNode,
                        specified_name: await node.get('type') === TYPE_DIRECTORY
                            ? req.body.name : await node.get('name'),
                        fallback_name: uploaded_file.originalname,
                        overwrite: true,
                        user: user,
                        actor,

                        file: uploaded_file,
                    });

                    // add signature to object
                    ret_obj.signature = await sign_file(ret_obj, 'write');

                    // send results back to app
                    returns.push(ret_obj);
                });
            }catch(error){
                req.__error_source = error;
                console.log(error)
                return res.contentType('application/json').status(500).send(error);
            }
        }

        if ( returns.length === 1 ) {
            return res.send(returns[0]);
        }

        return res.send(returns);
    }
});
