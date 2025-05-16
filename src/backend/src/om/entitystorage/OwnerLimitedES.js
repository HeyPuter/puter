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
const { UserActorType } = require("../../services/auth/Actor");
const { Context } = require("../../util/context");
const { Eq } = require("../query/query");
const { BaseES } = require("./BaseES");

class OwnerLimitedES extends BaseES {
    // Limit selection to entities owned by the app of the current actor.
    async select (options) {
        const actor = Context.get('actor');

        if ( ! (actor.type instanceof UserActorType) ) {
            return [];
        }

        let condition = new Eq({
            key: 'owner',
            value: actor.type.user.id,
        });

        options.predicate = options.predicate?.and
            ? options.predicate.and(condition)
            : condition;

        return await this.upstream.select(options);
    }

    // Limit read to entities owned by the app of the current actor.
    async read (uid) {
        const actor = Context.get('actor');
        if ( ! (actor.type instanceof UserActorType) ) {
            return null;
        }

        const entity = await this.upstream.read(uid);
        if ( ! entity ) return null;
        
        const entity_owner = await entity.get('owner');
        let owner_id = entity_owner?.id;
        if ( entity_owner.id !== actor.type.user.id ) {
            return null;
        }

        return entity;
    }
}

module.exports = {
    OwnerLimitedES,
};

