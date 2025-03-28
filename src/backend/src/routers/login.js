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
const { get_user, body_parser_error_handler } = require('../helpers');
const config = require('../config');
const { DB_WRITE } = require('../services/database/consts');
const { requireCaptcha } = require('../modules/captcha/middleware/captcha-middleware');


const complete_ = async ({ req, res, user }) => {
    const svc_auth = req.services.get('auth');
    const { token } = await svc_auth.create_session_token(user, { req });

    //set cookie
    // res.cookie(config.cookie_name, token);
    res.cookie(config.cookie_name, token, {
        sameSite: 'none',
        secure: true,
        httpOnly: true,
    });

    // send response
    console.log('200 response?');
    return res.send({
        proceed: true,
        next_step: 'complete',
        token: token,
        user:{
            username: user.username,
            uuid: user.uuid,
            email: user.email,
            email_confirmed: user.email_confirmed,
            is_temp: (user.password === null && user.email === null),
        }
    })
};

// -----------------------------------------------------------------------//
// POST /file
// -----------------------------------------------------------------------//
router.post('/login', express.json(), body_parser_error_handler, 
    // Add diagnostic middleware to log captcha data
    (req, res, next) => {
        console.log('====== LOGIN CAPTCHA DIAGNOSTIC ======');
        console.log('LOGIN REQUEST RECEIVED with captcha data:', {
            hasCaptchaToken: !!req.body.captchaToken,
            hasCaptchaAnswer: !!req.body.captchaAnswer,
            captchaToken: req.body.captchaToken ? req.body.captchaToken.substring(0, 8) + '...' : undefined,
            captchaAnswer: req.body.captchaAnswer
        });
        next();
    },
    requireCaptcha({ strictMode: true, eventType: 'login' }), 
    async (req, res, next)=>{
    // either api. subdomain or no subdomain
    if(require('../helpers').subdomain(req) !== 'api' && require('../helpers').subdomain(req) !== '')
        next();

    // modules
    const bcrypt = require('bcrypt')
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

    const svc_edgeRateLimit = req.services.get('edge-rate-limit');
    if ( ! svc_edgeRateLimit.check('login') ) {
        return res.status(429).send('Too many requests.');
    }

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
        if (user.username === 'system' && config.allow_system_login !== true) {
            return res.status(400).send(
                req.body.username
                    ? 'Username not found.'
                    : 'Email not found.'
            )
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
            // We create a JWT that can ONLY be used on the endpoint that
            // accepts the OTP code.
            if ( user.otp_enabled ) {
                const svc_token = req.services.get('token');
                const otp_jwt_token = svc_token.sign('otp', {
                    user_uid: user.uuid,
                }, { expiresIn: '5m' });

                return res.status(202).send({
                    proceed: true,
                    next_step: 'otp',
                    otp_jwt_token: otp_jwt_token,
                });
            }

            console.log('UMM?');
            return await complete_({ req, res, user });
        }else{
            return res.status(400).send('Incorrect password.')
        }
    }catch(e){
        console.error(e);
        return res.status(400).send(e);
    }

})

router.post('/login/otp', express.json(), body_parser_error_handler, requireCaptcha({ strictMode: true, eventType: 'login_otp' }), async (req, res, next) => {
    // either api. subdomain or no subdomain
    if(require('../helpers').subdomain(req) !== 'api' && require('../helpers').subdomain(req) !== '')
        next();

    const svc_edgeRateLimit = req.services.get('edge-rate-limit');
    if ( ! svc_edgeRateLimit.check('login-otp') ) {
        return res.status(429).send('Too many requests.');
    }

    if ( ! req.body.token ) {
        return res.status(400).send('token is required.');
    }

    if ( ! req.body.code ) {
        return res.status(400).send('code is required.');
    }

    const svc_token = req.services.get('token');
    let decoded; try {
        decoded = svc_token.verify('otp', req.body.token);
    } catch ( e ) {
        return res.status(400).send('Invalid token.');
    }

    if ( ! decoded.user_uid ) {
        return res.status(400).send('Invalid token.');
    }

    const user = await get_user({ uuid: decoded.user_uid, cached: false });
    if ( ! user ) {
        return res.status(400).send('User not found.');
    }

    const svc_otp = req.services.get('otp');
    if ( ! svc_otp.verify(user.username, user.otp_secret, req.body.code) ) {

        // THIS MAY BE COUNTER-INTUITIVE
        //
        // A successfully handled request, with the correct format,
        // but incorrect credentials when NOT using the HTTP
        // authentication framework provided by RFC 7235, SHOULD
        // return status 200.
        //
        // Source: I asked Julian Reschke in an email, and then he
        // contributed to this discussion:
        // https://stackoverflow.com/questions/32752578

        return res.status(200).send({
            proceed: false,
        });
    }

    return await complete_({ req, res, user });
});

router.post('/login/recovery-code', express.json(), body_parser_error_handler, requireCaptcha({ strictMode: true, eventType: 'login_recovery' }), async (req, res, next) => {
    // either api. subdomain or no subdomain
    if(require('../helpers').subdomain(req) !== 'api' && require('../helpers').subdomain(req) !== '')
        next();

    const svc_edgeRateLimit = req.services.get('edge-rate-limit');
    if ( ! svc_edgeRateLimit.check('login-recovery') ) {
        return res.status(429).send('Too many requests.');
    }

    if ( ! req.body.token ) {
        return res.status(400).send('token is required.');
    }

    if ( ! req.body.code ) {
        return res.status(400).send('code is required.');
    }

    const svc_token = req.services.get('token');
    let decoded; try {
        decoded = svc_token.verify('otp', req.body.token);
    } catch ( e ) {
        return res.status(400).send('Invalid token.');
    }

    if ( ! decoded.user_uid ) {
        return res.status(400).send('Invalid token.');
    }

    const user = await get_user({ uuid: decoded.user_uid, cached: false });
    if ( ! user ) {
        return res.status(400).send('User not found.');
    }

    const code = req.body.code;

    const crypto = require('crypto');

    const codes = user.otp_recovery_codes.split(',');
    const hashed_code = crypto
        .createHash('sha256')
        .update(code)
        .digest('base64')
        // We're truncating the hash for easier storage, so we have 128
        // bits of entropy instead of 256. This is plenty for recovery
        // codes, which have only 48 bits of entropy to begin with.
        .slice(0, 22);

    if ( ! codes.includes(hashed_code) ) {
        return res.status(200).send({
            proceed: false,
        });
    }

    // Remove the code from the list
    const index = codes.indexOf(hashed_code);
    codes.splice(index, 1);
    
    // update user
    const db = req.services.get('database').get(DB_WRITE, '2fa');
    await db.write(
        `UPDATE user SET otp_recovery_codes = ? WHERE uuid = ?`,
        [codes.join(','), user.uuid]
    );
    user.otp_recovery_codes = codes.join(',');

    return await complete_({ req, res, user });
});

module.exports = router;
