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
const { get_user, body_parser_error_handler } = require('../helpers');
const config = require('../config');

// -----------------------------------------------------------------------//
// POST /file
// -----------------------------------------------------------------------//
router.post('/login', express.json(), body_parser_error_handler, async (req, res, next)=>{
    // either api. subdomain or no subdomain
    if(require('../helpers').subdomain(req) !== 'api' && require('../helpers').subdomain(req) !== '')
        next();

    // modules
    const bcrypt = require('bcrypt')
    const jwt = require('jsonwebtoken')
    const validator = require('validator')

    // either username or email must be provided
    if(!req.body.username && !req.body.email)
        return res.status(400).send('Username or email is required.')
    // password is required
    else if(!req.body.password)
        return res.status(400).send('Password is required.')
    // password must be a string
    else if (typeof req.body.password !== 'string' && !(req.body.password instanceof String))
        return res.status(400).send('Password must be a string.')
    // if password is too short it's invalid, no need to do a db lookup
    else if(req.body.password.length < config.min_pass_length)
        return res.status(400).send('Invalid password.')
    // username, if present, must be a string
    else if (req.body.username && typeof req.body.username !== 'string' && !(req.body.username instanceof String))
        return res.status(400).send('username must be a string.')
    // if username doesn't pass regex test it's invalid anyway, no need to do DB lookup
    else if(req.body.username && !req.body.username.match(config.username_regex))
        return res.status(400).send('Invalid username.')
    // email, if present, must be a string
    else if (req.body.email && typeof req.body.email !== 'string' && !(req.body.email instanceof String))
        return res.status(400).send('email must be a string.')
    // if email is invalid, no need to do DB lookup anyway
    else if(req.body.email && !validator.isEmail(req.body.email))
        return res.status(400).send('Invalid email.')

    // Increment & check rate limit
    if(kv.incr(`login|${req.ip}|${req.body.email ?? req.body.username}`) > 10)
        return res.status(429).send('Too many requests.');
    // Set expiry for rate limit
    kv.expire(`login|${req.ip}|${req.body.email ?? req.body.username}`, 60*10, 'NX')

    try{
        let user;
        // log in using username
        if(req.body.username){
            user = await get_user({ username: req.body.username, cached: false });
            if(!user)
                return res.status(400).send('Username not found.')
        }
        // log in using email
        else if(validator.isEmail(req.body.email)){
            user = await get_user({ email: req.body.email, cached: false });
            if(!user)
                return res.status(400).send('Email not found.')
        }
        // is user suspended?
        if(user.suspended)
            return res.status(401).send('This account is suspended.')
        // pseudo user?
        // todo make this better, maybe ask them to create an account or send them an activation link
        if(user.password === null)
            return res.status(400).send('Incorrect password.')
        // check password
        if(await bcrypt.compare(req.body.password, user.password)){
            const token = await jwt.sign({uuid: user.uuid}, config.jwt_secret)
            //set cookie
            // res.cookie(config.cookie_name, token);
            res.cookie(config.cookie_name, token, {
                sameSite: 'none',
                secure: true,
                httpOnly: true,
            });

            // send response
            return res.send({
                token: token,
                user:{
                    username: user.username,
                    uuid: user.uuid,
                    email: user.email,
                    email_confirmed: user.email_confirmed,
                    is_temp: (user.password === null && user.email === null),
                }
            })
        }else{
            return res.status(400).send('Incorrect password.')
        }
    }catch(e){
        return res.status(400).send(e);
    }

})

module.exports = router