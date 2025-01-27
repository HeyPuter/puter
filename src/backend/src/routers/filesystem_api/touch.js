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
const router = express.Router();
const auth = require('../../middleware/auth.js');
const config = require('../../config.js');
const { DB_WRITE } = require('../../services/database/consts.js');

// -----------------------------------------------------------------------//
// POST /touch
// -----------------------------------------------------------------------//
router.post('/touch', auth, express.json(), async (req, res, next)=>{
    // check subdomain
    if(require('../../helpers.js').subdomain(req) !== 'api')
        next();

    // check if user is verified
    if((config.strict_email_verification_required || req.user.requires_email_confirmation) && !req.user.email_confirmed)
        return res.status(400).send({code: 'account_is_not_verified', message: 'Account is not verified'});

    const db = req.services.get('database').get(DB_WRITE, 'filesystem');
    const { v4: uuidv4 } = require('uuid');
    const _path = require('path');
    const {convert_path_to_fsentry, validate_fsentry_name, chkperm} = require('../../helpers.js');

    // validation
    if(req.body.path === undefined)
        return res.status(400).send('path is required');
    // path must be a string
    else if (typeof req.body.path !== 'string')
        return res.status(400).send('path must be a string.');
    else if(req.body.path.trim() === '')
        return res.status(400).send('path cannot be empty');

    const dirpath               = _path.dirname(_path.resolve('/', req.body.path))
    const target_name           = _path.basename(_path.resolve('/', req.body.path))
    const set_accessed_to_now   = req.body.set_accessed_to_now
    const set_modified_to_now   = req.body.set_modified_to_now

    // cannot touch in root
    if(dirpath === '/')
        return res.status(400).send('Can not touch in root.')

    // name validation
    try{
        validate_fsentry_name(target_name)
    }catch(e){
        return res.status(400).send(e);
    }

    // convert dirpath to its fsentry
    const parent = await convert_path_to_fsentry(dirpath);

    // dirpath not found
    if(parent === false)
        return res.status(400).send("Target path not found");

    // check permission
    if(!await chkperm(parent, req.user.id, 'write'))
        return res.status(403).send({ code:`forbidden`, message: `permission denied.`})

    // check if a FSEntry with the same name exists under this path
    const existing_fsentry = await convert_path_to_fsentry(_path.resolve('/', dirpath + '/' + target_name))

    // current epoch
    const ts = Date.now() / 1000;

    // set_accessed_to_now
    if(set_accessed_to_now){
        await db.write(
            `INSERT INTO fsentries
            (uuid, parent_uid, user_id, name,    is_dir, created, modified, size) VALUES
            (   ?,          ?,       ?,        ?,     false,       ?,        ?,    0)
            ON DUPLICATE KEY UPDATE accessed=?`,
            [
                //uuid
                (existing_fsentry !== false) ? existing_fsentry.uuid : uuidv4(),
                //parent_uid
                (parent === null) ? null : parent.uuid,
                //user_id
                parent === null ? req.user.id : parent.user_id,
                //name
                target_name,
                //created
                ts,
                //modified
                ts,
                //accessed
                ts
            ]
        );
    }
    // set_modified_to_now
    else if(set_modified_to_now){
        await db.write(
            `INSERT INTO fsentries
            (uuid, parent_uid, user_id, name,    is_dir, created, modified, size) VALUES
            (   ?,          ?,       ?,        ?,     false,       ?,        ?,    0)
            ON DUPLICATE KEY UPDATE modified=?`,
            [
                //uuid
                (existing_fsentry !== false) ? existing_fsentry.uuid : uuidv4(),
                //parent_uid
                (parent === null) ? null : parent.uuid,
                //user_id
                parent === null ? req.user.id : parent.user_id,
                //name
                target_name,
                //created
                ts,
                //modified
                ts,
                //modified
                ts
            ]
        );
    }else{
        await db.write(
            `INSERT INTO fsentries
            (uuid, parent_uid, user_id, name,    is_dir, created, modified, size) VALUES
            (   ?,          ?,       ?,        ?,     false,       ?,        ?,    0)
            ON DUPLICATE KEY UPDATE accessed=?, modified=?, created=?`,
            [
                //uuid
                (existing_fsentry !== false) ? existing_fsentry.uuid : uuidv4(),
                //parent_uid
                (parent === null) ? null : parent.uuid,
                //user_id
                parent === null ? req.user.id : parent.user_id,
                //name
                target_name,
                //created
                ts,
                //modified
                ts,
                //accessed
                ts,
                //modified
                ts,
                //created
                ts,
            ]
        );
    }
    return res.send('')
})

module.exports = router