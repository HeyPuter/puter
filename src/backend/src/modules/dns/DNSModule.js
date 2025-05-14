const { AdvancedBase } = require("@heyputer/putility");

class DNSModule extends AdvancedBase {
    async install (context) {
        const services = context.get('services');
        
        const { DNSService } = require('./DNSService');
        services.registerService('dns', DNSService);
    }
}

module.exports = {
    DNSModule,
};
