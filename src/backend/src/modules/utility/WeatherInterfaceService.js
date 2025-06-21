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

const BaseService = require("../../services/BaseService");

class WeatherInterfaceService extends BaseService {

    async ['__on_driver.register.interfaces'] () {
        const svc_registry = this.services.get('registry');
        const col_interfaces = svc_registry.get('interfaces');
        
        // Register the puter-weather interface
        col_interfaces.set('puter-weather', {
            description: 'Weather interface',
            methods: {
                get: {
                    description: 'Get weather from location',
                    parameters: {
                        location: {
                            type: 'string',
                        },
                    },
                    result: {
                        type: 'string'
                    },
                },
            }
        })
    }
}

module.exports = {
    WeatherInterfaceService
};
