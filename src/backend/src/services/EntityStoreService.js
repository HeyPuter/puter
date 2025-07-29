// METADATA // {"ai-commented":{"service":"xai"}}
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
const APIError = require("../api/APIError");
const { Entity } = require("../om/entitystorage/Entity");
const { IdentifierUtil } = require("../om/IdentifierUtil");
const { Null, And, Eq } = require("../om/query/query");
const { Context } = require("../util/context");
const BaseService = require("./BaseService");

/**
* EntityStoreService - A service class that manages entity-related operations in the backend of Puter.
* This class extends BaseService to provide methods for creating, reading, updating, selecting, 
* upserting, and deleting entities. It interacts with an upstream data provider to perform these 
* operations, ensuring consistency and providing context-aware functionality for entity management.
*/
class EntityStoreService extends BaseService {
    /**
    * Initializes the EntityStoreService with necessary entity and upstream configurations.
    * 
    * @param {Object} args - The initialization arguments.
    * @param {string} args.entity - The name of the entity to operate on. Required.
    * @param {Object} args.upstream - The upstream service to handle operations.
    * 
    * @throws {Error} If `args.entity` is not provided.
    *
    * @returns {Promise<void>} A promise that resolves when initialization is complete.
    * 
    * @note This method sets up the context for the entity operations and provides it to the upstream service.
    */
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
    
    static IMPLEMENTS = {
        ['crud-q']: {
            async create ({ object, options }) {
                if ( object.hasOwnProperty(this.om.primary_identifier) ) {
                    throw APIError.create('field_not_allowed_for_create', null, {
                        key: this.om.primary_identifier
                    });
                }
                const entity = await Entity.create({ om: this.om }, object);
                return await this.create(entity, options);
            },
            async update ({ object, id, options }) {
                const entity = await Entity.create({ om: this.om }, object);
                return await this.update(entity, id, options);
            },
            async upsert ({ object, id, options }) {
                const entity = await Entity.create({ om: this.om }, object);
                return await this.upsert(entity, id, options);
            },
            async read ({ uid, id, params = {} }) {
                return await Context.sub({
                    es_params: params,
                }).arun(async () => {
                    if ( ! uid && ! id ) {
                        throw APIError.create('xor_field_missing', null, {
                            names: ['uid', 'id'],
                        });
                    }

                    const entity = await this.fetch_based_on_either_id_(uid, id);
                    if ( ! entity ) {
                        throw APIError.create('entity_not_found', null, {
                            identifier: uid
                        });
                    }
                    return await entity.get_client_safe();
                });
            },
            async select (options) {
                return await Context.sub({
                    es_params: options?.params ?? {},
                }).arun(async () => {
                    const entities = await this.select(options);
                    const client_safe_entities = [];
                    for ( const entity of entities ) {
                        client_safe_entities.push(await entity.get_client_safe());
                    }
                    return client_safe_entities;
                });
            },
            async delete ({ uid, id }) {
                if ( ! uid && ! id ) {
                    throw APIError.create('xor_field_missing', null, {
                        names: ['uid', 'id'],
                    });
                }

                if ( id && ! uid ) {
                    const entity = await this.fetch_based_on_complex_id_(id);
                    if ( ! entity ) {
                        throw APIError.create('entity_not_found', null, {
                            identifier: id
                        });
                    }
                    uid = await entity.get(this.om.primary_identifier);
                }

                return await this.delete(uid);
            }
        }
    };

    // TODO: can replace these with MethodProxyFeature
    /**
    * Create a new entity in the store.
    * 
    * @param {Object} entity - The entity to add.
    * @param {Object} options - Additional options for the update operation.
    * @returns {Promise<Object>} The updated entity after the operation.
    */
    async create (entity, options) {
        return await this.upstream.upsert(entity, { old_entity: null, options });
    }
    /**
    * Reads an entity from the upstream data store using its unique identifier.
    * 
    * @param {string} uid - The unique identifier of the entity to read.
    * @returns {Promise<Object>} A promise that resolves to the entity object if found.
    * @throws {APIError} If the entity with the given `uid` does not exist.
    */
    async read (uid) {
        return await this.upstream.read(uid);
    }
    /**
    * Retrieves an entity by its unique identifier (UID).
    * 
    * @param {string} uid - The unique identifier of the entity to retrieve.
    * @returns {Promise<Object>} The entity associated with the given UID.
    * @throws {Error} If the entity cannot be found or an error occurs during retrieval.
    */
    async select ({ predicate, ...rest }) {
        if ( ! predicate ) predicate = [];
        if ( Array.isArray(predicate) ) {
            const [p_op, ...p_args] = predicate;
            predicate = await this.upstream.create_predicate(p_op, ...p_args);
        }
        if ( ! predicate) predicate = new Null();
        return await this.upstream.select({ predicate, ...rest });
    }
    /* Updates an existing entity in the store.
    * 
    * @param {Object} entity - The entity to update with new values.
    * @param {string|number} id - The identifier of the entity to update. Can be a string or number.
    * @param {Object} options - Additional options for the update operation.
    * @returns {Promise<Object>} The updated entity after the operation.
    * @throws {APIError} If the entity to be updated is not found.
    * 
    * @note This method first attempts to fetch the entity by its primary identifier. If not found, 
    *       it uses `IdentifierUtil` to detect and fetch by other identifiers if provided. 
    *       If the entity still isn't found, an error is thrown. The method ensures that the 
    *       entity's primary identifier is updated to match the existing entity before performing 
    *       the actual update through `this.upstream.update`.
    */
    async update (entity, id, options) {
        let old_entity = await this.read(
            await entity.get(this.om.primary_identifier));

        if ( ! old_entity ) {
            const idu = new IdentifierUtil({
                om: this.om,
            });

            const predicate = await idu.detect_identifier(id ?? {}, true);
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

        return await this.upstream.upsert(entity, { old_entity, options });
    }
    /**
    * Updates an existing entity in the store or creates a new one.
    * 
    * @param {Object} entity - The entity to update with new values.
    * @param {string|number} id - The identifier of the entity to update. Can be a string or number.
    * @param {Object} options - Additional options for the update operation.
    * @returns {Promise<Object>} The updated entity after the operation.
    * @throws {APIError} If the entity to be updated is not found.
    * 
    * @note This method first attempts to fetch the entity by its primary identifier. If not found, 
    *       it uses `IdentifierUtil` to detect and fetch by other identifiers if provided. 
    *       If the entity still isn't found, an error is thrown. The method ensures that the 
    *       entity's primary identifier is updated to match the existing entity before performing 
    *       the actual update through `this.upstream.upsert`.
    */
    async upsert (entity, id, options) {
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

        return await this.upstream.upsert(entity, { old_entity, options });
    }
    /**
    * Deletes an entity from the store.
    * 
    * @param {string} uid - The unique identifier of the entity to delete.
    * @returns {Promise} A promise that resolves when the entity is deleted.
    * @throws {APIError} If the entity with the given `uid` is not found.
    * 
    * This method first attempts to read the entity with the given `uid`. If the entity 
    * does not exist, it throws an `APIError` with the message 'entity_not_found'. 
    * If the entity exists, it calls the upstream service to delete the entity, 
    * passing along the old entity data for reference.
    */
    async delete (uid) {
        const old_entity = await this.read(uid);
        if ( ! old_entity ) {
            throw APIError.create('entity_not_found', null, {
                identifier: uid,
            });
        }
        return await this.upstream.delete(uid, { old_entity });
    }
    
    async fetch_based_on_complex_id_ (id) {
        // Ensure `id` is an object and get its keys
        if ( ! id || typeof id !== 'object' || Array.isArray(id) ) {
            throw APIError.create('invalid_id', null, { id });
        }

        const id_keys = Object.keys(id);
        // sort keys alphabetically
        id_keys.sort();

        // Ensure key set is valid based on redundant keys listing
        const redundant_identifiers = this.om.redundant_identifiers ?? [];

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
        const entity = await this.read({ predicate });
        if ( ! entity ) {
            return null;
        }

        // Ensure there is only one result
        return entity;
    }

    async fetch_based_on_either_id_ (uid, id) {
        if ( uid ) {
            return await this.read(uid);
        }

        return await this.fetch_based_on_complex_id_(id);
    }
}

module.exports = {
    EntityStoreService,
};
