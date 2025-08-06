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
const {send_email_verification_code, invalidate_cached_user} = require('../helpers');
const { DB_WRITE } = require('../services/database/consts.js');

// -----------------------------------------------------------------------//
// POST /send-confirm-email
// -----------------------------------------------------------------------//
router.post('/send-confirm-email', auth, express.json(), async (req, res, next)=>{
    const svc_edgeRateLimit = req.services.get('edge-rate-limit');
    if ( ! svc_edgeRateLimit.check('send-confirm-email') ) {
        return res.status(429).send('Too many requests.');
    }

    // check subdomain
    if(require('../helpers').subdomain(req) !== 'api')
        next();

    const db = req.services.get('database').get(DB_WRITE, 'auth');
    let email_confirm_code = Math.floor(100000 + Math.random() * 900000);

    if(req.user.suspended)
        return res.status(401).send({error: 'Account suspended'});

    await db.write(
        `UPDATE user SET email_confirm_code = ? WHERE id = ?`,
        [
            // email_confirm_code
            '' + email_confirm_code,
            // id
            req.user.id,
        ]);
    invalidate_cached_user(req.user);

    // send email verification
    send_email_verification_code(email_confirm_code, req.user.email);

    res.send();
})

module.exports = router