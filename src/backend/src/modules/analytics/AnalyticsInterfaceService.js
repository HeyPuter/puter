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

const BaseService = require("../../services/BaseService");

/**
* Service class that manages Analytics interface registrations.
* Handles registration of the puter-analytics interface.
* @extends BaseService
*/
class AnalyticsInterfaceService extends BaseService {
    /**
    * Service class for managing Analytics interface registrations.
    * Extends the base service to provide analytics interface management.
    */
    async ['__on_driver.register.interfaces'] () {
        const svc_registry = this.services.get('registry');
        const col_interfaces = svc_registry.get('interfaces');
        
        // Register the puter-analytics interface
        col_interfaces.set('puter-analytics', {
            no_sdk: true,
            description: 'Analytics.',
            methods: {
                create_trace: {
                    description: 'Get a trace UID.',
                    parameters: {
                        trace_id: { type: 'string', optional: true },
                    },
                    result: { type: 'string' }
                },
                record: {
                    description: 'Record an event.',
                    parameters: {
                        trace_id: { type: 'string', optional: true },
                        tags: { type: 'json' },
                        fields: { type: 'json' },
                    },
                    result: { type: 'void' }
                }
            }
        });
    }
}

module.exports = {
    AnalyticsInterfaceService
};