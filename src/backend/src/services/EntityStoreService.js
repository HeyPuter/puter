/*
 * Copyright (C) 2024 Puter Technologies Inc.
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
const APIError = require("../api/APIError");
const { IdentifierUtil } = require("../om/IdentifierUtil");
const { Null } = require("../om/query/query");
const { Context } = require("../util/context");
const BaseService = require("./BaseService");

class EntityStoreService extends BaseService {
    async _init (args) {
        if ( ! args.entity ) {
            throw new Error('EntityStoreService requires an entity name');
        }

        this.upstream = args.upstream;

        const context = Context.get().sub({ services: this.services });
        const om = this.services.get('registry').get('om:mapping').get(args.entity);
        this.om = om;
        await this.upstream.provide_context({
            context,
            om,
            entity_name: args.entity,
        });
    }

    // TODO: can replace these with MethodProxyTrait
    async create (entity) {
        return await this.upstream.upsert(entity, { old_entity: null });
    }
    async read (uid) {
        return await this.upstream.read(uid);
    }
    async select ({ predicate, ...rest }) {
        if ( ! predicate ) predicate = [];
        if ( Array.isArray(predicate) ) {
            const [p_op, ...p_args] = predicate;
            predicate = await this.upstream.create_predicate(p_op, ...p_args);
        }
        if ( ! predicate) predicate = new Null();
        return await this.upstream.select({ predicate, ...rest });
    }
    async update (entity, id) {
        let old_entity = await this.read(
            await entity.get(this.om.primary_identifier));

        if ( ! old_entity ) {
            const idu = new IdentifierUtil({
                om: this.om,
            });

            const predicate = await idu.detect_identifier(id ?? {});
            if ( predicate ) {
                const maybe_entity = await this.select({ predicate, limit: 1 });
                if ( maybe_entity.length ) {
                    old_entity = maybe_entity[0];
                }
            }
        }

        if ( ! old_entity ) {
            throw APIError.create('entity_not_found', null, {
                identifier: await entity.get(this.om.primary_identifier),
            });
        }

        // Set primary identifier's value of `entity` to that in `old_entity`
        const id_prop = this.om.properties[this.om.primary_identifier];
        await entity.set(id_prop.name, await old_entity.get(id_prop.name));

        return await this.upstream.upsert(entity, { old_entity });
    }
    async upsert (entity, id) {
        let old_entity = await this.read(
            await entity.get(this.om.primary_identifier));

        if ( ! old_entity ) {
            const idu = new IdentifierUtil({
                om: this.om,
            });

            const predicate = await idu.detect_identifier(entity);
            if ( predicate ) {
                const maybe_entity = await this.select({ predicate, limit: 1 });
                if ( maybe_entity.length ) {
                    old_entity = maybe_entity[0];
                }
            }
        }

        if ( old_entity ) {
            // Set primary identifier's value of `entity` to that in `old_entity`
            const id_prop = this.om.properties[this.om.primary_identifier];
            await entity.set(id_prop.name, await old_entity.get(id_prop.name));
        }

        return await this.upstream.upsert(entity, { old_entity });
    }
    async delete (uid) {
        const old_entity = await this.read(uid);
        if ( ! old_entity ) {
            throw APIError.create('entity_not_found', null, {
                identifier: uid,
            });
        }
        return await this.upstream.delete(uid, { old_entity });
    }
}

module.exports = {
    EntityStoreService,
};
