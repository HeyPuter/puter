const { AdvancedBase } = require("@heyputer/putility");
const config = require("../../config");

class ExternalExtrasModule extends AdvancedBase {
    async install (context) {
        const services = context.get('services');
        
        if ( !! config?.services?.ipgeo ) {
            const { IPGeoService } = require('./IPGeoService');
            services.registerService('ipgeo', IPGeoService);
        }
        if ( !! config?.services?.newsdata ) {
            const { NewsDataService } = require('./NewsDataService');
            services.registerService('newsdata', NewsDataService);
        }
        if ( !! config?.services?.weather ) {
            const { WeatherService } = require('./WeatherService');
            services.registerService('weather', WeatherService);
        }
    }
}

module.exports = {
    ExternalExtrasModule,
};
