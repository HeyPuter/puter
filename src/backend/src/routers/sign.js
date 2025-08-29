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
const {sign_file, get_app}  = require('../helpers');
const eggspress = require('../api/eggspress.js');
const APIError = require('../api/APIError.js');
const { Context } = require('../util/context.js');
const { UserActorType, AppUnderUserActorType } = require('../services/auth/Actor.js');
const { NodePathSelector } = require('../filesystem/node/selectors.js');

// -----------------------------------------------------------------------//
// POST /sign
// -----------------------------------------------------------------------//
module.exports = eggspress('/sign', {
    subdomain: 'api',
    auth2: true,
    verified: true,
    json: true,
    allowedMethods: ['POST'],
}, async (req, res, next)=>{
    const actor = Context.get('actor');
    const svc_fs = Context.get('services').get('filesystem');

    if(!req.body.items) {
        throw APIError.create('field_missing', null, { key: 'items' });
    }

    let items = Array.isArray(req.body.items) ? req.body.items : [res];
    let signatures = [];

    // Static request validation happens first
    for ( const item of items ) {
        if ( ! item ) {
            throw APIError.create('field_invalid', null, {
                key: `items`,
                expected: 'each item to have: (uid OR path) AND action'
            }).serialize()
        }

        if ( typeof item !== 'object' || Array.isArray(item) ) {
            throw APIError.create('field_invalid', null, {
                key: `items`,
                expected: 'each item to be an object'
            }).serialize()
        }

        // validation
        if((!item.uid && !item.path)|| !item.action){
            throw APIError.create('field_invalid', null, {
                key: `items`,
                expected: 'each item to have: (uid OR path) AND action'
            }).serialize()
        }

        if ( typeof item.uid !== 'string' && typeof item.path !== 'string' ) {
            throw APIError.create('field_invalid', null, {
                key: `items`,
                expected: 'each item to have only string values for uid and path'
            }).serialize()
        }
    }
    
    // Usually, only users can sign
    if ( ! (actor.type instanceof UserActorType) ) {
        
        if ( ! (actor.type instanceof AppUnderUserActorType) ) {
            throw APIError.create('forbidden');
        }
        
        // But, apps can sign files in their own AppData directory
        for ( const item of req.body.items ) {
            const node = await svc_fs.node(item);
            const appdata_path = `/${actor.type.user.username}/AppData/${actor.type.app.uid}`
            const appdata_node = await svc_fs.node(new NodePathSelector(appdata_path));
            if ( ! appdata_node.is_above(node) ) {
                throw APIError.create('forbidden');
            }
        }
    }


    const result = {
        signatures
    };

    let app = null;
    if ( req.body.app_uid ) {
        if ( typeof req.body.app_uid !== 'string' ) {
            throw APIError.create('field_invalid', null, {
                key: 'app_uid',
                expected: 'string'
            });
        }

        app = await get_app({ uid: req.body.app_uid });
        if ( ! app ) {
            // FIXME: subject.entry.name isn't available here
            throw APIError.create('no_suitable_app', null); //, { entry_name: subject.entry.name });
        }
        // Generate user-app token
        const svc_auth = Context.get('services').get('auth');
        const token = await svc_auth.get_user_app_token(app.uid);
        result.token = token;
    }

    for ( const item of items ) {
        const node = await svc_fs.node(item);

        if ( ! await node.exists() ) {
            // throw APIError.create('subject_does_not_exist').serialize()
            signatures.push({})
            continue;
        }

        const svc_acl = Context.get('services').get('acl');
        if ( ! await svc_acl.check(actor, node, 'read') ) {
            throw await svc_acl.get_safe_acl_error(actor, node, 'read');
        }
        
        if ( item.action === 'write' ) {
            if ( ! await svc_acl.check(actor, node, 'write') ) {
                item.action = 'read';
            }
        }

        if ( app !== null ) {
            // Grant write permission to app
            const svc_permission = Context.get('services').get('permission');
            const permission = `fs:${await node.get('uid')}:write`;
            await svc_permission.grant_user_app_permission(
                actor, app.uid, permission, {}, { reason: 'endpoint:sign' }
            );
        }

        // sign
        try{
            let signature = await sign_file(node.entry, item.action)
            signature.path = signature.path ?? item.path ?? await node.get('path');
            signatures.push(signature);
        }
        catch(e){
            signatures.push({})
        }
    }


    res.send(result);
})
