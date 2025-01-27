// METADATA // {"ai-commented":{"service":"mistral","model":"mistral-large-latest"}}
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
const { AdvancedBase } = require("@heyputer/putility");
const BaseService = require("./BaseService");


/**
* @class MapCollection
* @extends AdvancedBase
*
* The `MapCollection` class extends the `AdvancedBase` class and is responsible for managing a collection of key-value pairs.
* It leverages the `kvjs` library for key-value storage and the `uuid` library for generating unique identifiers for each key-value pair.
* This class provides methods for basic CRUD operations (create, read, update, delete) on the key-value pairs, as well as methods for checking the existence of a key and retrieving all keys in the collection.
*/
class MapCollection extends AdvancedBase {
    static MODULES = {
        kv: globalThis.kv,
        uuidv4: require('uuid').v4,
    }
    /**
    * @method MapCollection#_mk_key
    * @description Creates a unique key for the map collection.
    * @param {string} key - The key to be prefixed.
    * @returns {string} The prefixed key.
    */
    constructor () {
        super();
        // We use kvjs instead of a plain object because it doesn't
        // have a limit on the number of keys it can store.
        this.map_id = this.modules.uuidv4();
        this.kv = kv;
    }

    get (key) {
        return this.kv.get(this._mk_key(key));
    }
    
    exists (key) {
        return this.kv.exists(this._mk_key(key));
    }

    set (key, value) {
        return this.kv.set(this._mk_key(key), value);
    }

    del (key) {
        return this.kv.del(this._mk_key(key));
    }
    

    /**
    * Retrieves all keys in the map collection, excluding the prefix.
    *
    * This method fetches all keys that match the pattern for the current map collection.
    * The prefix `registry:map:${this.map_id}:` is stripped from each key before returning.
    *
    * @returns {string[]} An array of keys without the prefix.
    */
    keys () {
        const keys = this.kv.keys(`registry:map:${this.map_id}:*`);
        return keys.map(k => k.slice(`registry:map:${this.map_id}:`.length));
    }

    _mk_key (key) {
        return `registry:map:${this.map_id}:${key}`;
    }
}


/**
* @class RegistryService
* @extends BaseService
* @description The RegistryService class manages collections of key-value pairs, allowing for dynamic registration and retrieval of collections.
* It extends the BaseService class and provides methods to register new collections, retrieve existing collections, and handle consolidation tasks upon boot.
*/
class RegistryService extends BaseService {
    static MODULES = {
        MapCollection,
    }


    /**
    * Initializes the RegistryService by setting up the collections.
    *
    * This method is called during the construction phase of the service.
    * It initializes an empty object to hold collections.
    *
    * @private
    * @returns {void}
    */
    _construct () {
        this.collections_ = {};
    }


    /**
    * Initializes the service by setting up the collections object.
    * This method is called during the construction phase of the service.
    *
    * @private
    */
    async ['__on_boot.consolidation'] () {
        const services = this.services;
        await services.emit('registry.collections');
        await services.emit('registry.entries');
    }

    register_collection (name) {
        if ( this.collections_[name] ) {
            throw Error(`collection ${name} already exists`);
        }
        this.collections_[name] = new this.modules.MapCollection();
        return this.collections_[name];
    }

    get (name) {
        if ( ! this.collections_[name] ) {
            throw Error(`collection ${name} does not exist`);
        }
        return this.collections_[name];
    }
}

module.exports = {
    RegistryService,
};
