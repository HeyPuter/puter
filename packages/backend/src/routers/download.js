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
const router = express.Router();
const config = require('../config');
const axios = require('axios');
const mime = require('mime-types')
const path = require('path')
const https = require('https');
const {URL} = require('url');
const _path = require('path');
const { NodePathSelector } = require('../filesystem/node/selectors.js');
const eggspress = require('../api/eggspress.js');
const { Context } = require('../util/context');
const { HLWrite } = require('../filesystem/hl_operations/hl_write');
const FSNodeParam = require('../api/filesystem/FSNodeParam');
// TODO: eggspressify

// todo this could be abused to send get requests to any url and cause a denial of service
//
// -----------------------------------------------------------------------//
// POST /download
// -----------------------------------------------------------------------//
module.exports = eggspress('/download', {
    subdomain: 'api',
    verified: true,
    auth: true,
    fs: true,
    json: true,
    allowedMethods: ['POST'],
    parameters: {
        fsNode: new FSNodeParam('path'),
    }
}, async (req, res, next) => {
    const log = req.services.get('log-service').create('api:download');

    // check subdomain
    if(require('../helpers').subdomain(req) !== 'api')
        next();

    // socketio
    let socketio = require('../socketio.js').getio();

    // check if user is verified
    if((config.strict_email_verification_required || req.user.requires_email_confirmation) && !req.user.email_confirmed)
        return res.status(400).send({code: 'account_is_not_verified', message: 'Account is not verified'});

    // modules
    const {cp, id2path, suggest_app_for_fsentry, validate_signature_auth, is_shared_with_anyone, uuid2fsentry} = require('../helpers')
    if(!req.body.url)
        return res.status(400).send({code: 'url_is_required', message: 'URL is required'});

    // if url doesn't have a protocol, add http://
    if(!req.body.url.startsWith('http://') && !req.body.url.startsWith('https://')){
        req.body.url = 'http://' + req.body.url;
    }

    // Ensure url is not "localhost" or a private IP range
    {
        const url_obj = new URL(req.body.url);

        if ( url_obj.hostname === 'localhost' ) {
            return res.status(400).send({code: 'invalid_url', message: 'Invalid URL'});
        }

        // GitHub Copilot generated most of these
        if ( url_obj.hostname.match(/^10\./) ) {
            return res.status(400).send({code: 'invalid_url', message: 'Invalid URL'});
        }
        if ( url_obj.hostname.match(/^192\.168\./) ) {
            return res.status(400).send({code: 'invalid_url', message: 'Invalid URL'});
        }
        if ( url_obj.hostname.match(/^172\.(1[6-9]|2[0-9]|3[0-1])\./) ) {
            return res.status(400).send({code: 'invalid_url', message: 'Invalid URL'});
        }
        // github 127
        if ( url_obj.hostname.match(/^127\./) ) {
            return res.status(400).send({code: 'invalid_url', message: 'Invalid URL'});
        }
        // and 100 range for tailscale
        if ( url_obj.hostname.match(/^100\./) ) {
            return res.status(400).send({code: 'invalid_url', message: 'Invalid URL'});
        }
    }


    // check if `url` is a valid URL and then parse it
    let url_obj;
    try{
        url_obj = new URL(req.body.url);
    }catch(e){
        return res.status(400).send({code: 'invalid_url', message: 'Invalid URL'});
    }

    //--------------------------------------------------
    // Puter file
    //--------------------------------------------------
    if(url_obj.origin === config.api_base_url && url_obj.searchParams && url_obj.searchParams.get('uid') && url_obj.searchParams.get('expires') && url_obj.searchParams.get('signature')){
        // authenticate
        // validate URL signature
        try{
            validate_signature_auth(req.body.url, 'read');
        }
        catch(e){
            console.log(e)
            return res.status(403).send(e);
        }

        // get file
        const source_item = await uuid2fsentry(url_obj.searchParams.get('uid'));
        log.info('source_item', { value: source_item });
        const source_path = await id2path(source_item.id);
        let new_fsentries
        try{
            new_fsentries = await cp(source_path, req.body.path, req.user, false, true, false);
        }catch(e){
            return res.status(400).send(e)
        }
        // is_shared, dirpath, original_client_socket_id, suggested_apps,...
        if(new_fsentries.length > 0){
            for (let i = 0; i < new_fsentries.length; i++) {
                let fse = await uuid2fsentry(new_fsentries[i].uid);
                new_fsentries[i].is_shared   = await is_shared_with_anyone(fse.id);
                new_fsentries[i].dirpath   = _path.dirname(new_fsentries[i].path);
                new_fsentries[i].original_client_socket_id   = req.body.original_client_socket_id;
                new_fsentries[i].suggested_apps = await suggest_app_for_fsentry(fse, {user: req.user});

                // associated_app
                if(new_fsentries[i].associated_app_id){
                    const app = await get_app({id: new_fsentries[i].associated_app_id})
                    // remove some privileged information
                    delete app.id;
                    delete app.approved_for_listing;
                    delete app.approved_for_opening_items;
                    delete app.godmode;
                    delete app.owner_user_id;
                    // add to array
                    new_fsentries[i].associated_app = app;
                }else{
                    new_fsentries[i].associated_app = {};
                }

                // send realtime msg to client
                if(socketio){
                    socketio.to(req.user.id).emit('item.added', new_fsentries[i])
                }
            }
        }

        return res.status(200).send(new_fsentries);
    }

    //--------------------------------------------------
    // non-Puter file
    //--------------------------------------------------

    // disable axios ssl verification when in dev env and the url is from the local Puter API
    let axios_instance;
    if(config.env === 'dev' && url_obj.origin === config.api_base_url){
        axios_instance = axios.create({
            httpsAgent: new https.Agent({
              rejectUnauthorized: false
            })
        });
    }else{
        axios_instance = axios;
    }

    // todo if there is a way to get the file size without downloading the whole file, do that and then check if user has enough space

    // get file
    let file;
    try{
        // old implementation using buffer
        file = await axios_instance.get(req.body.url, {responseType: 'arraybuffer', onDownloadProgress: (progressEvent) => {
            if(req.body.socket_id){
                socketio.to(req.body.socket_id).emit('download.progress', {
                    loaded: progressEvent.loaded,
                    total: progressEvent.total * 2,
                    operation_id: req.body.operation_id,
                    item_upload_id: req.body.item_upload_id,
                    original_client_socket_id: req.body.original_client_socket_id,
                });
            }
        }})
    }catch(error){
        console.log(error)
        return res.status(500).send({message: error.message});
    }

    file.buffer = file.data;

    // get file type
    await (async () => {
        const { fileTypeFromBuffer } = await import('file-type');
        const type = await fileTypeFromBuffer(file.buffer);
        // set file type
        if(type)
            file.type = type.mime;
        else
            file.type = 'application/octet-stream';
    })();


    // get file name
    let filename;

    // extract file name from url
    if(!req.body.name){
        filename = req.body.name ?? req.body.url.split('/').pop().split('#')[0].split('?')[0];
        // extension?
        if(!path.extname(filename)){
            // get extension from mime type
            const ext = mime.extension(file.type);
            // add extension to filename
            if(ext)
                filename += '.' + ext;
        }
    }else
        filename = req.body.name;

    // Setup metadata in context
    {
        const x = Context.get();
        const operationTraceSvc = x.get('services').get('operationTrace');
        const frame = (await operationTraceSvc.add_frame('api:/download'))
            .attr('gui_metadata', {
                original_client_socket_id: req.body.original_client_socket_id,
                socket_id: req.body.socket_id,
                operation_id: req.body.operation_id,
                item_upload_id: req.body.item_upload_id,
                user_id: req.user.id,
            })
            ;
        x.set(operationTraceSvc.ckey('frame'), frame);
    }

    // write file
    try{
        const dirNode = req.values.fsNode;
        const hl_write = new HLWrite();
        const response = await hl_write.run({
            destination_or_parent: dirNode,
            specified_name: filename,
            overwrite: false,
            dedupe_name: req.body.dedupe_name,

            user: req.user,
            file: file,
        });
        return res.send(response);
    }catch(error){
        console.log(error)
        return res.contentType('application/json').status(500).send(error);
    }
});
