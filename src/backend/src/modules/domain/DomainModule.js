const { AdvancedBase } = require('@heyputer/putility');

class DomainModule extends AdvancedBase {
    async install (context) {
        const services = context.get('services');

        const { DomainVerificationService } = require('./DomainVerificationService');
        services.registerService('domain-verification', DomainVerificationService);

        // TODO: enable flag
        const { TXTVerifyService } = require('./TXTVerifyService');
        services.registerService('__txt-verify', TXTVerifyService);
    }
}

module.exports = { DomainModule };
