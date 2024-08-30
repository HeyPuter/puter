const { AdvancedBase } = require("@heyputer/putility");

class TestDriversModule extends AdvancedBase {
    async install (context) {
        const services = context.get('services');
        
        const { TestAssetHostService } = require('./TestAssetHostService')
        services.registerService('__test-assets', TestAssetHostService);
        
        const { TestImageService } = require('./TestImageService');
        services.registerService('test-image', TestImageService);
    }
}

module.exports = {
    TestDriversModule,
};
