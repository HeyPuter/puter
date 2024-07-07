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
const router = new express.Router();
const auth = require('../middleware/auth.js');
const config = require('../config');
const { app_name_exists, refresh_apps_cache, chkperm, convert_path_to_fsentry, get_app } = require('../helpers');
const { DB_WRITE, DB_READ } = require('../services/database/consts.js');
const subdomain = require('../middleware/subdomain.js');

// -----------------------------------------------------------------------//
// GET /apps
// -----------------------------------------------------------------------//
router.get('/apps',
    subdomain('api'),
    auth, express.json({limit: '50mb'}), async (req, res, next)=>{
    // /!\ open brace on end of previous line

    // check if user is verified
    if((config.strict_email_verification_required || req.user.requires_email_confirmation) && !req.user.email_confirmed)
        return res.status(400).send({code: 'account_is_not_verified', message: 'Account is not verified'});

    const db = req.services.get('database').get(DB_READ, 'apps');

    let apps_res = await db.read(
        `SELECT * FROM apps WHERE owner_user_id = ? ORDER BY timestamp DESC`,
        [req.user.id]
    );

    const svc_appInformation = req.services.get('app-information');

    let apps=[];

    if(apps_res.length > 0){
        for(let i=0; i< apps_res.length; i++){
            // filetype associations
            let ftassocs = await db.read(
                `SELECT * FROM app_filetype_association WHERE app_id = ?`,
                [apps_res[i].id]
            );

            let filetype_associations = []
            if(ftassocs.length > 0){
                ftassocs.forEach(ftassoc => {
                    filetype_associations.push(ftassoc.type);
                });
            }

            const stats = await svc_appInformation.get_stats(apps_res[i].uid);

            apps.push({
                uid: apps_res[i].uid,
                name: apps_res[i].name,
                description: apps_res[i].description,
                title: apps_res[i].title,
                icon: apps_res[i].icon,
                index_url: apps_res[i].index_url,
                godmode: apps_res[i].godmode,
                background: apps_res[i].background,
                maximize_on_start: apps_res[i].maximize_on_start,
                filetype_associations: filetype_associations,
                ...stats,
                approved_for_incentive_program: apps_res[i].approved_for_incentive_program,
                created_at: apps_res[i].timestamp,
            })
        }
    }

    return res.send(apps);
})

// -----------------------------------------------------------------------//
// GET /apps/:name(s)
// -----------------------------------------------------------------------//
router.get('/apps/:name',
    subdomain('api'),
    auth, express.json({limit: '50mb'}), async (req, res, next)=>{
    // /!\ open brace on end of previous line

    // check subdomain
    if(require('../helpers').subdomain(req) !== 'api')
        next();

    // check if user is verified
    if((config.strict_email_verification_required || req.user.requires_email_confirmation) && !req.user.email_confirmed)
        return res.status(400).send({code: 'account_is_not_verified', message: 'Account is not verified'});

    let app_names = req.params.name.split('|');
    let retobj = [];

    if(app_names.length > 0){
        // prepare each app for returning to user
        for (let index = 0; index < app_names.length; index++) {
            const app = await get_app({name: app_names[index]});
            let final_obj = {};
            if(app){
                final_obj = {
                    uuid: app.uid,
                    name: app.name,
                    title: app.title,
                    icon: app.icon,
                    godmode: app.godmode,
                    background: app.background,
                    maximize_on_start: app.maximize_on_start,
                    index_url: app.index_url,
                };
            }
            // add to object to be returned
            retobj.push(final_obj)
        }
    }

    // order output based on input!
    let final_obj = [];
    for (let index = 0; index < app_names.length; index++) {
        const app_name = app_names[index];
        for (let index = 0; index < retobj.length; index++) {
            if(retobj[index].name === app_name)
                final_obj.push(retobj[index]);
        }
    }

    return res.send(final_obj);
})


module.exports = router