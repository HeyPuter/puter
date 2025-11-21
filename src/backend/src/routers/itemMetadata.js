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
const router = express.Router();
const { validate_signature_auth, get_url_from_req, is_valid_uuid4, get_dir_size, id2path } = require('../helpers');
const { DB_READ } = require('../services/database/consts');

// -----------------------------------------------------------------------//
// GET /itemMetadata
// -----------------------------------------------------------------------//
router.get('/itemMetadata', async (req, res, next) => {
    // Check subdomain
    if ( require('../helpers').subdomain(req) !== 'api' )
    {
        next();
    }

    // Validate URL signature
    try {
        validate_signature_auth(get_url_from_req(req), 'read');
    }
    catch (e) {
        console.log(e);
        return res.status(403).send(e);
    }

    // Validation
    if ( ! req.query.uid )
    {
        return res.status(400).send('`uid` is required');
    }
    // uid must be a string
    else if ( req.query.uid && typeof req.query.uid !== 'string' )
    {
        return res.status(400).send('uid must be a string.');
    }
    // uid cannot be empty
    else if ( req.query.uid && req.query.uid.trim() === '' )
    {
        return res.status(400).send('uid cannot be empty');
    }
    // uid must be a valid uuid
    else if ( ! is_valid_uuid4(req.query.uid) )
    {
        return res.status(400).send('uid must be a valid uuid');
    }

    // modules
    const { uuid2fsentry } = require('../helpers');

    const uid = req.query.uid;

    const item = await uuid2fsentry(uid);

    // check if item owner is suspended
    const user = await require('../helpers').get_user({ id: item.user_id });

    if ( ! user ) {
        return res.status(400).send('User not found');
    }

    if ( user.suspended )
    {
        return res.status(401).send({ error: 'Account suspended' });
    }

    if ( ! item )
    {
        return res.status(400).send('Item not found');
    }

    const mime = require('mime-types');
    const contentType = mime.contentType(res.name);

    const itemMetadata = {
        uid: item.uuid,
        name: item.name,
        is_dir: item.is_dir,
        type: contentType,
        size: item.is_dir ? await get_dir_size(await id2path(item.id), user) : item.size,
        created: item.created,
        modified: item.modified,
    };

    // ---------------------------------------------------------------//
    // return_path
    // ---------------------------------------------------------------//
    if ( req.query.return_path === 'true' || req.query.return_path === '1' ) {
        const { id2path } = require('../helpers');
        itemMetadata.path = await id2path(item.id);
    }
    // ---------------------------------------------------------------//
    // Versions
    // ---------------------------------------------------------------//
    if ( req.query.return_versions ) {
        const db = req.services.get('database').get(DB_READ, 'itemMetadata.js');
        itemMetadata.versions = [];

        let versions = await db.read('SELECT * FROM fsentry_versions WHERE fsentry_id = ?',
                        [item.id]);
        if ( versions.length > 0 ) {
            for ( let index = 0; index < versions.length; index++ ) {
                const version = versions[index];
                itemMetadata.versions.push({
                    id: version.version_id,
                    message: version.message,
                    timestamp: version.ts_epoch,
                });
            }
        }
    }

    return res.send(itemMetadata);
});

module.exports = router;