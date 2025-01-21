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

class PuterFSModule extends AdvancedBase {
    async install (context) {
        const services = context.get('services');
        
        const { ResourceService } = require("./ResourceService");
        services.registerService('resourceService', ResourceService);
        
        const { DatabaseFSEntryService } = require("./DatabaseFSEntryService");
        services.registerService('fsEntryService', DatabaseFSEntryService);
        
        const { SizeService } = require('./SizeService');
        services.registerService('sizeService', SizeService);
        
        const { MountpointService } = require('./MountpointService');
        services.registerService('mountpoint', MountpointService);

        const { PuterFSService } = require('./PuterFSService');
        services.registerService('puterfs', PuterFSService);
        
        const DatabaseFSEntryFetcher = require("./DatabaseFSEntryFetcher");
        services.registerService('fsEntryFetcher', DatabaseFSEntryFetcher);
    }
}

module.exports = { PuterFSModule };
