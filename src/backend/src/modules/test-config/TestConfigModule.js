const { AdvancedBase } = require('@heyputer/putility');

class TestConfigModule extends AdvancedBase {
    async install (context) {
        const services = context.get('services');
        const TestConfigUpdateService = require('./TestConfigUpdateService');
        services.registerService('__test-config-update', TestConfigUpdateService);
        const TestConfigReadService = require('./TestConfigReadService');
        services.registerService('__test-config-read', TestConfigReadService);
    }
}

module.exports = {
    TestConfigModule,
};
