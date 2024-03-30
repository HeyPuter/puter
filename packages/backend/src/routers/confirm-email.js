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
const { invalidate_cached_user } = require('../helpers');
const router = new express.Router();
const auth = require('../middleware/auth.js');
const { DB_WRITE } = require('../services/database/consts');

// -----------------------------------------------------------------------//
// POST /confirm-email
// -----------------------------------------------------------------------//
router.post('/confirm-email', auth, express.json(), async (req, res, next)=>{
    // Either api. subdomain or no subdomain
    if(require('../helpers').subdomain(req) !== 'api' && require('../helpers').subdomain(req) !== '')
        next();

    if(!req.body.code)
        req.status(400).send('code is required');

    // Modules
    const db = req.services.get('database').get(DB_WRITE, 'auth');

    // Increment & check rate limit
    if(kv.incr(`confirm-email|${req.ip}|${req.body.email ?? req.body.username}`) > 10)
        return res.status(429).send({error: 'Too many requests.'});
    // Set expiry for rate limit
    kv.expire(`confirm-email|${req.ip}|${req.body.email ?? req.body.username}`, 60 * 10, 'NX')

    if(req.body.code === req.user.email_confirm_code) {
        await db.write(
            "UPDATE `user` SET `email_confirmed` = 1, `requires_email_confirmation` = 0 WHERE id = ? LIMIT 1",
            [req.user.id],
        );
        invalidate_cached_user(req.user);
    }

    // Build response object
    const res_obj = {
        email_confirmed: (req.body.code === req.user.email_confirm_code),
        original_client_socket_id: req.body.original_client_socket_id,
    }

    // Send realtime success msg to client
    if(req.body.code === req.user.email_confirm_code){
        let socketio = require('../socketio.js').getio();
        if(socketio){
            socketio.to(req.user.id).emit('user.email_confirmed', {original_client_socket_id: req.body.original_client_socket_id})
        }
    }

    // return results
    return res.send(res_obj)
})

module.exports = router