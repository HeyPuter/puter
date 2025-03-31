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

// METADATA // {"ai-commented":{"service":"claude"}}
const BaseService = require("../../services/BaseService");

/**
* Service class that manages Entity Store interface registrations.
* Handles registration of the crud-q interface which is used by various
* entity storage services.
* @extends BaseService
*/
class EntityStoreInterfaceService extends BaseService {
    /**
    * Service class for managing Entity Store interface registrations.
    * Extends the base service to provide entity storage interface management.
    */
    async ['__on_driver.register.interfaces'] () {
        const svc_registry = this.services.get('registry');
        const col_interfaces = svc_registry.get('interfaces');
        
        // Define the standard CRUD interface methods that will be reused
        const crudMethods = {
            create: {
                parameters: {
                    object: {
                        type: 'json',
                        subtype: 'object',
                        required: true,
                    },
                    options: { type: 'json' },
                }
            },
            read: {
                parameters: {
                    uid: { type: 'string' },
                    id: { type: 'json' },
                    params: { type: 'json' },
                }
            },
            select: {
                parameters: {
                    predicate: { type: 'json' },
                    offset: { type: 'number' },
                    limit: { type: 'number' },
                    params: { type: 'json' },
                }
            },
            update: {
                parameters: {
                    id: { type: 'json' },
                    object: {
                        type: 'json',
                        subtype: 'object',
                        required: true,
                    },
                    options: { type: 'json' },
                }
            },
            upsert: {
                parameters: {
                    id: { type: 'json' },
                    object: {
                        type: 'json',
                        subtype: 'object',
                        required: true,
                    },
                    options: { type: 'json' },
                }
            },
            delete: {
                parameters: {
                    uid: { type: 'string' },
                    id: { type: 'json' },
                }
            },
        };
        
        // Register the crud-q interface
        col_interfaces.set('crud-q', {
            methods: { ...crudMethods }
        });

        // Register entity-specific interfaces that use crud-q
        const entityInterfaces = [
            {
                name: 'puter-apps',
                description: 'Manage a developer\'s apps on Puter.'
            },
            {
                name: 'puter-subdomains',
                description: 'Manage subdomains on Puter.'
            },
            {
                name: 'puter-notifications',
                description: 'Read notifications on Puter.'
            }
        ];

        // Register each entity interface with the same CRUD methods
        for (const entity of entityInterfaces) {
            col_interfaces.set(entity.name, {
                description: entity.description,
                methods: { ...crudMethods }
            });
        }
    }
}

module.exports = {
    EntityStoreInterfaceService
};