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

const { AdvancedBase } = require('@heyputer/putility');
const FSNodeContext = require('../../filesystem/FSNodeContext');
const capabilities = require('../../filesystem/definitions/capabilities');
const selectors = require('../../filesystem/node/selectors');
const { RuntimeModule } = require('../../extension/RuntimeModule');
const { TmpProxyFSProvider } = require('./TmpProxyFSProvider');
const { MODE_READ, MODE_WRITE } = require('../../services/fs/FSLockService');

class PuterFSModule extends AdvancedBase {
    async install (context) {
        const services = context.get('services');

        const { RESOURCE_STATUS_PENDING_CREATE } = require('./ResourceService');

        // Expose filesystem declarations to extensions
        {
            const runtimeModule = new RuntimeModule({ name: 'fs' });
            runtimeModule.exports = {
                capabilities,
                selectors,
                FSNodeContext,
                TmpProxyFSProvider,
                lock: {
                    MODE_READ,
                    MODE_WRITE,
                },
                resource: {
                    RESOURCE_STATUS_PENDING_CREATE,
                },
            };
            context.get('runtime-modules').register(runtimeModule);
        }

        const { ResourceService } = require('./ResourceService');
        services.registerService('resourceService', ResourceService);

        const { DatabaseFSEntryService } = require('./DatabaseFSEntryService');
        services.registerService('fsEntryService', DatabaseFSEntryService);

        const { SizeService } = require('./SizeService');
        services.registerService('sizeService', SizeService);

        const { MountpointService } = require('./MountpointService');
        services.registerService('mountpoint', MountpointService);

        // const { PuterFSService } = require('./PuterFSService');
        // services.registerService('puterfs', PuterFSService);

        const DatabaseFSEntryFetcher = require('./DatabaseFSEntryFetcher');
        services.registerService('fsEntryFetcher', DatabaseFSEntryFetcher);

        const { MemoryFSService } = require('./customfs/MemoryFSService');
        services.registerService('memoryfs', MemoryFSService);
    }
}

module.exports = { PuterFSModule };
