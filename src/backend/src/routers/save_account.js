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
const router = new express.Router();
const {
    get_taskbar_items, username_exists, send_email_verification_code, send_email_verification_token, invalidate_cached_user, get_user,
    is_user_signup_disabled: lazy_user_signup,
} = require('../helpers');
const auth = require('../middleware/auth.js');
const config = require('../config');
const { DB_WRITE } = require('../services/database/consts');
const { SECOND } = require('@heyputer/putility/src/libs/time.js');

// -----------------------------------------------------------------------//
// POST /save_account
// -----------------------------------------------------------------------//
router.post('/save_account', auth, express.json(), async (req, res, next)=>{
    // either api. subdomain or no subdomain
    if(require('../helpers').subdomain(req) !== 'api' && require('../helpers').subdomain(req) !== '')
        next();

    const is_user_signup_disabled = await lazy_user_signup();
    if ( is_user_signup_disabled ) {
        return res.status(403).send('User signup is disabled.');
    }

    // modules
    const db = req.services.get('database').get(DB_WRITE, 'auth');
    const validator = require('validator')
    const bcrypt = require('bcrypt')
    const jwt = require('jsonwebtoken')
    const { v4: uuidv4 } = require('uuid');

    // validation
    if(req.user.password !== null)
        return res.status(400).send('User account already saved.');
    else if(!req.body.username)
        return res.status(400).send('Username is required');
    // username must be a string
    else if (typeof req.body.username !== 'string')
        return res.status(400).send('username must be a string.')
    else if(!req.body.username.match(config.username_regex))
        return res.status(400).send('Username can only contain letters, numbers and underscore (_).')
    else if(req.body.username.length > config.username_max_length)
        return res.status(400).send(`Username cannot have more than ${config.username_max_length} characters.`)
    // check if username matches any reserved words
    else if(config.reserved_words.includes(req.body.username))
        return res.status(400).send({message: 'This username is not available.'});
    else if(!req.body.email)
        return res.status(400).send('Email is required')
    // email must be a string
    else if (typeof req.body.email !== 'string')
        return res.status(400).send('email must be a string.')
    else if(!validator.isEmail(req.body.email))
        return res.status(400).send('Please enter a valid email address.')
    else if(!req.body.password)
        return res.status(400).send('Password is required')
    // password must be a string
    else if (typeof req.body.password !== 'string')
        return res.status(400).send('password must be a string.')
    else if(req.body.password.length < config.min_pass_length)
        return res.status(400).send(`Password must be at least ${config.min_pass_length} characters long.`)

    const svc_cleanEmail = req.services.get('clean-email')
    const clean_email = svc_cleanEmail.clean(req.body.email);
    
    if ( ! await svc_cleanEmail.validate(clean_email) ) {
        return res.status(400).send('This email does not seem to be valid.');
    }

    const svc_edgeRateLimit = req.services.get('edge-rate-limit');
    if ( ! svc_edgeRateLimit.check('save-account') ) {
        return res.status(429).send('Too many requests.');
    }

    const svc_lock = req.services.get('lock');
    return svc_lock.lock([
        `save-account:username:${req.body.username}`,
        `save-account:email:${req.body.email}`
    ], { timeout: 5 * SECOND }, async () => {
        // duplicate username check, do this only if user has supplied a new username
        if(req.body.username !== req.user.username && await username_exists(req.body.username))
            return res.status(400).send('This username already exists in our database. Please use another one.');
        // duplicate email check (pseudo-users don't count)
        let rows2 = await db.read(`SELECT EXISTS(SELECT 1 FROM user WHERE email=? AND password IS NOT NULL) AS email_exists`, [req.body.email]);
        if(rows2[0].email_exists)
            return res.status(400).send('This email already exists in our database. Please use another one.');
        // get pseudo user, if exists
        let pseudo_user = await db.read(`SELECT * FROM user WHERE email = ? AND password IS NULL`, [req.body.email]);
        pseudo_user = pseudo_user[0];

        // send_confirmation_code
        req.body.send_confirmation_code = req.body.send_confirmation_code ?? true;

        // todo email confirmation is required by default unless:
        // Pseudo user converting and matching uuid is provided
        let email_confirmation_required = 0;

        // -----------------------------------
        // Get referral user
        // -----------------------------------
        let referred_by_user = undefined;
        if ( req.body.referral_code ) {
            referred_by_user = await get_user({ referral_code: req.body.referral_code });
            if ( ! referred_by_user ) {
                return res.status(400).send('Referral code not found');
            }
        }

        // -----------------------------------
        // New User
        // -----------------------------------
        const user_uuid = req.user.uuid;
        let email_confirm_code = Math.floor(100000 + Math.random() * 900000);
        const email_confirm_token = uuidv4();

        if(pseudo_user === undefined){
            await db.write(
                `UPDATE user
                SET
                username = ?, email = ?, password = ?, email_confirm_code = ?, email_confirm_token = ?${
                    referred_by_user ? ', referred_by = ?' : '' }
                WHERE
                id = ?`,
                [
                    // username
                    req.body.username,
                    // email
                    req.body.email,
                    // password
                    await bcrypt.hash(req.body.password, 8),
                    // email_confirm_code
                    '' + email_confirm_code,
                    //email_confirm_token
                    email_confirm_token,
                    // referred_by
                    ...(referred_by_user ? [referred_by_user.id] : []),
                    // id
                    req.user.id
                ]
            );
            invalidate_cached_user(req.user);

            // Update root directory name
            await db.write(
                `UPDATE fsentries SET name = ? WHERE user_id = ? and parent_uid IS NULL`,
                [
                    // name
                    req.body.username,
                    // id
                    req.user.id,
                ]
            );
            const filesystem = req.services.get('filesystem');
            await filesystem.update_child_paths(`/${req.user.username}`, `/${req.body.username}`, req.user.id);

            if(req.body.send_confirmation_code)
                send_email_verification_code(email_confirm_code, req.body.email);
            else
                send_email_verification_token(email_confirm_token, req.body.email, user_uuid);
        }

        // create token for login
        const svc_auth = req.services.get('auth');
        const { token } = await svc_auth.create_session_token(req.user, { req });

        // user id
        // todo if pseudo user, assign directly no need to do another DB lookup
        const user_id = req.user.id;
        const user_res = await db.read('SELECT * FROM `user` WHERE `id` = ? LIMIT 1', [user_id]);
        const user = user_res[0];

        // todo send LINK-based verification email

        //set cookie
        res.cookie(config.cookie_name, token);

        {
            const svc_event = req.services.get('event');
            svc_event.emit('user.save_account', { user });
        }

        // return results
        return res.send({
            token: token,
            user:{
                username: user.username,
                uuid: user.uuid,
                email: user.email,
                is_temp: false,
                requires_email_confirmation: user.requires_email_confirmation,
                email_confirmed: user.email_confirmed,
                email_confirmation_required: email_confirmation_required,
                taskbar_items: await get_taskbar_items(user),
                referral_code: user.referral_code,
            }
        })
    });
})

module.exports = router