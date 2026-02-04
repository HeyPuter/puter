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

/**
 * Coerces a read-URL string to the token (JWT) from its query.
 * Works for absolute or relative URLs (e.g. .../token-read?uid=...&token=...).
 * Returns the given value unchanged if it does not look like a read URL.
 */
function tokenOrUuidFromInput (value) {
    if ( typeof value !== 'string' || !value.trim() ) {
        return value;
    }
    const s = value.trim();
    console.log('s?', s);
    if ( s.includes('/token-read') ) {
        try {
            const url = new URL(s);
            const token = url.searchParams.get('token');
            console.log('token?', token);
            return token ?? s;
        } catch (_) {
            return s;
        }
    }
    return s;
}

module.exports = eggspress('/auth/revoke-access-token', {
    subdomain: 'api',
    auth2: true,
    allowedMethods: ['POST'],
}, async (req, res, next) => {
    const x = Context.get();
    const svc_auth = x.get('services').get('auth');

    const raw = req.body.tokenOrUuid;
    if ( raw === undefined || raw === null ) {
        throw APIError.create('field_missing', null, { key: 'tokenOrUuid' });
    }
    const tokenOrUuid = tokenOrUuidFromInput(raw);

    await svc_auth.revoke_access_token(tokenOrUuid);

    res.json({ ok: true });
});
