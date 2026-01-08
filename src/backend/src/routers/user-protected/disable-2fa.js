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
const { DB_WRITE } = require('../../services/database/consts');

module.exports = {
    route: '/disable-2fa',
    methods: ['POST'],
    handler: async (req, res, next) => {
        const db = req.services.get('database').get(DB_WRITE, '2fa.disable');
        await db.write('UPDATE user SET otp_enabled = 0, otp_recovery_codes = NULL, otp_secret = NULL WHERE uuid = ?',
                        [req.user.uuid]);
        // update cached user
        req.user.otp_enabled = 0;

        const svc_email = req.services.get('email');
        await svc_email.send_email({ email: req.user.email }, 'disabled_2fa', {
            username: req.user.username,
        });

        res.send({ success: true });
    },
};
