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
const { Driver } = require("../definitions/Driver");
const { Entity } = require("../om/entitystorage/Entity");
const { Or, And, Eq } = require("../om/query/query");

const _fetch_based_on_complex_id = async (self, id) => {
    // Ensure `id` is an object and get its keys
    if ( ! id || typeof id !== 'object' || Array.isArray(id) ) {
        throw APIError.create('invalid_id', null, { id });
    }

    const id_keys = Object.keys(id);
    // sort keys alphabetically
    id_keys.sort();

    // Ensure key set is valid based on redundant keys listing
    const svc_es = self.services.get(self.service);
    const redundant_identifiers = svc_es.om.redundant_identifiers ?? [];

    let match_found = false;
    for ( let key of redundant_identifiers ) {
        // Either a single key or a list
        key = Array.isArray(key) ? key : [key];

        // All keys in the list must be present in the id
        for ( let i=0 ; i < key.length ; i++ ) {
            if ( ! id_keys.includes(key[i]) ) {
                break;
            }
            if ( i === key.length - 1 ) {
                match_found = true;
                break;
            }
        }
    }

    if ( ! match_found ) {
        throw APIError.create('invalid_id', null, { id });
    }

    // Construct a query predicate based on the keys
    const key_eqs = [];
    for ( const key of id_keys ) {
        key_eqs.push(new Eq({
            key,
            value: id[key],
        }));
    }
    let predicate = new And({ children: key_eqs });

    // Perform a select
    const entities = await svc_es.select({ predicate });
    if ( entities.length === 0 ) {
        return null;
    }

    console.log('WHAT ISAGERSGAREWHGwr', entities)

    // Ensure there is only one result
    return entities[0];
}

const _fetch_based_on_either_id = async (self, uid, id) => {
    if ( uid ) {
        const svc_es = self.services.get(self.service);
        return await svc_es.read(uid);
    }

    return await _fetch_based_on_complex_id(self, id);
}

class EntityStoreImplementation extends Driver {
    constructor ({ service }) {
        super();
        this.service = service;
    }
    static METHODS = {
        create: async function ({ object }) {
            const svc_es = this.services.get(this.service);
            if ( object.hasOwnProperty(svc_es.om.primary_identifier) ) {
                throw APIError.create('field_not_allowed_for_create', null, { key: svc_es.om.primary_identifier });
            }
            const entity = await Entity.create({ om: svc_es.om }, object);
            return await svc_es.create(entity);
        },
        update: async function ({ object, id }) {
            const svc_es = this.services.get(this.service);
            // if ( ! object.hasOwnProperty(svc_es.om.primary_identifier) ) {
            //     throw APIError.create('field_required_for_update', null, { key: svc_es.om.primary_identifier });
            // }
            const entity = await Entity.create({ om: svc_es.om }, object);
            return await svc_es.update(entity, id);
        },
        upsert: async function ({ object, id }) {
            const svc_es = this.services.get(this.service);
            const entity = await Entity.create({ om: svc_es.om }, object);
            return await svc_es.upsert(entity, id);
        },
        read: async function ({ uid, id }) {
            if ( ! uid && ! id ) {
                throw APIError.create('xor_field_missing', null, {
                    names: ['uid', 'id'],
                });
            }

            const entity = await _fetch_based_on_either_id(this, uid, id);
            if ( ! entity ) {
                throw APIError.create('entity_not_found', null, {
                    identifier: uid
                });
            }
            return await entity.get_client_safe();
        },
        select: async function (options) {
            const svc_es = this.services.get(this.service);
            const entities = await svc_es.select(options);
            const client_safe_entities = [];
            for ( const entity of entities ) {
                client_safe_entities.push(await entity.get_client_safe());
            }
            return client_safe_entities;
        },
        delete: async function ({ uid, id }) {
            if ( ! uid && ! id ) {
                throw APIError.create('xor_field_missing', null, {
                    names: ['uid', 'id'],
                });
            }

            if ( id && ! uid ) {
                const entity = await _fetch_based_on_complex_id(this, id);
                if ( ! entity ) {
                    throw APIError.create('entity_not_found', null, {
                        identifier: id
                    });
                }
                const svc_es = this.services.get(this.service);
                uid = await entity.get(svc_es.om.primary_identifier);
            }

            const svc_es = this.services.get(this.service);
            return await svc_es.delete(uid);
        },
    };
}

module.exports = {
    EntityStoreImplementation,
};
