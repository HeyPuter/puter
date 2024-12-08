// METADATA // {"ai-commented":{"service":"claude"}}
const { AdvancedBase } = require("@heyputer/putility");
const config = require("../../config");


/**
* PuterAIModule class extends AdvancedBase to manage and register various AI services.
* This module handles the initialization and registration of multiple AI-related services
* including text processing, speech synthesis, chat completion, and image generation.
* Services are conditionally registered based on configuration settings, allowing for
* flexible deployment with different AI providers like AWS, OpenAI, Claude, Together AI,
* Mistral, Groq, and XAI.
* @extends AdvancedBase
*/
class PuterAIModule extends AdvancedBase {
    /**
    * Module for managing AI-related services in the Puter platform
    * Extends AdvancedBase to provide core functionality
    * Handles registration and configuration of various AI services like OpenAI, Claude, AWS services etc.
    */
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

            // const { ClaudeEnoughService } = require('./ClaudeEnoughService');
            // services.registerService('claude', ClaudeEnoughService);
        }

        const { AIChatService } = require('./AIChatService');
        services.registerService('ai-chat', AIChatService);

        const { FakeChatService } = require('./FakeChatService');
        services.registerService('fake-chat', FakeChatService);

        const{ AITestModeService } = require('./AITestModeService');
        services.registerService('ai-test-mode', AITestModeService);
    }
}

module.exports = {
    PuterAIModule,
};
