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
const {get_taskbar_items, send_email_verification_code, send_email_verification_token, username_exists, invalidate_cached_user_by_id, get_user } = require('../helpers');
const config = require('../config');
const eggspress = require('../api/eggspress');
const { Context } = require('../util/context');
const { DB_WRITE } = require('../services/database/consts');
const { generate_identifier } = require('../util/identifier');

async function generate_random_username () {
    let username;
    do {
        username = generate_identifier();
    } while (await username_exists(username));
    return username;
}

// -----------------------------------------------------------------------//
// POST /signup
// -----------------------------------------------------------------------//
module.exports = eggspress(['/signup'], {
    allowedMethods: ['POST'],
    alarm_timeout: 7000, // when it calls us
    response_timeout: 20000, // when it gives up
    abuse: {
        no_bots: true,
        // puter_origin: false,
        shadow_ban_responder: (req, res) => {
            res.status(400).send(`email username mismatch; please provide a password`);
        }
    },
}, async (req, res, next) => {
    // either api. subdomain or no subdomain
    if(require('../helpers').subdomain(req) !== 'api' && require('../helpers').subdomain(req) !== '')
        next();

    const svc_edgeRateLimit = req.services.get('edge-rate-limit');
    if ( ! svc_edgeRateLimit.check('signup') ) {
        return res.status(429).send('Too many requests.');
    }

    // modules
    const db = req.services.get('database').get(DB_WRITE, 'auth');
    const bcrypt = require('bcrypt')
    const { v4: uuidv4 } = require('uuid');
    const jwt = require('jsonwebtoken')
    const validator = require('validator')
    let uuid_user;

    const svc_auth = Context.get('services').get('auth');
    const svc_authAudit = Context.get('services').get('auth-audit');
    svc_authAudit.record({
        requester: Context.get('requester'),
        action: req.body.is_temp ? `signup:temp` : `signup:real`,
        body: req.body,
    });

    // check bot trap, if `p102xyzname` is anything but an empty string it means
    // that a bot has filled the form
    // doesn't apply to temp users
    if(!req.body.is_temp && req.body.p102xyzname !== '')
        return res.send();


    // send event
    async function emitAsync(eventName, data) {
        const listeners = process.listeners(eventName);
        
        if (listeners.length === 0) {
            return data;
        }
        
        await Promise.all(listeners.map(listener => listener(data)));
        return data;
    }

    let event = {
        allow: true,
        ip: req.headers?.['x-forwarded-for'] ||
            req.connection?.remoteAddress,
        user_agent: req.headers?.['user-agent'],
        body: req.body,
    };

    await emitAsync('puter.signup', event);

    if ( ! event.allow ) {
        return res.status(400).send(event.error ?? 'You are not allowed to sign up.');
    }

    // check if user is already logged in
    if ( req.body.is_temp && req.cookies[config.cookie_name] ) {
        const { user, token } = await svc_auth.check_session(
            req.cookies[config.cookie_name]
        );
        res.cookie(config.cookie_name, token, {
            sameSite: 'none',
            secure: true,
            httpOnly: true,
        });
        // const decoded = await jwt.verify(token, config.jwt_secret);
        // const user = await get_user({ uuid: decoded.uuid });
        if ( user ) {
            return res.send({
                token: token,
                user: {
                    username: user.username,
                    uuid: user.uuid,
                    email: user.email,
                    email_confirmed: user.email_confirmed,
                    requires_email_confirmation: user.requires_email_confirmation,
                    is_temp: (user.password === null && user.email === null),
                    taskbar_items: await get_taskbar_items(user),
                }
            });
        }
    }

    // temporary user
    if(req.body.is_temp && !config.disable_temp_users){
        req.body.username = await generate_random_username();
        req.body.email = req.body.username + '@gmail.com';
        req.body.password = 'sadasdfasdfsadfsa';
    }else if(config.disable_temp_users){
        return res.status(400).send('Temp users are disabled.');
    }

    // send_confirmation_code
    req.body.send_confirmation_code = req.body.send_confirmation_code ?? true;

    // username is required
    if(!req.body.username)
        return res.status(400).send('Username is required')
    // username must be a string
    else if (typeof req.body.username !== 'string')
        return res.status(400).send('username must be a string.')
    // check if username is valid
    else if(!req.body.username.match(config.username_regex))
        return res.status(400).send('Username can only contain letters, numbers and underscore (_).')
    // check if username is of proper length
    else if(req.body.username.length > config.username_max_length)
        return res.status(400).send(`Username cannot be longer than ${config.username_max_length} characters.`)
    // check if username matches any reserved words
    else if(config.reserved_words.includes(req.body.username))
        return res.status(400).send({message: 'This username is not available.'});
    // TODO: DRY: change_email.js
    else if(!req.body.is_temp && !req.body.email)
        return res.status(400).send('Email is required');
    // email, if present, must be a string
    else if (req.body.email && typeof req.body.email !== 'string')
        return res.status(400).send('email must be a string.')
    // if email is present, validate it
    else if(!req.body.is_temp && !validator.isEmail(req.body.email))
        return res.status(400).send('Please enter a valid email address.')
    else if(!req.body.is_temp && !req.body.password)
        return res.status(400).send('Password is required');
    // password, if present, must be a string
    else if (req.body.password && typeof req.body.password !== 'string')
        return res.status(400).send('password must be a string.')
    else if(!req.body.is_temp && req.body.password.length < config.min_pass_length)
        return res.status(400).send(`Password must be at least ${config.min_pass_length} characters long.`);

    const svc_cleanEmail = req.services.get('clean-email');
    const clean_email = svc_cleanEmail.clean(req.body.email);
    
    if ( ! await svc_cleanEmail.validate(clean_email) ) {
        return res.status(400).send('This email domain is not allowed');
    }

    // duplicate username check
    if(await username_exists(req.body.username))
        return res.status(400).send('This username already exists in our database. Please use another one.');
    // Email check is here :: Add condition for email_confirmed=1
    // duplicate email check (pseudo-users don't count)
    let rows2 = await db.read(
        `SELECT EXISTS(
            SELECT 1 FROM user WHERE (email=? OR clean_email=?) AND email_confirmed=1 AND password IS NOT NULL
        ) AS email_exists`, [req.body.email, clean_email]);
    if(rows2[0].email_exists)
        return res.status(400).send('This email already exists in our database. Please use another one.');
    // get pseudo user, if exists
    let pseudo_user = await db.read(`SELECT * FROM user WHERE email = ? AND password IS NULL`, [req.body.email]);
    pseudo_user = pseudo_user[0];
    // get uuid user, if exists
    if(req.body.uuid){
        uuid_user = await db.read(`SELECT * FROM user WHERE uuid = ? LIMIT 1`, [req.body.uuid]);
        uuid_user = uuid_user[0];
    }

    // email confirmation is required by default unless:
    // Pseudo user converting and matching uuid is provided
    let email_confirmation_required = 1;
    if(pseudo_user && uuid_user && pseudo_user.id === uuid_user.id)
        email_confirmation_required =  0;

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
    const user_uuid = uuidv4();
    const email_confirm_token = uuidv4();
    let insert_res;
    let email_confirm_code = Math.floor(100000 + Math.random() * 900000);

    const audit_metadata = {
        ip: req.connection.remoteAddress,
        ip_fwd: req.headers['x-forwarded-for'],
        user_agent: req.headers['user-agent'],
        origin: req.headers['origin'],
        server: config.server_id,
    };

    if(pseudo_user === undefined){
        insert_res = await db.write(
            `INSERT INTO user
            (
                username, email, clean_email, password, uuid, referrer, 
                email_confirm_code, email_confirm_token, free_storage, 
                referred_by, audit_metadata, signup_ip, signup_ip_forwarded, 
                signup_user_agent, signup_origin, signup_server
            ) 
            VALUES 
            (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                // username
                req.body.username,
                // email
                req.body.is_temp ? null : req.body.email,
                // normalized email
                req.body.is_temp ? null : clean_email,
                // password
                req.body.is_temp ? null : await bcrypt.hash(req.body.password, 8),
                // uuid
                user_uuid,
                // referrer
                req.body.referrer ?? null,
                // email_confirm_code
                email_confirm_code,
                // email_confirm_token
                email_confirm_token,
                // free_storage
                config.storage_capacity,
                // referred_by
                referred_by_user ? referred_by_user.id : null,
                // audit_metadata
                JSON.stringify(audit_metadata),
                // signup_ip
                req.connection.remoteAddress ?? null,
                // signup_ip_fwd
                req.headers['x-forwarded-for'] ?? null,
                // signup_user_agent
                req.headers['user-agent'] ?? null,
                // signup_origin
                req.headers['origin'] ?? null,
                // signup_server
                config.server_id ?? null,
            ]
        );

        // record activity
        db.write(
            'UPDATE `user` SET `last_activity_ts` = now() WHERE id=? LIMIT 1',
            [insert_res.insertId]
        );
        
        // TODO: cache group id
        const svc_group = req.services.get('group');
        await svc_group.add_users({
            uid: req.body.is_temp ?
                config.default_temp_group : config.default_user_group,
            users: [req.body.username]
        });
    }
    // -----------------------------------
    // Pseudo User converting
    // -----------------------------------
    else{
        insert_res = await db.write(
            `UPDATE user SET
                username = ?, password = ?, uuid = ?, email_confirm_code = ?, email_confirm_token = ?, email_confirmed = ?, requires_email_confirmation = 1,
                referred_by = ?
             WHERE id = ?`,
            [
                // username
                req.body.username,
                // password
                await bcrypt.hash(req.body.password, 8),
                // uuid
                user_uuid,
                // email_confirm_code
                email_confirm_code,
                // email_confirm_token
                email_confirm_token,
                // email_confirmed
                !email_confirmation_required,
                // id
                pseudo_user.id,
                // referred_by
                referred_by_user ? referred_by_user.id : null,
            ]
        );

        // TODO: cache group ids
        const svc_group = req.services.get('group');
        await svc_group.remove_users({
            uid: config.default_temp_group,
            users: [req.body.username],
        });
        await svc_group.add_users({
            uid: config.default_user_group,
            users: [req.body.username]
        });

        // record activity
        db.write('UPDATE `user` SET `last_activity_ts` = now() WHERE id=? LIMIT 1', [pseudo_user.id]);
        invalidate_cached_user_by_id(pseudo_user.id);
    }

    // user id
    // todo if pseudo user, assign directly no need to do another DB lookup
    const user_id = (pseudo_user === undefined) ? insert_res.insertId : pseudo_user.id;

    const [user] = await db.pread(
        'SELECT * FROM `user` WHERE `id` = ? LIMIT 1',
        [user_id]
    );

    // create token for login
    const { token } = await svc_auth.create_session_token(user, {
        req,
    });
        // jwt.sign({uuid: user_uuid}, config.jwt_secret);

    //-------------------------------------------------------------
    // email confirmation
    //-------------------------------------------------------------
    // Email confirmation from signup is sent here
    if((!req.body.is_temp && email_confirmation_required) || user.requires_email_confirmation){
        if(req.body.send_confirmation_code || user.requires_email_confirmation)
            send_email_verification_code(email_confirm_code, user.email);
        else
            send_email_verification_token(user.email_confirm_token, user.email, user.uuid);
    }

    //-------------------------------------------------------------
    // referral code
    //-------------------------------------------------------------
    let referral_code;
    if ( pseudo_user === undefined ) {
        const svc_referralCode = Context.get('services')
            .get('referral-code', { optional: true });
        if ( svc_referralCode ) {
            referral_code = await svc_referralCode.gen_referral_code(user);
        }
    }

    const svc_user = Context.get('services').get('user');
    await svc_user.generate_default_fsentries({ user });

    //set cookie
    res.cookie(config.cookie_name, token, {
        sameSite: 'none',
        secure: true,
        httpOnly: true,
    });

    // add to mailchimp
    if(!req.body.is_temp){
        const svc_event = Context.get('services').get('event');
        svc_event.emit('user.save_account', { user });
    }

    // return results
    return res.send({
        token: token,
        user:{
            username: user.username,
            uuid: user.uuid,
            email: user.email,
            email_confirmed: user.email_confirmed,
            requires_email_confirmation: user.requires_email_confirmation,
            is_temp: (user.password === null && user.email === null),
            taskbar_items: await get_taskbar_items(user),
            referral_code,
        }
    })
});
