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

module.exports = eggspress('/auth/create-access-token', {
    subdomain: 'api',
    auth2: true,
    allowedMethods: ['POST'],
}, async (req, res, next) => {
    const x = Context.get();
    const svc_auth = x.get('services').get('auth');

    const permissions = req.body.permissions || [];

    if ( permissions.length === 0 ) {
        throw APIError.create('field_missing', null, { key: 'permissions' });
    }

    for ( let i = 0 ; i < permissions.length ; i++ ) {
        let perm = permissions[i];
        if ( typeof perm === 'string' ) {
            perm = permissions[i] = [perm];
        }
        if ( ! Array.isArray(perm) ) {
            throw APIError.create('field_invalid', null, { key: 'permissions' });
        }
        if ( perm.length === 0 || perm.length > 2 ) {
            throw APIError.create('field_invalid', null, { key: 'permissions' });
        }
        if ( typeof perm[0] !== 'string' ) {
            throw APIError.create('field_invalid', null, { key: 'permissions' });
        }
        if ( perm.length === 2 && typeof perm[1] !== 'object' ) {
            throw APIError.create('field_invalid', null, { key: 'permissions' });
        }
    }

    const actor = Context.get('actor');

    const options = {
        ...(req.body.expiresIn ? { expiresIn: `${ req.body.expiresIn}` } : {}),
    };

    const token = await svc_auth.create_access_token(actor, permissions, options);

    res.json({ token });
});
