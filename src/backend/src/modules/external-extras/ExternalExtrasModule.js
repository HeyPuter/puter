const { AdvancedBase } = require("@heyputer/putility");
const config = require("../../config");

class ExternalExtrasModule extends AdvancedBase {
    async install (context) {
        const services = context.get('services');
        
        if ( !! config?.services?.ipgeo ) {
            const { IPGeoService } = require('./IPGeoService');
            services.registerService('ipgeo', IPGeoService);
        }
    }
}

module.exports = {
    ExternalExtrasModule,
};
