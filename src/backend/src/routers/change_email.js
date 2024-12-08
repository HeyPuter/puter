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
const eggspress = require('../api/eggspress.js');
const APIError = require('../api/APIError.js');
const { DB_WRITE } = require('../services/database/consts.js');

const config = require('../config.js');

const jwt = require('jsonwebtoken');
const { invalidate_cached_user_by_id } = require('../helpers.js');

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

    const svc_cleanEmail = req.services.get('clean-email');
    const clean_email = svc_cleanEmail.clean(rows[0].unconfirmed_change_email);

    // Scenario: email was confirmed on another account already
    const rows2 = await db.read(
        'SELECT `id` FROM `user` WHERE `email` = ? OR `clean_email` = ?',
        [rows[0].unconfirmed_change_email, clean_email]
    );
    if ( rows2.length > 0 ) {
        throw APIError.create('email_already_in_use');
    }

    // If other users have the same unconfirmed email, revoke it
    await db.write(
        'UPDATE `user` SET `unconfirmed_change_email` = NULL, `email_confirmed`=1, `change_email_confirm_token` = NULL WHERE `id` = ?',
        [user_id]
    );

    const new_email = rows[0].unconfirmed_change_email;

    await db.write(
        'UPDATE `user` SET `email` = ?, `clean_email` = ?, `unconfirmed_change_email` = NULL, `change_email_confirm_token` = NULL, `pass_recovery_token` = NULL WHERE `id` = ?',
        [new_email, clean_email, user_id]
    );
    
    const svc_event = req.services.get('event');
    svc_event.emit('user.email-changed', {
        user_id: user_id,
        new_email,
    });

    invalidate_cached_user_by_id(user_id);
    const svc_socketio = req.services.get('socketio');
    svc_socketio.send({ room: user_id }, 'user.email_changed', {});

    const h = `<p style="text-align:center; color:green;">Your email has been successfully confirmed.</p>`;
    return res.send(h);
});

module.exports = app => {
    app.use(CHANGE_EMAIL_CONFIRM);
}
