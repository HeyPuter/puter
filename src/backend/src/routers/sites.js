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
const auth = require('../middleware/auth.js');
const config = require('../config');

// -----------------------------------------------------------------------// 
// POST /sites
// -----------------------------------------------------------------------//
router.post('/sites', auth, express.json(), async (req, res, next)=>{
    // check subdomain
    if(require('../helpers').subdomain(req) !== 'api')
        next();

    // check if user is verified
    if((config.strict_email_verification_required || req.user.requires_email_confirmation) && !req.user.email_confirmed)
        return res.status(400).send({code: 'account_is_not_verified', message: 'Account is not verified'});

    // modules
    const {id2path} = require('../helpers');
    let db = require('../db/mysql.js')
    let dbrr = db.readReplica ?? db;

    const user    = req.user
    const sites = [];

    let [subdomains] = await dbrr.promise().execute(
        `SELECT * FROM subdomains WHERE user_id = ?`, 
        [user.id]
    );  
    if(subdomains.length > 0){
        for(let i=0; i< subdomains.length; i++){
            let site = {};
            // address
            site.address = config.protocol + '://' + subdomains[i].subdomain + '.' + 'puter.site';
            // uuid
            site.uuid = subdomains[i].uuid;
            // dir
            let [dir] = await dbrr.promise().execute(
                `SELECT * FROM fsentries WHERE id = ?`, 
                [subdomains[i].root_dir_id]
            );

            if(dir.length > 0){
                site.has_dir = true;
                site.dir_uid = dir[0].uuid;
                site.dir_name = dir[0].name;
                site.dir_path = await id2path(dir[0].id)
            }else{
                site.has_dir = false;
            }

            sites.push(site);
        }
    }
    res.send(sites);
})

module.exports = router