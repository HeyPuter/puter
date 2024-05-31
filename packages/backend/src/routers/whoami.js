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
const express = require('express');
const { get_taskbar_items, is_shared_with_anyone, suggest_app_for_fsentry, get_app, get_descendants, id2uuid } = require('../helpers');
const auth = require('../middleware/auth.js');
const fs = require('../middleware/fs.js');
const _path = require('path');
const eggspress = require('../api/eggspress');
const { Context } = require('../util/context');
const { UserActorType } = require('../services/auth/Actor');

// -----------------------------------------------------------------------//
// GET /whoami
// -----------------------------------------------------------------------//
const WHOAMI_GET = eggspress('/whoami', {
    subdomain: 'api',
    auth2: true,
    allowedMethods: ['GET'],
}, async (req, res, next) => {
    const actor = Context.get('actor');
    if ( ! actor ) {
        throw Error('actor not found in context');
    }

    const is_user = actor.type instanceof UserActorType;

    // send user object
    const details = {
        username: req.user.username,
        uuid: req.user.uuid,
        email: req.user.email,
        email_confirmed: req.user.email_confirmed,
        requires_email_confirmation: req.user.requires_email_confirmation,
        desktop_bg_url: req.user.desktop_bg_url,
        desktop_bg_color: req.user.desktop_bg_color,
        desktop_bg_fit: req.user.desktop_bg_fit,
        is_temp: (req.user.password === null && req.user.email === null),
        taskbar_items: await get_taskbar_items(req.user),
        referral_code: req.user.referral_code,
        otp: !! req.user.otp_enabled,
        ...(req.new_token ? { token: req.token } : {})
    };

    // Get whoami values from other services
    const svc_whoami = req.services.get('whoami');
    const provider_details = await svc_whoami.get_details({ user: req.user });
    Object.assign(details, provider_details);

    if ( ! is_user ) {
        // When apps call /whoami they should not see these attributes
        // delete details.username;
        // delete details.uuid;
        delete details.email;
        delete details.desktop_bg_url;
        delete details.desktop_bg_color;
        delete details.desktop_bg_fit;
        delete details.taskbar_items;
        delete details.token;
    }

    res.send(details);
})

// -----------------------------------------------------------------------//
// POST /whoami
// -----------------------------------------------------------------------//
const WHOAMI_POST = new express.Router();
WHOAMI_POST.post('/whoami', auth, fs, express.json(), async (req, response, next)=>{
    // check subdomain
    if(require('../helpers').subdomain(req) !== 'api') {
        return;
    }

    const actor = Context.get('actor');
    if ( ! actor ) {
        throw Error('actor not found in context');
    }

    const is_user = actor.type instanceof UserActorType;
    if ( ! is_user ) {
        throw Error('actor is not a user');
    }

    let desktop_items = [];

    // check if user asked for desktop items
    if(req.query.return_desktop_items === 1 || req.query.return_desktop_items === '1' || req.query.return_desktop_items === 'true'){
        // by cached desktop id
        if(req.user.desktop_id){
            // TODO: Check if used anywhere, maybe remove
            // eslint-disable-next-line no-undef
            desktop_items = await db.read(
                `SELECT * FROM fsentries
                WHERE user_id = ? AND parent_uid = ?`,
                [req.user.id, await id2uuid(req.user.desktop_id)]
            )
        }
        // by desktop path
        else{
            desktop_items = await get_descendants(req.user.username +'/Desktop', req.user, 1, true);
        }

        // clean up desktop items and add some extra information
        if(desktop_items.length > 0){
            if(desktop_items.length > 0){
                for (let i = 0; i < desktop_items.length; i++) {
                    if(desktop_items[i].id !== null){
                        // suggested_apps for files
                        if(!desktop_items[i].is_dir){
                            desktop_items[i].suggested_apps = await suggest_app_for_fsentry(desktop_items[i], {user: req.user});
                        }
                        // is_shared
                        desktop_items[i].is_shared   = await is_shared_with_anyone(desktop_items[i].id);

                        // associated_app
                        if(desktop_items[i].associated_app_id){
                            const app = await get_app({id: desktop_items[i].associated_app_id})

                            // remove some privileged information
                            delete app.id;
                            delete app.approved_for_listing;
                            delete app.approved_for_opening_items;
                            delete app.godmode;
                            delete app.owner_user_id;
                            // add to array
                            desktop_items[i].associated_app = app;

                        }else{
                            desktop_items[i].associated_app = {};
                        }

                        // remove associated_app_id since it's sensitive info
                        // delete desktop_items[i].associated_app_id;
                    }
                    // id is sesitive info
                    delete desktop_items[i].id;
                    delete desktop_items[i].user_id;
                    delete desktop_items[i].bucket;
                    desktop_items[i].path = _path.join('/', req.user.username, desktop_items[i].name)
                }
            }
        }
    }

    // send user object
    response.send({
        username: req.user.username,
        uuid: req.user.uuid,
        email: req.user.email,
        email_confirmed: req.user.email_confirmed,
        requires_email_confirmation: req.user.requires_email_confirmation,
        desktop_bg_url: req.user.desktop_bg_url,
        desktop_bg_color: req.user.desktop_bg_color,
        desktop_bg_fit: req.user.desktop_bg_fit,
        is_temp: (req.user.password === null && req.user.email === null),
        taskbar_items: await get_taskbar_items(req.user),
        desktop_items: desktop_items,
        referral_code: req.user.referral_code,
    });
});

module.exports = app => {
    app.use(WHOAMI_GET);
    app.use(WHOAMI_POST);
};