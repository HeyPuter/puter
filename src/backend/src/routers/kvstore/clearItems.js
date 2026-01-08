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
const eggspress = require('../../api/eggspress');

module.exports = eggspress('/clearItems', {
    subdomain: 'api',
    auth: true,
    verified: true,
    allowedMethods: ['POST'],
}, async (req, res, next) => {

    // TODO: model these parameters; validation is contained in brackets
    // so that it can be easily move.
    let { app } = req.body;

    // Validation for `app`
    if ( ! app ) {
        throw APIError.create('field_missing', null, { key: 'app' });
    }

    const svc_mysql = req.services.get('mysql');
    // TODO: Check if used anywhere, maybe remove
    // eslint-disable-next-line no-undef
    const dbrw = svc_mysql.get(DB_MODE_WRITE, 'kvstore-clearItems');
    await dbrw.execute('DELETE FROM kv WHERE user_id=? AND app=?',
                    [
                        req.user.id,
                        app,
                    ]);

    return res.send({});
});
