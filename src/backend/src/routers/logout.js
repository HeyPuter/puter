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
const auth = require('../middleware/auth.js');
const config = require('../config');

// -----------------------------------------------------------------------//
// POST /logout
// -----------------------------------------------------------------------//
router.post('/logout', auth, express.json(), async (req, res, next) => {
    // check subdomain
    if ( require('../helpers').subdomain(req) !== 'api' && require('../helpers').subdomain(req) !== '' )
    {
        next();
    }
    // check anti-csrf token
    const svc_antiCSRF = req.services.get('anti-csrf');
    if ( ! svc_antiCSRF.consume_token(req.user.uuid, req.body.anti_csrf) ) {
        return res.status(400).json({ message: 'incorrect anti-CSRF token' });
    }
    // delete cookie
    res.clearCookie(config.cookie_name);
    // delete session
    (async () => {
        if ( ! req.token ) return;
        try {
            const svc_auth = req.services.get('auth');
            await svc_auth.remove_session_by_token(req.token);
        } catch (e) {
            console.log(e);
        }
    })();
    //---------------------------------------------------------
    // DANGER ZONE: delete temp user and all its data
    //---------------------------------------------------------
    if ( req.user.password === null && req.user.email === null ) {
        const { deleteUser } = require('../helpers');
        deleteUser(req.user.id);
    }
    // send response
    res.send('logged out');
});

module.exports = router;