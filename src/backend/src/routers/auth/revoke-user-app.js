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
const eggspress = require("../../api/eggspress");
const { UserActorType } = require("../../services/auth/Actor");
const { Context } = require("../../util/context");
const APIError = require('../../api/APIError');

module.exports = eggspress('/auth/revoke-user-app', {
    subdomain: 'api',
    auth2: true,
    allowedMethods: ['POST'],
}, async (req, res, next) => {
    const x = Context.get();
    const svc_permission = x.get('services').get('permission');

    // Only users can grant user-app permissions
    const actor = Context.get('actor');
    if ( ! (actor.type instanceof UserActorType) ) {
        throw APIError.create('forbidden');
    }

    if ( req.body.origin ) {
        const svc_auth = x.get('services').get('auth');
        req.body.app_uid = await svc_auth.app_uid_from_origin(req.body.origin);
    }

    if ( ! req.body.app_uid ) {
        throw APIError.create('field_missing', null, { key: 'app_uid' });
    }

    if ( req.body.permission === '*' ) {
        await svc_permission.revoke_user_app_all(
            actor, req.body.app_uid, req.body.meta || {},
        );
    }

    await svc_permission.revoke_user_app_permission(
        actor, req.body.app_uid, req.body.permission,
        req.body.meta || {},
    );

    res.json({});
});


