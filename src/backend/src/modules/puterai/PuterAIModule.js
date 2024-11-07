const { AdvancedBase } = require("@heyputer/putility");
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

        if ( !! config?.services?.['together-ai'] ) {
            const { TogetherAIService } = require('./TogetherAIService');
            services.registerService('together-ai', TogetherAIService);
        }
        
        if ( !! config?.services?.['mistral'] ) {
            const { MistralAIService } = require('./MistralAIService');
            services.registerService('mistral', MistralAIService);
        }
        
        if ( !! config?.services?.['groq'] ) {
            const { GroqAIService } = require('./GroqAIService');
            services.registerService('groq', GroqAIService);
        }

        if ( !! config?.services?.['xai'] ) {
            const { XAIService } = require('./XAIService');
            services.registerService('xai', XAIService);
        }
    }
}

module.exports = {
    PuterAIModule,
};
