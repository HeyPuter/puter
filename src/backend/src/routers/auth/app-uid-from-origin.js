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
const { Context } = require('../../util/context');

module.exports = eggspress('/auth/app-uid-from-origin', {
    subdomain: 'api',
    auth2: true,
    allowedMethods: ['POST', 'GET'],
}, async (req, res, next) => {
    const x = Context.get();
    const svc_auth = x.get('services').get('auth');

    const origin = req.body.origin || req.query.origin;

    if ( ! origin ) {
        throw APIError.create('field_missing', null, { key: 'origin' });
    }

    res.json({
        uid: await svc_auth.app_uid_from_origin(origin),
    });
});
