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
const { BaseES } = require('./BaseES');

const APIError = require('../../api/APIError');
const { Context } = require('../../util/context');
const { SKIP_ES_VALIDATION } = require('./consts');

class ValidationES extends BaseES {
    async _on_context_provided () {
        // const services = this.context.get('services');
        // const svc_mysql = services.get('mysql');
        // this.dbrw = svc_mysql.get(DB_MODE_WRITE, `es:${this.entity_name}:rw`);
        // this.dbrr = svc_mysql.get(DB_MODE_WRITE, `es:${this.entity_name}:rr`);
    }
    static METHODS = {
        // async create (entity) {
        //     await this.validate_(entity);
        //     return await this.om.get_client_safe((await this.upstream.create(entity)).data);
        // },
        // async update (entity) {
        //     await this.validate_(entity);
        //     return await this.om.get_client_safe((await this.upstream.update(entity)).data);
        // },
        async upsert (entity, extra) {
            for ( const prop of Object.values(this.om.properties) ) {
                if (
                    prop.descriptor.protected ||
                    prop.descriptor.read_only
                ) {
                    await entity.del(prop.name);
                }
            }

            const valid_entity = extra.old_entity
                ? await (await extra.old_entity.clone()).apply(entity)
                : entity
                ;
            await this.validate_(valid_entity,
                            extra.old_entity ? entity : undefined);
            const { entity: out_entity } = await this.upstream.upsert(entity, extra);
            return await out_entity.get_client_safe();
        },
        async validate_ (entity, diff) {
            if ( Context.get(SKIP_ES_VALIDATION) ) return;

            for ( const prop of Object.values(this.om.properties) ) {
                let value = await entity.get(prop.name);

                if ( prop.descriptor.required ) {
                    if ( ! await entity.is_set(prop.name) ) {
                        throw APIError.create('field_missing', null, { key: prop.name });
                    }
                }

                if ( ! await entity.is_set(prop.name) ) continue;

                if ( prop.descriptor.immutable && diff && await diff.has(prop.name) ) {
                    throw APIError.create('field_immutable', null, { key: prop.name });
                }

                try {
                    const validation_result = await prop.validate(value);
                    if ( validation_result !== true ) {
                        throw validation_result || APIError.create('field_invalid', null, { key: prop.name });
                    }
                } catch ( e ) {
                    if ( ! (e instanceof APIError) ) {
                        console.log('THIS IS HAPPENING', e);
                        // eslint-disable-next-line no-ex-assign
                        e = APIError.create('field_invalid', null, {
                            key: prop.name,
                            converted_from_another_error: true,
                        });
                    }
                    throw e;
                }
            }

        },
    };
}

module.exports = ValidationES;
