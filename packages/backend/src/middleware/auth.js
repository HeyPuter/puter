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
const {jwt_auth} = require('../helpers');
const { DB_WRITE } = require('../services/database/consts');
const { Context } = require('../util/context');

const auth = async (req, res, next)=>{
    try{
        let auth_res = await jwt_auth(req);

        // is account suspended?
        if(auth_res.user.suspended)
            return res.status(401).send({error: 'Account suspended'});

        // successful auth
        req.user = auth_res.user;
        req.token = auth_res.token;

        // let's add it to the context too
        try {
        const x = Context.get();
        x.set('user', req.user);
        } catch (e) {
        console.error(e);
        }

        // record as daily active users
        const db = req.services.get('database').get(DB_WRITE, 'auth');
        db.write('UPDATE `user` SET `last_activity_ts` = now() WHERE id=? LIMIT 1', [req.user.id]);

        // go to next
        next();
    }
    // auth failed
    catch(e){
        return res.status(401).send(e);
    }
}

module.exports = auth