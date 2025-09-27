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
const { AppUnderUserActorType, UserActorType } = require("../../services/auth/Actor");
const { PermissionUtil } = require("../../services/auth/PermissionUtils.mjs");
const { Context } = require("../../util/context");
const { BaseES } = require("./BaseES");

class ProtectedAppES extends BaseES {
    async select (options){
        const results = await this.upstream.select(options);
        
        const actor = Context.get('actor');
        const services = Context.get('services');
        
        const to_delete = [];
        for ( let i=0 ; i < results.length ; i++ ) {
            const entity = results[i];
            
            if ( ! await this.check_({ actor, services }, entity) ) {
                continue;
            }
            
            to_delete.push(i);
        }
        
        const svc_utilArray = services.get('util-array');
        svc_utilArray.remove_marked_items(to_delete, results);
        
        return results;
    }
    
    async read (uid){
        const entity = await this.upstream.read(uid);
        if ( ! entity ) return null;
        
        const actor = Context.get('actor');
        const services = Context.get('services');

        if ( await this.check_({ actor, services }, entity) ) {
            return null;
        }
        
        return entity;
    }
    
    /**
     * returns true if the entity should not be sent downstream
     */
    async check_ ({ actor, services }, entity) {
        // track: ruleset
        {
            // if it's not a protected app, no worries
            if ( ! await entity.get('protected') ) return;
            
            // if actor is this app, no worries
            if (
                actor.type instanceof AppUnderUserActorType &&
                await entity.get('uid') === actor.type.app.uid
            ) return;
            
            // if actor is owner of this app, no worries
            if (
                actor.type instanceof UserActorType &&
                (await entity.get('owner')).id === actor.type.user.id
            ) return;
        }
        
        // now we need to check for permission
        const app_uid = await entity.get('uid');
        const svc_permission = services.get('permission');
        const permission_to_check = `app:uid#${app_uid}:access`;
        const reading = await svc_permission.scan(
            actor, permission_to_check,
        );
        const options = PermissionUtil.reading_to_options(reading);
        
        if ( options.length > 0 ) return;
        
        // `true` here means "do not send downstream"
        return true;
    }
};

module.exports = {
    ProtectedAppES,
};
