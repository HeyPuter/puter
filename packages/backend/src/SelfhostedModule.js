const { AdvancedBase } = require("puter-js-common");

class SelfhostedModule extends AdvancedBase {
    async install (context) {
        const services = context.get('services');

        const DefaultUserService = require('./services/DefaultUserService');
        services.registerService('__default-user', DefaultUserService);

        const ComplainAboutVersionsService = require('./services/ComplainAboutVersionsService');
        services.registerService('complain-about-versions', ComplainAboutVersionsService);
    }
}

module.exports = SelfhostedModule;
