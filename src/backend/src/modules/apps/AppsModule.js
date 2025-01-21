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

class AppsModule extends AdvancedBase {
    async install (context) {
        const services = context.get('services');

        const { AppInformationService } = require('./AppInformationService');
        services.registerService('app-information', AppInformationService);

        const { AppIconService } = require('./AppIconService');
        services.registerService('app-icon', AppIconService);

        const { OldAppNameService } = require('./OldAppNameService');
        services.registerService('old-app-name', OldAppNameService);

        const { ProtectedAppService } = require('./ProtectedAppService');
        services.registerService('__protected-app', ProtectedAppService);

        const RecommendedAppsService = require('./RecommendedAppsService');
        services.registerService('recommended-apps', RecommendedAppsService);
    }
}

module.exports = {
    AppsModule
};
