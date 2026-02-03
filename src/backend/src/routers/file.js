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
'use strict';
const express = require('express');
const router = new express.Router();
const { subdomain, validate_signature_auth, get_url_from_req, get_descendants, id2path, get_user, sign_file } = require('../helpers');
const { DB_WRITE } = require('../services/database/consts');
const { UserActorType } = require('../services/auth/Actor');
const { Actor } = require('../services/auth/Actor');
const { LLRead } = require('../filesystem/ll_operations/ll_read');
const { NodeRawEntrySelector } = require('../filesystem/node/selectors');

// -----------------------------------------------------------------------//
// GET /file
// -----------------------------------------------------------------------//
router.get('/file', async (req, res, next) => {
    // services and "services"
    /** @type {import('../services/MeteringService/MeteringService').MeteringService} */
    const meteringService = req.services.get('meteringService').meteringService;
    const log = req.services.get('log-service').create('/file');
    const errors = req.services.get('error-service').create(log);
    const db = req.services.get('database').get(DB_WRITE, 'filesystem');

    // check subdomain
    if ( subdomain(req) !== 'api' ) {
        next();
    }

    // validate URL signature
    try {
        validate_signature_auth(get_url_from_req(req), 'read');
    } catch (e) {
        console.log(e);
        return res.status(403).send(e);
    }

    let can_write = false;
    try {
        validate_signature_auth(get_url_from_req(req), 'write');
        can_write = true;
    } catch ( _e ) {
        // slent fail
    }

    // modules
    const uid = req.query.uid;
    let download = req.query.download ?? false;
    if ( download === 'true' || download === '1' || download === true ) {
        download = true;
    }

    // retrieve FSEntry from db
    const fsentry = await db.read('SELECT * FROM fsentries WHERE uuid = ? LIMIT 1', [uid]);

    // FSEntry not found
    if ( ! fsentry[0] )
    {
        return res.status(400).send({ message: 'No entry found with this uid' });
    }

    // check if item owner is suspended
    const user = await get_user({ id: fsentry[0].user_id });
    if ( user.suspended )
    {
        return res.status(401).send({ error: 'Account suspended' });
    }

    // ---------------------------------------------------------------//
    // FSEntry is dir
    // ---------------------------------------------------------------//
    if ( fsentry[0].is_dir ) {
        // convert to path
        const dirpath = await id2path(fsentry[0].id);
        // get all children of this dir
        const children = await get_descendants(dirpath, await get_user({ id: fsentry[0].user_id }), 1);
        const signed_children = [];
        if ( children.length > 0 ) {
            for ( const child of children ) {
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
    if ( download ) {
        res.attachment(fsentry[0].name);
    }

    // record fsentry owner
    res.resource_owner = fsentry[0].user_id;

    // try to deduce content-type
    const contentType = 'application/octet-stream';

    // update `accessed`
    db.write('UPDATE fsentries SET accessed = ? WHERE `id` = ?',
                    [Date.now() / 1000, fsentry[0].id]);

    const range = req.headers.range;
    const ownerActor =  new Actor({
        type: new UserActorType({
            user: user,
        }),
    });
    const fileSize = fsentry[0].size;

    res.setHeader('Accept-Ranges', 'bytes');

    const parseRangeHeader = (rangeHeader) => {
        // Check if this is a multipart range request
        if ( rangeHeader.includes(',') ) {
            // For now, we'll only serve the first range in multipart requests
            // as the underlying storage layer doesn't support multipart responses
            const firstRange = rangeHeader.split(',')[0].trim();
            const matches = firstRange.match(/bytes=(\d+)-(\d*)/);
            if ( ! matches ) return null;

            const start = parseInt(matches[1], 10);
            const end = matches[2] ? parseInt(matches[2], 10) : null;

            return { start, end, isMultipart: true };
        }

        // Single range request
        const matches = rangeHeader.match(/bytes=(\d+)-(\d*)/);
        if ( ! matches ) return null;

        const start = parseInt(matches[1], 10);
        const end = matches[2] ? parseInt(matches[2], 10) : null;

        return { start, end, isMultipart: false };
    };

    //--------------------------------------------------
    // Range
    //--------------------------------------------------
    if ( range ) {
        res.status(206);
        const rangeInfo = parseRangeHeader(req.headers['range']);
        if ( rangeInfo ) {
            const { start, end, isMultipart } = rangeInfo;

            // For open-ended ranges, we need to calculate the actual end byte
            let actualEnd = end;
            let fileSize = null;

            try {
                fileSize = fsentry[0].size;
                if ( end === null ) {
                    actualEnd = fileSize - 1; // File size is 1-based, end byte is 0-based
                }
            } catch (e) {
                // If we can't get file size, we'll let the storage layer handle it
                // and not set Content-Range header
                actualEnd = null;
                fileSize = null;
            }

            if ( actualEnd !== null ) {
                const totalSize = fileSize !== null ? fileSize : '*';
                const contentRange = `bytes ${start}-${actualEnd}/${totalSize}`;
                res.set('Content-Range', contentRange);
            }

            // If this was a multipart request, modify the range header to only include the first range
            if ( isMultipart ) {
                req.headers['range'] = end !== null
                    ? `bytes=${start}-${end}`
                    : `bytes=${start}-`;
            }
        }
    }

    //--------------------------------------------------
    // No range
    //--------------------------------------------------
    // set content-type, if available
    if ( contentType !== null ) {
        res.setHeader('Content-Type', contentType);
    }

    const svc_filesystem = req.services.get('filesystem');

    // stream data from S3
    try {
        /* eslint-disable */
        const fsNode = await svc_filesystem.node(
            new NodeRawEntrySelector(fsentry[0]),
        );
        /* eslint-enable */
        const ll_read = new LLRead();
        const stream = await ll_read.run({
            range,
            no_acl: true,
            actor: req.actor ?? ownerActor,
            fsNode,
        });

        return stream.pipe(res);
    } catch (e) {
        errors.report('read from storage', {
            source: e,
            trace: true,
            alarm: true,
        });
        return res.type('application/json').status(500).send({ message: 'There was an internal problem reading the file.' });
    }
});

module.exports = router;
