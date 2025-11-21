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
const APIError = require('../../api/APIError');
const { DB_WRITE } = require('../../services/database/consts');
const jwt = require('jsonwebtoken');
const validator = require('validator');
const crypto = require('crypto');
const config = require('../../config');
const { Context } = require('../../util/context');
const { v4: uuidv4 } = require('uuid');

module.exports = {
    route: '/change-email',
    methods: ['POST'],
    handler: async (req, res, next) => {
        const user = req.user;
        const new_email = req.body.new_email;

        console.log('DID REACH HERE');

        // TODO: DRY: signup.js
        // validation
        if ( ! new_email ) {
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

        const svc_cleanEmail = req.services.get('clean-email');
        const clean_email = svc_cleanEmail.clean(new_email);

        if ( ! await svc_cleanEmail.validate(clean_email) ) {
            throw APIError.create('email_not_allowed', undefined, {
                email: clean_email,
            });
        }

        // check if email is already in use
        const db = req.services.get('database').get(DB_WRITE, 'auth');
        const rows = await db.read('SELECT COUNT(*) AS `count` FROM `user` WHERE (`email` = ? OR `clean_email` = ?) AND `email_confirmed` = 1',
                        [new_email, clean_email]);

        // TODO: DRY: signup.js, save_account.js
        if ( rows[0].count > 0 ) {
            throw APIError.create('email_already_in_use', null, { email: new_email });
        }

        // If user does not have a confirmed email, then update `email` directly
        // and send a new confirmation email for their account instead.
        if ( ! user.email_confirmed ) {
            const email_confirm_token = uuidv4();
            await db.write('UPDATE `user` SET `email` = ?, `email_confirm_token` = ? WHERE `id` = ?',
                            [new_email, email_confirm_token, user.id]);

            const svc_email = Context.get('services').get('email');
            const link = `${config.origin}/confirm-email-by-token?user_uuid=${user.uuid}&token=${email_confirm_token}`;
            svc_email.send_email({ email: new_email }, 'email_verification_link', { link });

            res.send({ success: true });
            return;
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
        await db.write('UPDATE `user` SET `unconfirmed_change_email` = ?, `change_email_confirm_token` = ? WHERE `id` = ?',
                        [new_email, token, user.id]);

        // Update email change audit table
        await db.write('INSERT INTO `user_update_audit` ' +
            '(`user_id`, `user_id_keep`, `old_email`, `new_email`, `reason`) ' +
            'VALUES (?, ?, ?, ?, ?)',
        [
            req.user.id, req.user.id,
            old_email, new_email,
            'change_username',
        ]);

        res.send({ success: true });
    },
};
