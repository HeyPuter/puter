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
const router = express.Router();
const auth = require('../middleware/auth.js');
const config = require('../config');

// -----------------------------------------------------------------------//
// POST /remove-site-dir
// -----------------------------------------------------------------------//
router.post('/remove-site-dir', auth, express.json(), async (req, res, next) => {
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

    // validation
    if ( req.body.dir_uuid === undefined )
    {
        return res.status(400).send('dir_uuid is required');
    }

    // modules
    const { uuid2fsentry, chkperm } = require('../helpers');
    const db = require('../db/mysql.js');
    const user    = req.user;

    const item = await uuid2fsentry(req.body.dir_uuid);
    if ( item !== false ) {
        // check permission
        if ( ! await chkperm(item, req.user.id, 'write') )
        {
            return res.status(403).send({ code: 'forbidden', message: 'permission denied.' });
        }
        // remove dir/subdomain connection
        if ( req.body.site_uuid )
        {
            await db.promise().execute(
                            'UPDATE subdomains SET root_dir_id = NULL WHERE user_id = ? AND root_dir_id =? AND uuid = ?',
                            [user.id, item.id, req.body.site_uuid]);
        }
        // if site_uuid is undefined, disassociate all websites from this directory
        else
        {
            await db.promise().execute(
                            'UPDATE subdomains SET root_dir_id = NULL WHERE user_id = ? AND root_dir_id =?',
                            [user.id, item.id]);
        }

        res.send({});
    } else {
        res.status(400).send();
    }
});

module.exports = router;