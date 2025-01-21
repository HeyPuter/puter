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
const { UserActorType } = require("../../services/auth/Actor");
const { Context } = require("../../util/context");

module.exports = eggspress('/auth/revoke-user-group', {
    subdomain: 'api',
    auth2: true,
    allowedMethods: ['POST'],
}, async (req, res, next) => {
    const x = Context.get();
    const svc_permission = x.get('services').get('permission');

    // Only users can grant user-user permissions
    const actor = Context.get('actor');
    if ( ! (actor.type instanceof UserActorType) ) {
        throw APIError.create('forbidden');
    }

    if ( ! req.body.group_uid ) {
        throw APIError.create('field_missing', null, {
            key: 'group_uid'
        });
    }

    if ( ! req.body.permission ) {
        throw APIError.create('field_missing', null, {
            key: 'permission'
        });
    }

    await svc_permission.revoke_user_group_permission(
        actor, req.body.group_uid, req.body.permission,
        req.body.meta || {}
    );

    res.json({});
});

