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
const eggspress = require('../../api/eggspress');
const APIError = require('../../api/APIError');
const { AppUnderUserActorType } = require('../../services/auth/Actor');
const { Context } = require('../../util/context');
const { validate_fields } = require('../../util/validutil');
const { get_app } = require('../../helpers');
const { NodeInternalIDSelector } = require('../../filesystem/node/selectors');
const { HLStat } = require('../../filesystem/hl_operations/hl_stat');
const { PermissionUtil } = require('../../services/auth/permissionUtils.mjs');
const { quot } = require('@heyputer/putility').libs.string;

module.exports = eggspress('/auth/request-app-root-dir', {
    subdomain: 'api',
    auth2: true,
    allowedMethods: ['POST'],
}, async (req, res) => {
    const context = Context.get();
    const actor = context.get('actor');

    if ( ! (actor.type instanceof AppUnderUserActorType) ) {
        throw APIError.create('forbidden', null, { debug_reason: 'not app actor' });
    }

    validate_fields({
        app_uid: { type: 'string', optional: false },
        access: { type: 'string', optional: false },
    }, req.body);

    const { app_uid: target_app_uid, access } = req.body;
    if ( access !== 'read' && access !== 'write' ) {
        throw APIError.create('field_invalid', null, {
            key: 'access',
            expected: "'read' or 'write'",
            got: access,
        });
    }

    if ( ! target_app_uid ) {
        throw APIError.create('field_invalid', null, {
            key: 'resource_request_code',
            expected: 'app_uid',
            got: target_app_uid,
        });
    }

    const target_app = await get_app({ uid: target_app_uid });
    if ( ! target_app ) {
        throw APIError.create('entity_not_found', null, { identifier: `app:${target_app_uid}` });
    }

    if ( target_app.owner_user_id !== actor.type.user.id ) {
        throw APIError.create('forbidden', null, {
            debug_reason: 'Expected to match: ' +
                `${quot(target_app.owner_user_id)} and ${quot(actor.type.user.id)}`,
        });
    }

    const svc_app = context.get('services').get('app');
    const root_dir_id = await svc_app.getAppRootDirId(target_app);
    const svc_fs = context.get('services').get('filesystem');
    const node = await svc_fs.node(new NodeInternalIDSelector('mysql', root_dir_id));
    await node.fetchEntry();
    if ( ! node.found ) {
        throw APIError.create('subject_does_not_exist');
    }

    const node_uid = await node.get('uid');
    const fs_perm = PermissionUtil.join('fs', node_uid, access);
    const svc_permission = context.get('services').get('permission');
    const has_perm = await svc_permission.check(actor, fs_perm);
    if ( ! has_perm ) {
        throw APIError.create('permission_denied', null, { permission: fs_perm });
    }

    const hl_stat = new HLStat();
    const stat_result = await hl_stat.run({
        subject: node,
        user: actor.type.user,
        return_subdomains: false,
        return_permissions: false,
        return_shares: false,
        return_versions: false,
        return_size: true,
    });

    res.json(stat_result);
});
