const { AdvancedBase } = require("@heyputer/putility");

class PuterWeatherModule extends AdvancedBase {
    async install (context) {
        const services = context.get('services');

        const { NationalWeatherServiceService } = require('./NationalWeatherServiceService');
        services.registerService('national-weather-service', NationalWeatherServiceService);
    }
}

module.exports = {
    PuterWeatherModule,
};