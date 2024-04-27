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
const validator = require('validator');
const crypto = require('crypto');
const eggspress = require('../api/eggspress.js');
const APIError = require('../api/APIError.js');
const { DB_READ, DB_WRITE } = require('../services/database/consts.js');

const config = require('../config.js');

const jwt = require('jsonwebtoken');
const { invalidate_cached_user_by_id } = require('../helpers.js');

const CHANGE_EMAIL_START = eggspress('/change_email/start', {
    subdomain: 'api',
    auth: true,
    verified: true,
    allowedMethods: ['POST'],
}, async (req, res, next) => {
    const user = req.user;
    const new_email = req.body.new_email;

    // TODO: DRY: signup.js
    // validation
    if( ! new_email ) {
        throw APIError.create('field_missing', null, { key: 'new_email' });
    }
    if ( typeof new_email !== 'string' ) {
        throw APIError.create('field_invalid', null, {
            key: 'new_email', expected: 'a valid email address' });
    }
    if ( ! validator.isEmail(new_email) ) {
        throw APIError.create('field_invalid', null, {
            key: 'new_email', expected: 'a valid email address' });
    }

    const svc_edgeRateLimit = req.services.get('edge-rate-limit');
    if ( ! svc_edgeRateLimit.check('change-email-start') ) {
        return res.status(429).send('Too many requests.');
    }

    // check if email is already in use
    const db = req.services.get('database').get(DB_WRITE, 'auth');
    const rows = await db.read(
        'SELECT COUNT(*) AS `count` FROM `user` WHERE `email` = ?',
        [new_email]
    );
    if ( rows[0].count > 0 ) {
        throw APIError.create('email_already_in_use', null, { email: new_email });
    }

    // generate confirmation token
    const token = crypto.randomBytes(4).toString('hex');
    const jwt_token = jwt.sign({
        user_id: user.id,
        token,
    }, config.jwt_secret, { expiresIn: '24h' });

    // send confirmation email
    const svc_email = req.services.get('email');
    await svc_email.send_email({ email: new_email }, 'email_change_request', {
        confirm_url: `${config.origin}/change_email/confirm?token=${jwt_token}`,
        username: user.username,
    });
    const old_email = user.email;
    // TODO: NotificationService
    await svc_email.send_email({ email: old_email }, 'email_change_notification', {
        new_email: new_email,
    });

    // update user
    await db.write(
        'UPDATE `user` SET `unconfirmed_change_email` = ?, `change_email_confirm_token` = ? WHERE `id` = ?',
        [new_email, token, user.id]
    );

    res.send({ success: true });
});

const CHANGE_EMAIL_CONFIRM = eggspress('/change_email/confirm', {
    allowedMethods: ['GET'],
}, async (req, res, next) => {
    const jwt_token = req.query.token;

    if ( ! jwt_token ) {
        throw APIError.create('field_missing', null, { key: 'token' });
    }

    const svc_edgeRateLimit = req.services.get('edge-rate-limit');
    if ( ! svc_edgeRateLimit.check('change-email-confirm') ) {
        return res.status(429).send('Too many requests.');
    }

    const { token, user_id } = jwt.verify(jwt_token, config.jwt_secret);

    const db = req.services.get('database').get(DB_WRITE, 'auth');
    const rows = await db.read(
        'SELECT `unconfirmed_change_email` FROM `user` WHERE `id` = ? AND `change_email_confirm_token` = ?',
        [user_id, token]
    );
    if ( rows.length === 0 ) {
        throw APIError.create('token_invalid');
    }

    const new_email = rows[0].unconfirmed_change_email;

    await db.write(
        'UPDATE `user` SET `email` = ?, `unconfirmed_change_email` = NULL, `change_email_confirm_token` = NULL WHERE `id` = ?',
        [new_email, user_id]
    );

    invalidate_cached_user_by_id(user_id);
    let socketio = require('../socketio.js').getio();
    if(socketio){
        socketio.to(user_id).emit('user.email_changed', {})
    }

    const h = `<p style="text-align:center; color:green;">Your email has been successfully confirmed.</p>`;
    return res.send(h);
});

module.exports = app => {
    app.use(CHANGE_EMAIL_START);
    app.use(CHANGE_EMAIL_CONFIRM);
}
