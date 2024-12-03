// METADATA // {"ai-commented":{"service":"xai"}}
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
    */
    async _init (args) {
        if ( ! args.entity ) {
            throw new Error('EntityStoreService requires an entity name');
        }

        this.upstream = args.upstream;


        /**
        * Initializes the EntityStoreService with the provided arguments.
        * 
        * @param {Object} args - Initialization arguments.
        * @param {string} args.entity - The name of the entity this service will manage. 
        *                              If not provided, an error is thrown.
        * @param {Object} args.upstream - The upstream service or data source.
        * 
        * @throws {Error} If the entity name is not provided in the arguments.
        * 
        * @returns {Promise<void>} A promise that resolves when initialization is complete.
        * 
        * @note This method sets up the context for the entity operations and provides it to the upstream service.
        */
        const context = Context.get().sub({ services: this.services });
        const om = this.services.get('registry').get('om:mapping').get(args.entity);
        this.om = om;
        await this.upstream.provide_context({
            context,
            om,
            entity_name: args.entity,
        });
    }

    // TODO: can replace these with MethodProxyFeature
    /**
    * Retrieves an entity by its unique identifier.
    * 
    * @param {string} uid - The unique identifier of the entity to read.
    * @returns {Promise<Object>} The entity object if found, otherwise null or throws an error.
    * @throws {APIError} If the entity with the given uid does not exist.
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
    /**
    * Retrieves entities matching a given predicate.
    * 
    * This method performs a selection query on the upstream data source.
    * If no predicate is provided, it defaults to selecting all entities.
    * 
    * @param {Object} options - The selection options.
    * @param {Array|Function} options.predicate - The predicate for filtering entities. 
    *      If an array, it's expected to be in the format [operator, ...args].
    *      If not provided, it defaults to a Null predicate, effectively selecting all entities.
    * @param {Object} [options.rest] - Additional options for the selection query.
    * @returns {Promise<Array>} A promise that resolves to an array of entities matching the predicate.
    */
    async update (entity, id, options) {
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

        return await this.upstream.upsert(entity, { old_entity, options });
    }
    /**
    * Updates an existing entity in the store.
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
}

module.exports = {
    EntityStoreService,
};
