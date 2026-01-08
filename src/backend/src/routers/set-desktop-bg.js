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
const config = require('../config.js');
const { invalidate_cached_user } = require('../helpers');
const router = new express.Router();
const auth = require('../middleware/auth.js');
const { DB_WRITE } = require('../services/database/consts.js');

// -----------------------------------------------------------------------//
// POST /set-desktop-bg
// -----------------------------------------------------------------------//
router.post('/set-desktop-bg', auth, express.json(), async (req, res, next) => {
    // check subdomain
    if ( require('../helpers').subdomain(req) !== 'api' )
    {
        next();
    }

    // check if user is verified
    if ( (config.strict_email_verification_required || req.user.requires_email_confirmation) && !req.user.email_confirmed )
    {
        return res.status(400).send({ code: 'account_is_not_verified', message: 'Account is not verified' });
    }

    // modules
    const db = req.services.get('database').get(DB_WRITE, 'ui');

    // insert into DB
    await db.write('UPDATE user SET desktop_bg_url = ?, desktop_bg_color = ?, desktop_bg_fit = ? WHERE user.id = ?',
                    [
                        req.body.url ?? null,
                        req.body.color ?? null,
                        req.body.fit ?? null,
                        req.user.id,
                    ]);
    invalidate_cached_user(req.user);

    // send results to client
    return res.send({});
});
module.exports = router;