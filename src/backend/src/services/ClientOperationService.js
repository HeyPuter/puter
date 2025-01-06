// METADATA // {"ai-commented":{"service":"openai-completion","model":"gpt-4o"}}
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
const { Context } = require("../util/context");

// Key for tracing operations in the context, used for logging and tracking.
const CONTEXT_KEY = Context.make_context_key('operation-trace');
/**
* Class representing a tracker for individual client operations.
* The ClientOperationTracker class is designed to handle the metadata
* and attributes associated with each operation, allowing for better 
* management and organization of client data during processing.
*/
class ClientOperationTracker {
    constructor (parameters) {
        this.name = parameters.name || 'untitled';
        this.tags = parameters.tags || [];
        this.frame = parameters.frame || null;
        this.metadata = parameters.metadata || {};
        this.objects = parameters.objects || [];
    }
}


/**
* Class representing the ClientOperationService, which manages the 
* operations related to client interactions. It provides methods to 
* add new operations and handle their associated client operation 
* trackers, ensuring efficient management and tracking of client-side 
* operations during their lifecycle.
*/
class ClientOperationService {
    constructor ({ services }) {
        this.operations_ = [];
    }


    /**
    * Adds a new operation to the service by creating a ClientOperationTracker instance.
    * 
    * @param {Object} parameters - The parameters for the new operation.
    * @returns {Promise<ClientOperationTracker>} A promise that resolves to the created ClientOperationTracker instance.
    */
    async add_operation (parameters) {
        const tracker = new ClientOperationTracker(parameters);

        return tracker;
    }

    ckey (key) {
        return CONTEXT_KEY + ':' + key;
    }
}

module.exports = {
    ClientOperationService,
};
