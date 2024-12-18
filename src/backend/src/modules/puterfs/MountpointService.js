// METADATA // {"ai-commented":{"service":"claude"}}
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
// const Mountpoint = o => ({ ...o });

const BaseService = require("../../services/BaseService");

/**
 * This will eventually be a service which manages the storage
 * backends for mountpoints.
 * 
 * For the moment, this is a way to access the storage backend
 * in situations where ContextInitService isn't able to
 * initialize a context.
 */
/**
* @class MountpointService
* @extends BaseService
* @description Service class responsible for managing storage backends for mountpoints.
* Currently provides a temporary solution for accessing storage backend when context
* initialization is not possible. Will be expanded to handle multiple mountpoints
* and their associated storage backends in future implementations.
*/
class MountpointService extends BaseService {
    /**
    * Initializes the MountpointService instance
    * Sets up initial state with null storage backend
    * @private
    * @async
    * @returns {Promise<void>}
    */
    async _init () {
        // this.mountpoints_ = {};
        
        // Temporary solution - we'll develop this incrementally
        this.storage_ = null;
    }
    
    // Temporary solution - we'll develop this incrementally
    set_storage (storage) {
        this.storage_ = storage;
    }
    /**
    * Gets the current storage backend instance
    * @returns {Object} The storage backend instance
    */
    get_storage () {
        return this.storage_;
    }
}

module.exports = {
    MountpointService,
};
