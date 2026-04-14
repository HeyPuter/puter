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
// POST /set_sort_by
// -----------------------------------------------------------------------//
router.post('/set_sort_by', auth, express.json(), async (req, res, next) => {
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
    else if ( req.body.sort_by === undefined )
    {
        return res.status(400).send('`sort_by` is required');
    }
    else if ( req.body.sort_by !== 'name' && req.body.sort_by !== 'size' && req.body.sort_by !== 'modified' && req.body.sort_by !== 'type' )
    {
        return res.status(400).send('invalid `sort_by`');
    }
    else if ( req.body.sort_order !== 'asc' && req.body.sort_order !== 'desc' )
    {
        return res.status(400).send('invalid `sort_order`');
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

    // set sort_by
    await db.write('UPDATE fsentries SET sort_by = ? WHERE id = ?',
                    [req.body.sort_by, item.id]);

    // set sort_order
    await db.write('UPDATE fsentries SET sort_order = ? WHERE id = ?',
                    [req.body.sort_order, item.id]);

    // send results to client
    return res.send({});
});
module.exports = router;