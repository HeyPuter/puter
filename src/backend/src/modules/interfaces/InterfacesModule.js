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

// METADATA // {"ai-commented":{"service":"claude"}}
const { AdvancedBase } = require("@heyputer/putility");
const { EntityStoreInterfaceService } = require("../entitystore/EntityStoreInterfaceService");
const { AnalyticsInterfaceService } = require("../analytics/AnalyticsInterfaceService");

/**
 * A module for registering driver interfaces.
 * This module includes services for registering entity store and analytics interfaces.
 */
class InterfacesModule extends AdvancedBase {
    async install(context) {
        const services = context.get('services');
        
        // Register interface services
        services.registerService('entitystore-interface', EntityStoreInterfaceService);
        services.registerService('analytics-interface', AnalyticsInterfaceService);
    }
}

module.exports = {
    InterfacesModule,
};