const { AdvancedBase } = require("puter-js-common");

class SelfhostedModule extends AdvancedBase {
    async install (context) {
        const services = context.get('services');

        const DefaultUserService = require('./services/DefaultUserService');
        services.registerService('__default-user', DefaultUserService);
    }
}

module.exports = SelfhostedModule;
