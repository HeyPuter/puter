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
"use strict"
const {uuid2fsentry, validate_signature_auth, get_url_from_req, get_user} = require('../helpers');
const eggspress = require('../api/eggspress');
const { Context } = require('../util/context');
const { Actor } = require('../services/auth/Actor');
const FSNodeParam = require('../api/filesystem/FSNodeParam');

// TODO: eggspressify

// -----------------------------------------------------------------------//
// POST /writeFile
// -----------------------------------------------------------------------//
module.exports = eggspress('/writeFile', {
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
    
    let operation = req.query.operation ?? 'write';
    // Responding with an error here would typically be better,
    // but it would cause a regression for apps.
    if ( ! writeFile_handlers.hasOwnProperty(operation) ) {
        operation = 'write';
    }

    console.log('\x1B[36;1mwriteFile: ' + req.query.operation + '\x1B[0m');
    const node = await (new FSNodeParam('uid')).consolidate({
        req, getParam: () => req.query.uid
    });
    const user = await get_user({id: await node.get('user_id')});
    const actor = Actor.adapt(user);

    return await Context.get().sub({
        actor: Actor.adapt(user), user,
    }).arun(async () => {
        return await writeFile_handlers[operation]({
            api: writeFile_handler_api,
            req, res, actor,
            node,
        });
    });
});
