const { AdvancedBase } = require("@heyputer/putility");
const config = require("../../config");

class ExternalExtrasModule extends AdvancedBase {
    async install (context) {
        const services = context.get('services');
        
        if ( !! config?.services?.['ip-geo'] ) {
            const { IPGeoService } = require('./IPGeoService');
            services.registerService('ip-geo', IPGeoService);
        }
    }
}

module.exports = {
    ExternalExtrasModule,
};
