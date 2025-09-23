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
 * @typedef {Object} KVStoreInterface
 * @property {(opts: KVStoreGetParams) => Promise<Record<string, unknonw>>} get - Retrieve the value(s) for the given key(s).
 * @property {(opts: KVStoreSetParams) => Promise<void>} set - Set a value for a key, with optional expiration.
 * @property {(opts: KVStoreDelParams) => Promise<void>} del - Delete a value by key.
 * @property {(opts: KVStoreListParams) => Promise<string[]>} list - List all key-value pairs, optionally as a specific type.
 * @property {() => Promise<void>} flush - Delete all key-value pairs in the store.
 * @property {(opts: KVStoreIncrDecrParams) => Promise<number>} incr - Increment a numeric value by key.
 * @property {(opts: KVStoreIncrDecrParams) => Promise<number>} decr - Decrement a numeric value by key.
 * @property {(opts: KVStoreExpireAtParams) => Promise<number>} expireAt - Set a key to expire at a specific UNIX timestamp (seconds).
 * @property {(opts: KVStoreExpireParams) => Promise<number>} expire - Set a key to expire after a given TTL (seconds).
 *
 * @typedef {Object} KVStoreGetParams
 * @property {string|string[]} key - The key or array of keys to retrieve.
 *
 * @typedef {Object} KVStoreSetParams
 * @property {string} key - The key to set.
 * @property {*} value - The value to store.
 * @property {number} [expireAt] - Optional UNIX timestamp (seconds) when the key should expire.
 *
 * @typedef {Object} KVStoreDelParams
 * @property {string} key - The key to delete.
 *
 * @typedef {Object} KVStoreListParams
 * @property {string} [as] - Optional type to list as (e.g., 'array', 'object').
 *
 * @typedef {Object} KVStoreIncrDecrParams
 * @property {string} key - The key to increment or decrement.
 * @property {number} [amount] - Optional amount to increment or decrement by.
 *
 * @typedef {Object} KVStoreExpireAtParams
 * @property {string} key - The key to set expiration for.
 * @property {number} timestamp - UNIX timestamp (seconds) when the key should expire.
 *
 * @typedef {Object} KVStoreExpireParams
 * @property {string} key - The key to set expiration for.
 * @property {number} ttl - Time-to-live in seconds.
 */

/**
 * Service for registering the puter-kvstore interface, exposing a simple key-value store API
 * with support for get, set, delete, list, flush, increment, decrement, and key expiration.
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