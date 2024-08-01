const { AdvancedBase } = require("@heyputer/puter-js-common");

class PuterAIModule extends AdvancedBase {
    async install (context) {
        const services = context.get('services');

        const { AIInterfaceService } = require('./AIInterfaceService');
        services.registerService('__ai-interfaces', AIInterfaceService);

        const { AWSTextractService } = require('./AWSTextractService');
        services.registerService('aws-textract', AWSTextractService);
    }
}

module.exports = {
    PuterAIModule,
};
