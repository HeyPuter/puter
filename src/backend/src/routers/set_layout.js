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
const { DB_WRITE } = require('../services/database/consts.js');

// -----------------------------------------------------------------------//
// POST /set_layout
// -----------------------------------------------------------------------//
router.post('/set_layout', auth, express.json(), async (req, res, next) => {
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
    if ( req.body.item_uid === undefined && req.body.item_path === undefined )
    {
        return res.status(400).send('`item_uid` or `item_path` is required');
    }
    else if ( req.body.layout === undefined )
    {
        return res.status(400).send('`layout` is required');
    }
    else if ( req.body.layout !== 'icons' && req.body.layout !== 'details' && req.body.layout !== 'list' )
    {
        return res.status(400).send('invalid `layout`');
    }
    // modules
    const db = req.services.get('database').get(DB_WRITE, 'ui');
    const { uuid2fsentry, convert_path_to_fsentry, chkperm } = require('../helpers');

    //get dir
    let item;
    if ( req.body.item_uid )
    {
        item = await uuid2fsentry(req.body.item_uid);
    }
    else if ( req.body.item_path )
    {
        item = await convert_path_to_fsentry(req.body.item_path);
    }

    // item not found
    if ( item === false ) {
        return res.status(400).send({
            error: {
                message: 'No entry found with this uid',
            },
        });
    }

    // must be dir
    if ( ! item.is_dir )
    {
        return res.status(400).send('must be a directory');
    }

    // check permission
    if ( ! await chkperm(item, req.user.id, 'write') )
    {
        return res.status(403).send({ code: 'forbidden', message: 'permission denied.' });
    }

    // insert into DB
    await db.write('UPDATE fsentries SET layout = ? WHERE id = ?',
                    [req.body.layout, item.id]);

    // send results to client
    return res.send({});
});
module.exports = router;