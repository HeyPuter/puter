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
const eggspress = require("../../api/eggspress");
const { get_app, get_user } = require("../../helpers");
const { UserActorType } = require("../../services/auth/Actor");
const { DB_READ } = require("../../services/database/consts");
const { Context } = require("../../util/context");
const APIError = require('../../api/APIError');

module.exports = eggspress('/auth/list-permissions', {
    subdomain: 'api',
    auth2: true,
    allowedMethods: ['GET'],
}, async (req, res, next) => {
    const x = Context.get();

    const actor = x.get('actor');

    // Apps cannot (currently) check permissions on behalf of users
    if ( ! ( actor.type instanceof UserActorType ) ) {
        throw APIError.create('forbidden');
    }

    const db = x.get('services').get('database').get(DB_READ, 'permissions');

    const permissions = {};

    {
        permissions.myself_to_app = [];

        const rows = await db.read(
            'SELECT * FROM `user_to_app_permissions` WHERE user_id=?',
            [ actor.type.user.id ]
        );

        for ( const row of rows ) {
            const app = await get_app({ id: row.app_id });

            delete app.id;
            delete app.approved_for_listing;
            delete app.approved_for_opening_items;
            delete app.godmode;
            delete app.owner_user_id;

            const permission = {
                app,
                permission: row.permission,
                extra: row.extra
            };

            permissions.myself_to_app.push(permission);
        }
    }
    {
        permissions.myself_to_user = [];

        const rows = await db.read(
            'SELECT * FROM `user_to_user_permissions` WHERE issuer_user_id=?',
            [ actor.type.user.id ]
        );

        for ( const row of rows ) {
            const user = await get_user({ id: row.holder_user_id });

            const permission = {
                user: user.username,
                permission: row.permission,
                extra: row.extra
            };

            permissions.myself_to_user.push(permission);
        }
    }
    {
        permissions.user_to_myself = [];

        const rows = await db.read(
            'SELECT * FROM `user_to_user_permissions` WHERE holder_user_id=?',
            [ actor.type.user.id ]
        );

        for ( const row of rows ) {
            const user = await get_user({ id: row.issuer_user_id });

            const permission = {
                user: user.username,
                permission: row.permission,
                extra: row.extra
            };

            permissions.user_to_myself.push(permission);
        }
    }

    res.json(permissions);
});
