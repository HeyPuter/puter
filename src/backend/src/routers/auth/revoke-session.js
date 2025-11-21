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
const { UserActorType } = require('../../services/auth/Actor');
const { Context } = require('../../util/context');

module.exports = eggspress('/auth/revoke-session', {
    subdomain: 'api',
    auth2: true,
    allowedMethods: ['POST'],
}, async (req, res, next) => {
    const x = Context.get();
    const svc_auth = x.get('services').get('auth');

    // Only users can list their own sessions
    // apps, access tokens, etc should NEVER access this
    const actor = x.get('actor');
    if ( ! (actor.type instanceof UserActorType) ) {
        throw APIError.create('forbidden');
    }

    const svc_antiCSRF = req.services.get('anti-csrf');
    if ( ! svc_antiCSRF.consume_token(actor.type.user.uuid, req.body.anti_csrf) ) {
        return res.status(400).json({ message: 'incorrect anti-CSRF token' });
    }

    // Ensure valid UUID
    if ( !req.body.uuid || typeof req.body.uuid !== 'string' ) {
        throw APIError.create('field_invalid', null, {
            key: 'uuid',
            expected: 'string',
        });
    }

    const sessions = await svc_auth.revoke_session(actor, req.body.uuid);

    res.json({ sessions });
});
