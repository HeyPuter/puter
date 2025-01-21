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
const auth = require('../middleware/auth.js');
const config = require('../config');

// -----------------------------------------------------------------------// 
// POST /removeItem
// -----------------------------------------------------------------------//
router.post('/removeItem', auth, express.json(), async (req, res, next)=>{
    // check subdomain
    if(require('../helpers').subdomain(req) !== 'api')
        next();

    // check if user is verified
    if((config.strict_email_verification_required || req.user.requires_email_confirmation) && !req.user.email_confirmed)
        return res.status(400).send({code: 'account_is_not_verified', message: 'Account is not verified'});
    
    // validation
    if(!req.body.key)
        return res.status(400).send('`key` is required');
    // check size of key, if it's too big then it's an invalid key and we don't want to waste time on it
    else if(Buffer.byteLength(req.body.key, 'utf8') > config.kv_max_key_size)
        return res.status(400).send('`key` is too long.');
    else if(!req.body.app)
        return res.status(400).send('`app` is required');

    // modules
    const db = require('../db/mysql.js');
    // get murmurhash module
    const murmurhash = require('murmurhash')
    // hash key for faster search in DB
    const key_hash = murmurhash.v3(req.body.key);

    // insert into DB
    let [kv] = await db.promise().execute(
        `DELETE FROM kv WHERE user_id=? AND app = ? AND kkey_hash = ? LIMIT 1`, 
        [
            req.user.id,
            req.body.app ?? 'global',
            key_hash,
        ]
    )

    // send results to client
    return res.send({});
})
module.exports = router