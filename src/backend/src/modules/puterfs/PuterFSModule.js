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
