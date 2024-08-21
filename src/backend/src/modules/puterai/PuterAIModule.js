const { AdvancedBase } = require("@heyputer/puter-js-common");
const config = require("../../config");

class PuterAIModule extends AdvancedBase {
    async install (context) {
        const services = context.get('services');

        const { AIInterfaceService } = require('./AIInterfaceService');
        services.registerService('__ai-interfaces', AIInterfaceService);

        // TODO: services should govern their own availability instead of
        //       the module deciding what to register

        if ( !! config?.services?.['aws-textract']?.aws ) {
            const { AWSTextractService } = require('./AWSTextractService');
            services.registerService('aws-textract', AWSTextractService);
        }

        if ( !! config?.services?.['aws-polly']?.aws ) {
            const { AWSPollyService } = require('./AWSPollyService');
            services.registerService('aws-polly', AWSPollyService);
        }

        if ( !! config?.openai ) {
            const { OpenAICompletionService } = require('./OpenAICompletionService');
            services.registerService('openai-completion', OpenAICompletionService);

            const { OpenAIImageGenerationService } = require('./OpenAIImageGenerationService');
            services.registerService('openai-image-generation', OpenAIImageGenerationService);
        }
        
        if ( !! config?.services?.claude ) {
            const { ClaudeService } = require('./ClaudeService');
            services.registerService('claude', ClaudeService);
        }
    }
}

module.exports = {
    PuterAIModule,
};
