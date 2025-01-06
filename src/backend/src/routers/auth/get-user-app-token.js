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
const { LLMkdir } = require("../../filesystem/ll_operations/ll_mkdir");
const { NodeUIDSelector, NodePathSelector } = require("../../filesystem/node/selectors");
const { NodeChildSelector } = require("../../filesystem/node/selectors");
const { get_app } = require("../../helpers");
const { UserActorType } = require("../../services/auth/Actor");
const { Context } = require("../../util/context");

module.exports = eggspress('/auth/get-user-app-token', {
    subdomain: 'api',
    auth2: true,
    allowedMethods: ['POST'],
}, async (req, res, next) => {
    const x = Context.get();
    const svc_auth = x.get('services').get('auth');

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

    const token = ( req.body.app_uid !== undefined )
        ? await svc_auth.get_user_app_token(req.body.app_uid)
        : await svc_auth.get_user_app_token_from_origin(req.body.origin)
        ;

    const app_uid = req.body.app_uid ??
        await svc_auth.app_uid_from_origin(req.body.origin);

    const app = await get_app({ uid: app_uid });
    if ( ! app ) {
        throw APIError.create('app_does_not_exist', null, {
            identifier: app_uid,
        });
    }

    const svc_fs = x.get('services').get('filesystem');
    const appdata_dir_sel = actor.type.user.appdata_uuid
        ? new NodeUIDSelector(actor.type.user.appdata_uuid)
        : new NodePathSelector(`/${actor.type.user.username}/AppData`);
    const appdata_app_dir_node = await svc_fs.node(new NodeChildSelector(
        appdata_dir_sel,
        app_uid,
    ));

    if ( ! await appdata_app_dir_node.exists() ) {
        const ll_mkdir = new LLMkdir();
        await ll_mkdir.run({
            thumbnail: app.icon,
            parent: await svc_fs.node(appdata_dir_sel),
            name: app_uid,
            actor: actor,
        });
    }

    const svc_permission = x.get('services').get('permission');
    svc_permission.grant_user_app_permission(actor, app_uid, 'flag:app-is-authenticated');

    res.json({
        token,
        app_uid: app_uid ||
            await svc_auth.app_uid_from_origin(req.body.origin),
    });
});
