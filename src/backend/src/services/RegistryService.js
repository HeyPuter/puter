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
const { AdvancedBase } = require("@heyputer/putility");
const BaseService = require("./BaseService");

class MapCollection extends AdvancedBase {
    static MODULES = {
        kv: globalThis.kv,
        uuidv4: require('uuid').v4,
    }
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
    
    keys () {
        const keys = this.kv.keys(`registry:map:${this.map_id}:*`);
        return keys.map(k => k.slice(`registry:map:${this.map_id}:`.length));
    }

    _mk_key (key) {
        return `registry:map:${this.map_id}:${key}`;
    }
}

class RegistryService extends BaseService {
    static MODULES = {
        MapCollection,
    }

    _construct () {
        this.collections_ = {};
    }

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
