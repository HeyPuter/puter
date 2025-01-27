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
const express = require('express');
const router = new express.Router();
const {validate_signature_auth, get_url_from_req, get_descendants, id2path, get_user, sign_file} = require('../helpers');
const { DB_WRITE } = require('../services/database/consts');
const { Context } = require('../util/context');

// -----------------------------------------------------------------------//
// GET /file
// -----------------------------------------------------------------------//
router.get('/file', async (req, res, next)=>{
    // check subdomain
    if(require('../helpers').subdomain(req) !== 'api')
        next();

    // validate URL signature
    try{
        validate_signature_auth(get_url_from_req(req), 'read');
    }
    catch(e){
        console.log(e)
        return res.status(403).send(e);
    }
    
    let can_write = false;
    try{
        validate_signature_auth(get_url_from_req(req), 'write');
        can_write = true;
    }catch(e){}

    const log = req.services.get('log-service').create('/file');
    const errors = req.services.get('error-service').create(log);


    // modules
    const db = req.services.get('database').get(DB_WRITE, 'filesystem');
    const mime = require('mime-types')

    const uid = req.query.uid;
    let download = req.query.download ?? false;
    if(download === 'true' || download === '1' || download === true)
        download = true;

    // retrieve FSEntry from db
    const fsentry = await db.read(
        `SELECT * FROM fsentries WHERE uuid = ? LIMIT 1`, [uid]
    );

    // FSEntry not found
    if(!fsentry[0])
        return res.status(400).send({message: 'No entry found with this uid'})

    // check if item owner is suspended
    const user = await get_user({id: fsentry[0].user_id});
    if(user.suspended)
        return res.status(401).send({error: 'Account suspended'});

    // ---------------------------------------------------------------//
    // FSEntry is dir
    // ---------------------------------------------------------------//
    if(fsentry[0].is_dir){
        // convert to path
        const dirpath = await id2path(fsentry[0].id);
        console.log(dirpath, fsentry[0].user_id)
        // get all children of this dir
        const children = await get_descendants(dirpath, await get_user({id: fsentry[0].user_id}), 1);
        const signed_children = [];
        if(children.length>0){
            for(const child of children){
                // sign file
                const signed_child = await sign_file(child,
                    can_write ? 'write' : 'read');
                signed_children.push(signed_child);
            }
        }
        // send to client
        return res.send(signed_children);
    }

    // force download?
    if(download)
        res.attachment(fsentry[0].name);

    // record fsentry owner
    res.resource_owner = fsentry[0].user_id;

    // try to deduce content-type
    const contentType = "application/octet-stream";

    // update `accessed`
    db.write(
        "UPDATE fsentries SET accessed = ? WHERE `id` = ?",
        [Date.now()/1000, fsentry[0].id]
    );

    const range = req.headers.range;
    //--------------------------------------------------
    // No range
    //--------------------------------------------------
    if (!range) {
        // set content-type, if available
        if(contentType !== null)
            res.setHeader('Content-Type', contentType);

        const storage = req.ctx.get('storage');

        // stream data from S3
        try{
            let stream = await storage.create_read_stream(fsentry[0].uuid, {
                bucket: fsentry[0].bucket,
                bucket_region: fsentry[0].bucket_region,
            });
            return stream.pipe(res);
        }catch(e){
            errors.report('read from storage', {
                source: e,
                trace: true,
                alarm: true,
            });
            return res.type('application/json').status(500).send({message: 'There was an internal problem reading the file.'});
        }
    }
    //--------------------------------------------------
    // Range
    //--------------------------------------------------
    else{
        // get file size
        const file_size = fsentry[0].size;
        const total = fsentry[0].size;
        const user_agent = req.get('User-Agent');

        let start, end, CHUNK_SIZE = 5000000;
        let is_safari = false;

        // Parse range header
        var parts = range.replace(/bytes=/, "").split("-");
        var partialstart = parts[0];
        var partialend = parts[1];

        start = parseInt(partialstart, 10);
        end = partialend ? parseInt(partialend, 10) : total-1;

        // Safari
        if(user_agent && user_agent.toLowerCase().includes('safari') && !user_agent.includes('Chrome')){
            is_safari = true;
            CHUNK_SIZE = (end-start)+1;
        }
        // All other user agents
        else{
            end = Math.min(start + CHUNK_SIZE, file_size - 1);
        }

        // Create headers
        const headers = {
            "Content-Range": `bytes ${start}-${end}/${file_size}`,
            "Accept-Ranges": "bytes",
            "Content-Length": is_safari ? CHUNK_SIZE : (end-start+1),
        };

        // Set Content-Type, if available
        if(contentType)
            headers["Content-Type"] = contentType;

        // HTTP Status 206 for Partial Content
        res.writeHead(206, headers);

        try{
            const storage = Context.get('storage');
            let stream = await storage.create_read_stream(fsentry[0].uuid, {
                bucket: fsentry[0].bucket,
                bucket_region: fsentry[0].bucket_region,
            });
            return stream.pipe(res);
        }catch(e){
            errors.report('read from storage', {
                source: e,
                trace: true,
                alarm: true,
            });
            return res.type('application/json').status(500).send({message: 'There was an internal problem reading the file.'});
        }
    }
})

module.exports = router
