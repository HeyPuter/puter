module.exports = class BillingModule extends use.Module {
    install (context) {
        const services = context.get('services');

        const { CustomPuterService } = require('./CustomPuterService.js');
        services.registerService('__custom-puter', CustomPuterService);
        
        const { ShareTestService } = require('./ShareTestService.js');
        services.registerService('__share-test', ShareTestService);
    }
}
