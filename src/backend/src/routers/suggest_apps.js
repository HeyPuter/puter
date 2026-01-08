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
const { Context } = require('../util/context.js');
const { NodeInternalIDSelector } = require('../filesystem/node/selectors.js');

// -----------------------------------------------------------------------//
// POST /suggest_apps
// -----------------------------------------------------------------------//
router.post('/suggest_apps', auth, express.json(), async (req, res, next) => {
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
    if ( req.body.uid === undefined && req.body.path === undefined )
    {
        return res.status(400).send({ message: '`uid` or `path` required' });
    }

    // modules
    const { convert_path_to_fsentry, uuid2fsentry, suggest_app_for_fsentry }  = require('../helpers');
    let fsentry;

    // by uid
    if ( req.body.uid )
    {
        fsentry = await uuid2fsentry(req.body.uid);
    }
    // by path
    else {
        fsentry = await convert_path_to_fsentry(req.body.path);
        if ( fsentry === false )
        {
            return res.status(400).send('Path not found.');
        }
    }

    const services = Context.get('services');
    const fs = services.get('filesystem');
    const node = await fs.node(new NodeInternalIDSelector('mysql', fsentry.id, {
        source: 'suggest_apps',
    }));

    // check permission
    const actor = req.actor ?? Context.get('actor');
    if ( ! actor ) {
        return res.status(500).send('failed to get Actor object');
    }
    const svc_acl = services.get('acl');
    if ( ! await svc_acl.check(actor, node, 'read') ) {
        (await svc_acl.get_safe_acl_error(actor, node, 'read'))
            .write(res);
        return;
    }

    // get suggestions
    try {
        return res.send(await suggest_app_for_fsentry(fsentry));
    }
    catch (e) {
        return res.status(400).send(e);
    }
});

module.exports = router;