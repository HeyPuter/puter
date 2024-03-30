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

    // check if email is already in use
    const svc_mysql = req.services.get('mysql');
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

    // update user
    await db.write(
        'UPDATE `user` SET `unconfirmed_change_email` = ?, `change_email_confirm_token` = ? WHERE `id` = ?',
        [new_email, token, user.id]
    );
});

const CHANGE_EMAIL_CONFIRM = eggspress('/change_email/confirm', {
    subdomain: 'api',
    auth: true,
    verified: true,
    allowedMethods: ['POST'],
}, async (req, res, next) => {
    const user = req.user;
    const token = req.body.token;

    if ( ! token ) {
        throw APIError.create('field_missing', null, { key: 'token' });
    }

    const svc_mysql = req.services.get('mysql');
    const dbrr = svc_mysql.get(DB_MODE_READ, 'change-email-confirm');
    const [rows] = await dbrr.promise().query(
        'SELECT `unconfirmed_change_email` FROM `user` WHERE `id` = ? AND `change_email_confirm_token` = ?',
        [user.id, token]
    );
    if ( rows.length === 0 ) {
        throw APIError.create('token_invalid');
    }

    const new_email = rows[0].unconfirmed_change_email;

    const db = req.services.get('database').get(DB_WRITE, 'auth');
    await db.write(
        'UPDATE `user` SET `email` = ?, `unconfirmed_change_email` = NULL, `change_email_confirm_token` = NULL WHERE `id` = ?',
        [new_email, user.id]
    );
});

module.exports = app => {
    app.use(CHANGE_EMAIL_START);
    app.use(CHANGE_EMAIL_CONFIRM);
}
