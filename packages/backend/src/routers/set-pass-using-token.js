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
const express = require('express')
const router = new express.Router()
const config = require('../config')
const { invalidate_cached_user_by_id } = require('../helpers')
const { DB_WRITE } = require('../services/database/consts')

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
    // user_id is required
    else if(!req.body.user_id)
        return res.status(401).send('user_id is required')
    // token is required
    else if(!req.body.token)
        return res.status(401).send('token is required')
    // password must be a string
    else if(typeof req.body.password !== 'string')
        return res.status(400).send('password must be a string.')
    // check password length
    else if(req.body.password.length < config.min_pass_length)
        return res.status(400).send(`Password must be at least ${config.min_pass_length} characters long.`)

    try{
        await db.write(
            'UPDATE user SET password=?, pass_recovery_token=NULL WHERE `uuid` = ? AND pass_recovery_token = ?',
            [await bcrypt.hash(req.body.password, 8), req.body.user_id, req.body.token]
        );
        invalidate_cached_user_by_id(req.body.user_id);

        return res.send('Password successfully updated.')
    }catch(e){
        return res.status(500).send('An internal error occured.');
    }
})

module.exports = router