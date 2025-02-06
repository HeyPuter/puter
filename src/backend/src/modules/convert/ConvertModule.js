const { AdvancedBase } = require("@heyputer/putility");

class ConvertModule extends AdvancedBase {
    async install (context) {
        const services = context.get('services');

        const ConvertAPIService = require('./ConvertAPIService');
        services.registerService('convert-api', ConvertAPIService);
    }
}

module.exports = { ConvertModule };
