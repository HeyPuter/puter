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
const auth = require('../../middleware/auth.js');
const config = require('../../config.js');
const { app_exists, byte_format } = require('../../helpers.js');
const { Actor, AppUnderUserActorType, UserActorType } = require('../../services/auth/Actor.js');
const { Context } = require('../../util/context.js');

// -----------------------------------------------------------------------//
// POST /setItem
// -----------------------------------------------------------------------//
router.post('/setItem', auth, express.json(), async (req, res, next) => {
    // check subdomain
    if ( require('../../helpers.js').subdomain(req) !== 'api' )
    {
        next();
    }

    // check if user is verified
    if ( (config.strict_email_verification_required || req.user.requires_email_confirmation) && !req.user.email_confirmed )
    {
        return res.status(400).send({ code: 'account_is_not_verified', message: 'Account is not verified' });
    }

    // validation
    if ( ! req.body.key )
    {
        return res.status(400).send('`key` is required');
    }
    else if ( typeof req.body.key !== 'string' )
    {
        return res.status(400).send('`key` must be a string');
    }
    else if ( ! req.body.value )
    {
        return res.status(400).send('`value` is required');
    }

    req.body.key = String(req.body.key);
    req.body.value = String(req.body.value);

    if ( Buffer.byteLength(req.body.key, 'utf8') > config.kv_max_key_size )
    {
        return res.status(400).send(`\`key\` is too large. Max size is ${byte_format(config.kv_max_key_size)}.`);
    }
    else if ( Buffer.byteLength(req.body.value, 'utf8') > config.kv_max_value_size )
    {
        return res.status(400).send(`\`value\` is too large. Max size is ${byte_format(config.kv_max_value_size)}.`);
    }
    else if ( req.body.app && !await app_exists({ uid: req.body.app }) )
    {
        return res.status(400).send('`app` does not exist');
    }

    // insert into KV 1
    const actor = req.body.app
        ? await Actor.create(AppUnderUserActorType, {
            user: req.user,
            app_uid: req.body.app,
        })
        : await Actor.create(UserActorType, {
            user: req.user,
        })
        ;

    Context.set('actor', actor);

    const svc_driver = Context.get('services').get('driver');
    let driver_result;
    try {
        const driver_response = await svc_driver.call({
            iface: 'puter-kvstore',
            method: 'set',
            args: {
                key: req.body.key,
                value: req.body.value,
            },
        });
        if ( ! driver_response.success ) {
            throw new Error(driver_response.error?.message ?? 'Unknown error');
        }
        driver_result = driver_response.result;
    } catch (e) {
        return res.status(400).send(`puter-kvstore driver error: ${ e.message}`);
    }

    // send results to client
    return res.send({});
});
module.exports = router;