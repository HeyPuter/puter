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
const { get_user } = require('../../helpers');
const { AppUnderUserActorType, UserActorType } = require('../../services/auth/Actor');
const { Context } = require('../../util/context');
const { nou } = require('../../util/langutil');
const { BaseES } = require('./BaseES');

class SetOwnerES extends BaseES {
    static METHODS = {
        async upsert (entity, extra) {
            const { old_entity } = extra;
            if ( ! old_entity ) {
                await entity.set('owner', Context.get('user'));

                if ( entity.om_has_property('app_owner') ) {
                    const actor = Context.get('actor');
                    if ( actor.type instanceof AppUnderUserActorType ) {
                        const app = actor.type.app;

                        // We need to escalate privileges to set the app owner
                        // because the app may not have permission to read
                        // its own entry from es:app.
                        const upgraded_actor = actor.get_related_actor(UserActorType);
                        await Context.get().sub({
                            actor: upgraded_actor,
                        }).arun(async () => {
                            await entity.set('app_owner', app.uid);
                        });
                    }
                }
            }
            return await this.upstream.upsert(entity, extra);
        },
        async read (uid) {
            const entity = await this.upstream.read(uid);
            if ( ! entity ) return null;

            await this._sanitize_owner(entity);

            return entity;
        },
        async select (...args) {
            const entities = await this.upstream.select(...args);
            for ( const entity of entities ) {
                await this._sanitize_owner(entity);
            }
            return entities;
        },
        async _sanitize_owner (entity) {
            let owner = await entity.get('owner');
            if ( nou(owner) ) return null;
            owner = get_user({ id: owner });
            await entity.set('owner', owner);
        },
    };
}

module.exports = {
    SetOwnerES,
};
