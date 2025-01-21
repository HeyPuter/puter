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
"use strict"
const eggspress = require('../api/eggspress.js');
const FSNodeParam = require('../api/filesystem/FSNodeParam.js');
const { Context } = require('../util/context.js');
const { UserActorType } = require('../services/auth/Actor.js');
const APIError = require('../api/APIError.js');
const { sign_file, suggest_app_for_fsentry, get_app } = require('../helpers.js');

// -----------------------------------------------------------------------//
// POST /open_item
// -----------------------------------------------------------------------//
module.exports = eggspress('/open_item', {
    subdomain: 'api',
    auth2: true,
    verified: true,
    json: true,
    allowedMethods: ['POST'],
    alias: { uid: 'path' },
    parameters: {
        subject: new FSNodeParam('path'),
    }
}, async (req, res, next) => {
    const subject = req.values.subject;

    const actor = Context.get('actor');
    if ( ! (actor.type instanceof UserActorType) ) {
        throw APIError.create('forbidden');
    }

    if ( ! await subject.exists() ) {
        throw APIError.create('subject_does_not_exist');
    }

    const svc_acl = Context.get('services').get('acl');
    if ( ! await svc_acl.check(actor, subject, 'read') ) {
        throw await svc_acl.get_safe_acl_error(actor, subject, 'read');
    }
    
    let action = 'write';
    if ( ! await svc_acl.check(actor, subject, 'write') ) {
        action = 'read';
    }

    const signature = await sign_file(subject.entry, action);
    const suggested_apps = await suggest_app_for_fsentry(subject.entry);
    const apps_only_one = suggested_apps.slice(0,1);
    const _app = apps_only_one[0];
    if ( ! _app ) {
        throw APIError.create('no_suitable_app', null, { entry_name: subject.entry.name });
    }
    const app = await get_app(
        _app.hasOwnProperty('id')
            ? { id: _app.id }
            : { uid: _app.uid }
    ) ?? apps_only_one[0];

    if ( ! app ) {
        throw APIError.create('no_suitable_app', null, { entry_name: subject.entry.name });
    }

    // Grant permission to open the file
    // Note: We always grant write permission here. If the user only
    //       has read permission this is still safe; user permissions
    //       are always checked during an app access.
    const PERMS = action === 'write' ? ['read', 'write'] : ['read'];
    for ( const perm of PERMS ) {
        const permission = `fs:${subject.uid}:${perm}`;
        const svc_permission = Context.get('services').get('permission');
        await svc_permission.grant_user_app_permission(
            actor, app.uid, permission, {}, { reason: 'open_item' }
        );
    }

    // Generate user-app token
    const svc_auth = Context.get('services').get('auth');
    const token = await svc_auth.get_user_app_token(app.uid);

    // TODO: DRY
    // remove some privileged information
    delete app.id;
    delete app.approved_for_listing;
    delete app.approved_for_opening_items;
    delete app.godmode;
    delete app.owner_user_id;

    return res.send({
        signature: signature,
        token,
        suggested_apps: [app],
    });
});
