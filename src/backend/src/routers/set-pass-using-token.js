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
const express = require('express')
const router = new express.Router()
const config = require('../config')
const { invalidate_cached_user_by_id, get_user } = require('../helpers')
const { DB_WRITE } = require('../services/database/consts')

const jwt = require('jsonwebtoken');

// Ensure we don't expose branches with differing messages.
const SAFE_NEGATIVE_RESPONSE = 'This password recovery token is no longer valid.';

// -----------------------------------------------------------------------//
// POST /set-pass-using-token
// -----------------------------------------------------------------------//
router.post('/set-pass-using-token', express.json(), async (req, res, next)=>{
    // check subdomain
    if(require('../helpers').subdomain(req) !== 'api' && require('../helpers').subdomain(req) !== '')
        next();

    // modules
    const bcrypt = require('bcrypt');

    const db = req.services.get('database').get(DB_WRITE, 'auth');

    // password is required
    if(!req.body.password)
        return res.status(401).send('password is required')
    // token is required
    else if(!req.body.token)
        return res.status(401).send('token is required')
    // password must be a string
    else if(typeof req.body.password !== 'string')
        return res.status(400).send('password must be a string.')
    // check password length
    else if(req.body.password.length < config.min_pass_length)
        return res.status(400).send(`Password must be at least ${config.min_pass_length} characters long.`)

    const svc_edgeRateLimit = req.services.get('edge-rate-limit');
    if ( ! svc_edgeRateLimit.check('set-pass-using-token') ) {
        return res.status(429).send('Too many requests.');
    }

    const { token, user_uid, email } = jwt.verify(req.body.token, config.jwt_secret);

    const user = await get_user({ uuid: user_uid, force: true });
    if ( user.email !== email ) {
        return res.status(400).send(SAFE_NEGATIVE_RESPONSE);
    }

    try{
        const info = await db.write(
            'UPDATE user SET password=?, pass_recovery_token=NULL, change_email_confirm_token=NULL WHERE `uuid` = ? AND pass_recovery_token = ?',
            [await bcrypt.hash(req.body.password, 8), user_uid, token],
        );

        if ( ! info?.anyRowsAffected ) {
            return res.status(400).send(SAFE_NEGATIVE_RESPONSE);
        }

        invalidate_cached_user_by_id(req.body.user_id);

        return res.send('Password successfully updated.')
    }catch(e){
        return res.status(500).send('An internal error occured.');
    }
})

module.exports = router