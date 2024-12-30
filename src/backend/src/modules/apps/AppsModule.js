const { AdvancedBase } = require("@heyputer/putility");

class AppsModule extends AdvancedBase {
    async install (context) {
        const services = context.get('services');

        const { AppInformationService } = require('./AppInformationService');
        services.registerService('app-information', AppInformationService);
    }
}

module.exports = {
    AppsModule
};
