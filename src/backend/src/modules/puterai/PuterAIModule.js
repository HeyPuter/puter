const { AdvancedBase } = require("@heyputer/puter-js-common");

class PuterAIModule extends AdvancedBase {
    async install (context) {
        const services = context.get('services');

        const { AIInterfaceService } = require('./AIInterfaceService');
        services.registerService('__ai-interfaces', AIInterfaceService);

        const { AWSTextractService } = require('./AWSTextractService');
        services.registerService('aws-textract', AWSTextractService);

        const { AWSPollyService } = require('./AWSPollyService');
        services.registerService('aws-polly', AWSPollyService);

        const { OpenAICompletionService } = require('./OpenAICompletionService');
        services.registerService('openai-completion', OpenAICompletionService);

        const { OpenAIImageGenerationService } = require('./OpenAIImageGenerationService');
        services.registerService('openai-image-generation', OpenAIImageGenerationService);
    }
}

module.exports = {
    PuterAIModule,
};
