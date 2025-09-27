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
const APIError = require("../../api/APIError");
const eggspress = require("../../api/eggspress");
const { get_app } = require("../../helpers");
const { UserActorType, Actor, AppUnderUserActorType } = require("../../services/auth/Actor");
const { PermissionUtil } = require("../../services/auth/permissionUtils.mjs");
const { Context } = require("../../util/context");

module.exports = eggspress('/auth/check-app', {
    subdomain: 'api',
    auth2: true,
    allowedMethods: ['POST'],
}, async (req, res, next) => {
    const x = Context.get();
    const svc_auth = x.get('services').get('auth');
    const svc_permission = x.get('services').get('permission');

    // Only users can get user-app tokens
    const actor = Context.get('actor');
    if ( ! (actor.type instanceof UserActorType) ) {
        throw APIError.create('forbidden');
    }

    if ( req.body.app_uid === undefined && req.body.origin === undefined ) {
        throw APIError.create('field_missing', null, {
            // TODO: standardize a way to provide multiple options
            key: 'app_uid or origin',
        });
    }

    const app_uid = req.body.app_uid ??
        await svc_auth.app_uid_from_origin(req.body.origin);

    const app = await get_app({ uid: app_uid });
    if ( ! app ) {
        throw APIError.create('app_does_not_exist', null, {
            identifier: app_uid,
        });
    }

    const user = actor.type.user;

    const app_actor = new Actor({
        user_uid: user.uuid,
        app_uid,
        type: new AppUnderUserActorType({
            user,
            app,
        }),
    });

    const reading = await svc_permission.scan(app_actor, 'flag:app-is-authenticated');
    const options = PermissionUtil.reading_to_options(reading);
    const authenticated = options.length > 0;

    let token;
    if ( authenticated ) token = await svc_auth.get_user_app_token(app_uid);

    res.json({
        ...(token ? { token } : {}),
        app_uid: app_uid ||
            await svc_auth.app_uid_from_origin(req.body.origin),
        authenticated,
    });
});

