/*
 * Copyright (C) 2025-present Puter Technologies Inc.
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

const BaseService = require('../../services/BaseService');

/**
* Service class that manages KVStore interface registrations.
* Handles registration of the puter-kvstore interface.
* @extends BaseService
*/
class KVStoreInterfaceService extends BaseService {
    /**
    * Service class for managing KVStore interface registrations.
    * Extends the base service to provide key-value store interface management.
    */
    async ['__on_driver.register.interfaces']() {
        const svc_registry = this.services.get('registry');
        const col_interfaces = svc_registry.get('interfaces');

        // Register the puter-kvstore interface
        col_interfaces.set('puter-kvstore', {
            description: 'A simple key-value store.',
            methods: {
                get: {
                    description: 'Get a value by key.',
                    parameters: {
                        key: { type: 'json', required: true },
                    },
                    result: { type: 'json' },
                },
                set: {
                    description: 'Set a value by key.',
                    parameters: {
                        key: { type: 'string', required: true },
                        value: { type: 'json' },
                        expireAt: { type: 'number' },
                    },
                    result: { type: 'void' },
                },
                del: {
                    description: 'Delete a value by key.',
                    parameters: {
                        key: { type: 'string' },
                    },
                    result: { type: 'void' },
                },
                list: {
                    description: 'List all key-value pairs.',
                    parameters: {
                        as: {
                            type: 'string',
                        },
                    },
                    result: { type: 'array' },
                },
                flush: {
                    description: 'Delete all key-value pairs.',
                    parameters: {},
                    result: { type: 'void' },
                },
                incr: {
                    description: 'Increment a value by key.',
                    parameters: {
                        key: { type: 'string', required: true },
                        amount: { type: 'number' },

                    },
                    result: { type: 'number' },
                },
                decr: {
                    description: 'Decrement a value by key.',
                    parameters: {
                        key: { type: 'string', required: true },
                        amount: { type: 'number' },

                    },
                    result: { type: 'number' },
                },
                expireAt: {
                    description: 'Set a key to expire at a given timestamp in sec.',
                    parameters: {
                        key: { type: 'string', required: true },
                        timestamp: { type: 'number', required: true },

                    },
                    result: { type: 'number' },
                },
                expire: {
                    description: 'Set a key to expire in ttl many seconds.',
                    parameters: {
                        key: { type: 'string', required: true },
                        ttl: { type: 'number', required: true },

                    },
                    result: { type: 'number' },
                },
            },
        });
    }
}

module.exports = {
    KVStoreInterfaceService,
};