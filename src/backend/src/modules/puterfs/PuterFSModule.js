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
    }
}

module.exports = { PuterFSModule };
