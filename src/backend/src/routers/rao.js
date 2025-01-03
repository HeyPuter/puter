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
// records app opens

"use strict"
const express = require('express');
const router = express.Router();
const config = require('../config');
const { is_valid_uuid4, get_app } = require('../helpers');
const { DB_WRITE } = require('../services/database/consts.js');
const configurable_auth = require('../middleware/configurable_auth.js');
const { UserActorType, AppUnderUserActorType } = require('../services/auth/Actor.js');
const APIError = require('../api/APIError.js');

// -----------------------------------------------------------------------//
// POST /rao
// -----------------------------------------------------------------------//
router.post('/rao', configurable_auth(), express.json(), async (req, res, next)=>{
    const { actor } = req;
    // check subdomain
    if(require('../helpers').subdomain(req) !== 'api')
        next();

    // check if user is verified
    if((config.strict_email_verification_required || req.user.requires_email_confirmation) && !req.user.email_confirmed)
        return res.status(400).send({code: 'account_is_not_verified', message: 'Account is not verified'});

    let app_uid;
    if ( actor.type instanceof UserActorType )  {
        // validation
        if(!req.body.app_uid || typeof req.body.app_uid !== 'string' && !(req.body.app_uid instanceof String))
            return res.status(400).send({code: 'invalid_app_uid', message: 'Invalid app uid'});
        // must be a valid uuid
        // app uuids start with 'app-', so in order to validate them we remove the prefix first
        else if(!is_valid_uuid4(req.body.app_uid.replace('app-','')))
            return res.status(400).send({code: 'invalid_app_uid', message: 'Invalid app uid'});
        
        app_uid = req.body.app_uid;
    } else if ( actor.type instanceof AppUnderUserActorType ) {
        app_uid = actor.type.app.uid;
    } else {
        throw APIError.create('forbidden');
    }

    // get db connection
    const db = req.services.get('database').get(DB_WRITE, 'apps');

    // insert into db
    db.write(
        `INSERT INTO app_opens (app_uid, user_id, ts) VALUES (?, ?, ?)`,
        [app_uid, req.user.id, Math.floor(new Date().getTime() / 1000)]
    )

    // get app
    const opened_app = await get_app({uid: app_uid});

    // send process event `puter.app_open`
    process.emit('puter.app_open', {
        app_uid: app_uid,
        user_id: req.user.id,
        app_owner_user_id: opened_app.owner_user_id,
        ts: Math.floor(new Date().getTime() / 1000)
    });

    // -----------------------------------------------------------------------//
    // Update the 'app opens' cache
    // -----------------------------------------------------------------------//
    // First try the cache to see if we have recent apps
    let recent_apps = kv.get('app_opens:user:' + req.user.id);

    // If cache is not empty, prepend it with the new app
    if(recent_apps && recent_apps.length > 0){
        // add the app to the beginning of the array
        recent_apps.unshift({app_uid: app_uid});

        // dedupe the array
        recent_apps = recent_apps.filter((v,i,a)=>a.findIndex(t=>(t.app_uid === v.app_uid))===i);

        // limit to 10
        recent_apps = recent_apps.slice(0, 10);

        // update cache
        kv.set('app_opens:user:' + req.user.id, recent_apps);
    }
    // Cache is empty, query the db and update the cache
    else{
        db.read(
            'SELECT DISTINCT app_uid FROM app_opens WHERE user_id = ? GROUP BY app_uid ORDER BY MAX(_id) DESC LIMIT 10',
            [req.user.id]).then( ([apps]) => {
                // Update cache with the results from the db (if any results were returned)
                if(apps && Array.isArray(apps) && apps.length > 0){
                    kv.set('app_opens:user:' + req.user.id, apps);
                }
            });
    }

    // Update clients
    const svc_socketio = req.services.get('socketio');
    svc_socketio.send({ room: req.user.id }, 'app.opened', {
        uuid: opened_app.uid,
        uid: opened_app.uid,
        name: opened_app.name,
        title: opened_app.title,
        icon: opened_app.icon,
        godmode: opened_app.godmode,
        maximize_on_start: opened_app.maximize_on_start,
        index_url: opened_app.index_url,
        original_client_socket_id: req.body.original_client_socket_id,
    });

    // return
    return res.status(200).send({code: 'ok', message: 'ok'});
});

module.exports = router