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
const { invalidate_cached_user_by_id, get_user } = require('../helpers')
const { DB_WRITE } = require('../services/database/consts')

const jwt = require('jsonwebtoken');

// Ensure we don't expose branches with differing messages.
const SAFE_NEGATIVE_RESPONSE = 'This password recovery token is no longer valid.';

// -----------------------------------------------------------------------//
// POST /verify-pass-recovery-token
// -----------------------------------------------------------------------//
router.post('/verify-pass-recovery-token', express.json(), async (req, res, next)=>{
    // check subdomain
    if(require('../helpers').subdomain(req) !== 'api' && require('../helpers').subdomain(req) !== '')
        next();

    if ( ! req.body.token ) {
        return res.status(401).send('token is required')
    }

    const svc_edgeRateLimit = req.services.get('edge-rate-limit');
    if ( ! svc_edgeRateLimit.check('verify-pass-recovery-token') ) {
        return res.status(429).send('Too many requests.');
    }

    const { exp, user_uid, email } = jwt.verify(req.body.token, config.jwt_secret);

    const user = await get_user({ uuid: user_uid, force: true });
    if ( user.email !== email ) {
        return res.status(400).send(SAFE_NEGATIVE_RESPONSE);
    }

    const current_time = Math.floor(Date.now() / 1000);
    const time_remaining = exp - current_time;

    return res.status(200).send({ time_remaining });
})

module.exports = router
