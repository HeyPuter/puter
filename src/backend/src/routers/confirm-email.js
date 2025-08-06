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
const auth = require('../middleware/auth.js');
const { DB_WRITE } = require('../services/database/consts');
const APIError = require('../api/APIError.js');

// -----------------------------------------------------------------------//
// POST /confirm-email
// -----------------------------------------------------------------------//
router.post('/confirm-email', auth, express.json(), async (req, res, next)=>{
    // Either api. subdomain or no subdomain
    if(require('../helpers').subdomain(req) !== 'api' && require('../helpers').subdomain(req) !== '')
        next();

    if(!req.body.code)
        req.status(400).send('code is required');

    const svc_edgeRateLimit = req.services.get('edge-rate-limit');
    if ( ! svc_edgeRateLimit.check('confirm-email') ) {
        return res.status(429).send('Too many requests.');
    }

    // Modules
    const db = req.services.get('database').get(DB_WRITE, 'auth');

    // Increment & check rate limit
    if(kv.incr(`confirm-email|${req.ip}|${req.user.email ?? req.user.username}`) > 10)
        return res.status(429).send({error: 'Too many requests.'});
    // Set expiry for rate limit
    kv.expire(`confirm-email|${req.ip}|${req.user.email ?? req.user.username}`, 60 * 10, 'NX')

    console.log('need to check these', typeof req.body.code, typeof req.user.email_confirm_code, req.body.code, req.user.email_confirm_code);

    if(req.body.code !== req.user.email_confirm_code) {
        res.send({ email_confirmed: false });
        return;
    }

    // Scenario: email was confirmed on another account already
    {
        const svc_cleanEmail = req.services.get('clean-email');
        const clean_email = svc_cleanEmail.clean(req.user.email);
        
        if ( ! await svc_cleanEmail.validate(clean_email) ) {
            APIError.create('field_invalid', null, {
                key: 'email',
                expected: 'valid email',
                got: req.body.email,
            })
        }
        const rows = await db.read(
            `SELECT EXISTS(
                SELECT 1 FROM user WHERE (email=? OR clean_email=?) AND email_confirmed=1 AND password IS NOT NULL
            ) AS email_exists`, [req.user.email, clean_email]);
        if ( rows[0].email_exists ) {
            APIError.create('email_already_in_use').write(res);
            return;
        }
    }

    // If other users have the same unconfirmed email, revoke it
    await db.write(
        'UPDATE `user` SET `unconfirmed_change_email` = NULL, `change_email_confirm_token` = NULL WHERE `unconfirmed_change_email` = ?',
        [req.user.email],
    );

    // Update user record to say email is confirmed
    await db.write(
        "UPDATE `user` SET `email_confirmed` = 1, `requires_email_confirmation` = 0 WHERE id = ? LIMIT 1",
        [req.user.id],
    );
    
    // Invalidate user cache
    const svc_getUser = req.services.get('get-user');
    await svc_getUser.get_user({ id: req.user.id, force: true });

    // Emit internal event
    const svc_event = req.services.get('event');
    svc_event.emit('user.email-confirmed', {
        user_uid: req.user.uuid,
        email: req.user.email,
    });

    // Emit websocket event (TODO: should come from internal event above)
    const svc_socketio = req.services.get('socketio');
    svc_socketio.send({ room: req.user.id }, 'user.email_confirmed', {
        original_client_socket_id: req.body.original_client_socket_id
    });

    // return results
    return res.send({
        email_confirmed: true,
        original_client_socket_id: req.body.original_client_socket_id,
    });
})

module.exports = router
