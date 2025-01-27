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
const router = express.Router();
const auth = require('../../middleware/auth.js');
const config = require('../../config.js');
const { Context } = require('../../util/context.js');
const { Actor, AppUnderUserActorType, UserActorType } = require('../../services/auth/Actor.js');
const { DB_READ } = require('../../services/database/consts.js');

// -----------------------------------------------------------------------//
// POST /getItem
// -----------------------------------------------------------------------//
router.post('/getItem', auth, express.json(), async (req, res, next)=>{
    // check subdomain
    if(require('../../helpers.js').subdomain(req) !== 'api')
        next();

    // check if user is verified
    if((config.strict_email_verification_required || req.user.requires_email_confirmation) && !req.user.email_confirmed)
        return res.status(400).send({code: 'account_is_not_verified', message: 'Account is not verified'});

    // validation
    if(!req.body.key)
        return res.status(400).send('`key` is required.');
    // check size of key, if it's too big then it's an invalid key and we don't want to waste time on it
    else if(Buffer.byteLength(req.body.key, 'utf8') > config.kv_max_key_size)
        return res.status(400).send('`key` is too long.');

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

    // Try KV 1 first
    const svc_driver = Context.get('services').get('driver');
    let driver_result;
    try {
        const driver_response = await svc_driver.call({
            iface: 'puter-kvstore',
            method: 'get',
            args: { key: req.body.key },
        });
        if ( ! driver_response.success ) {
            throw new Error(driver_response.error?.message ?? 'Unknown error');
        }
        driver_result = driver_response.result;
    } catch (e) {
        return res.status(400).send('puter-kvstore driver error: ' + e.message);
    }

    if ( driver_result ) {
        return res.send({ key: req.body.key, value: driver_result });
    }

    // modules
    const db = req.services.get('database').get(DB_READ, 'getItem-fallback');
    // get murmurhash module
    const murmurhash = require('murmurhash')
    // hash key for faster search in DB
    const key_hash = murmurhash.v3(req.body.key);

    let kv;
    // Get value from DB
    // If app is specified, then get value for that app
    if(req.body.app){
        kv = await db.read(
            `SELECT * FROM kv WHERE user_id=? AND app=? AND kkey_hash=? LIMIT 1`,
            [
                req.user.id,
                req.body.app,
                key_hash,
            ]
        )
    // If app is not specified, then get value for global (i.e. system) variables which is app='global'
    }else{
        kv = await db.read(
            `SELECT * FROM kv WHERE user_id=? AND (app IS NULL OR app = 'global') AND kkey_hash=? LIMIT 1`,
            [
                req.user.id,
                key_hash,
            ]
        )
    }

    // send results to client
    if(kv[0])
        return res.send({
            key: kv[0].kkey,
            value: kv[0].value,
        });
    else
        return res.send(null)
})
module.exports = router