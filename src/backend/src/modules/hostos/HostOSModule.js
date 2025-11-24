const { AdvancedBase } = require('@heyputer/putility');

class HostOSModule extends AdvancedBase {
    async install (context) {
        const services = context.get('services');

        const ProcessService = require('./ProcessService');
        services.registerService('process', ProcessService);
    }
}

module.exports = {
    HostOSModule,
};
