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
const {uuid2fsentry, validate_signature_auth, get_url_from_req, sign_file, get_user} = require('../helpers');
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

    const writeFile_handler_api = {
        async get_dest_node () {
            if(!req.body.destination_write_url){
                res.status(400).send({
                    error:{
                        message: 'No destination specified.'
                    }
                });
                return;
            }
            try{
                validate_signature_auth(req.body.destination_write_url, 'write', {
                    uid: req.body.destination_uid,
                });
            }catch(e){
                res.status(403).send(e);
                return;
            }
            try {
                return await (new FSNodeParam('dest_path')).consolidate({
                    req, getParam: () => req.body.dest_path ?? req.body.destination_uid
                });
            } catch (e) {
                res.status(500).send('Internal Server Error');
            }
        }
    };

    const writeFile_handlers = require('./writeFile/writeFile_handlers.js');
    if ( writeFile_handlers.hasOwnProperty(req.query.operation) ) {
        console.log('\x1B[36;1mwriteFile: ' + req.query.operation + '\x1B[0m');
        const node = await (new FSNodeParam('uid')).consolidate({
            req, getParam: () => req.query.uid
        });
        const user = await get_user({id: await node.get('user_id')});
        const actor = Actor.adapt(user);

        return await Context.get().sub({ actor: Actor.adapt(user) }).arun(async () => {
            return await writeFile_handlers[req.query.operation]({
                api: writeFile_handler_api,
                req, res, actor,
                node,
            });
        });
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
