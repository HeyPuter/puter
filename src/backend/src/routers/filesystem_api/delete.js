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
const config = require('../../config.js');
const eggspress = require('../../api/eggspress.js');
const { HLRemove } = require('../../filesystem/hl_operations/hl_remove.js');
const FSNodeParam = require('../../api/filesystem/FSNodeParam.js');

// -----------------------------------------------------------------------//
// POST /delete
// -----------------------------------------------------------------------//
module.exports = eggspress('/delete', {
    subdomain: 'api',
    auth2: true,
    json: true,
    allowedMethods: ['POST'],
}, async (req, res, next) => {
    // check if user is verified
    if((config.strict_email_verification_required || req.user.requires_email_confirmation) && !req.user.email_confirmed)
        return res.status(400).send({code: 'account_is_not_verified', message: 'Account is not verified'});

    const user       = req.user;
    const paths      = req.body.paths;
    const recursive  = req.body.recursive ?? false;
    const descendants_only      = req.body.descendants_only ?? false;

    if(paths === undefined)
        return res.status(400).send('paths is required')
    else if(!Array.isArray(paths))
        return res.status(400).send('paths must be an array')
    else if(paths.length === 0)
        return res.status(400).send('paths cannot be empty')

    // try to delete each path in the array one by one (if glob, resolve first)
    // TODO: remove this pseudo-batch
    for ( const item_path of paths ) {
        const target = await (new FSNodeParam('path')).consolidate({
            req: { user },
            getParam: () => item_path,
        });
        const hl_remove = new HLRemove();
        await hl_remove.run({
            target,
            user,
            recursive,
            descendants_only,
        });

        // send realtime success msg to client
        const svc_socketio = req.services.get('socketio');
        svc_socketio.send({ room: req.user.id }, 'item.removed', {
            path: item_path,
            descendants_only: descendants_only,
        });
    }

    res.send({});
});
