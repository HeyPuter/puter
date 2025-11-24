/*
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

// METADATA // {"ai-commented":{"service":"claude"}}
const { AdvancedBase } = require('@heyputer/putility');
const config = require('../../config');

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

        if ( config?.services?.['aws-textract']?.aws ) {
            const { AWSTextractService } = require('./AWSTextractService');
            services.registerService('aws-textract', AWSTextractService);
        }

        if ( config?.services?.['aws-polly']?.aws ) {
            const { AWSPollyService } = require('./AWSPollyService');
            services.registerService('aws-polly', AWSPollyService);
        }

        if ( config?.services?.['elevenlabs'] || config?.elevenlabs ) {
            const { ElevenLabsTTSService } = require('./ElevenLabsTTSService');
            services.registerService('elevenlabs-tts', ElevenLabsTTSService);

            const { ElevenLabsVoiceChangerService } = require('./ElevenLabsVoiceChangerService');
            services.registerService('elevenlabs-voice-changer', ElevenLabsVoiceChangerService);
        }

        if ( config?.services?.openai || config?.openai ) {
            const { OpenAICompletionServiceWrapper } = require('./OpenAiCompletionService/index.mjs');
            services.registerService('openai-completion', OpenAICompletionServiceWrapper);

            const { OpenAIImageGenerationService } = require('./OpenAIImageGenerationService');
            services.registerService('openai-image-generation', OpenAIImageGenerationService);

            const { OpenAIVideoGenerationService } = require('./OpenAIVideoGenerationService');
            services.registerService('openai-video-generation', OpenAIVideoGenerationService);

            const { OpenAITTSService } = require('./OpenAITTSService');
            services.registerService('openai-tts', OpenAITTSService);

            const { OpenAISpeechToTextService } = require('./OpenAISpeechToTextService');
            services.registerService('openai-speech2txt', OpenAISpeechToTextService);
        }

        if ( config?.services?.claude ) {
            const { ClaudeService } = require('./ClaudeService');
            services.registerService('claude', ClaudeService);
        }

        if ( config?.services?.['together-ai'] ) {
            const { TogetherAIService } = require('./TogetherAIService');
            services.registerService('together-ai', TogetherAIService);

            const { TogetherImageGenerationService } = require('./TogetherImageGenerationService');
            services.registerService('together-image-generation', TogetherImageGenerationService);

            const { TogetherVideoGenerationService } = require('./TogetherVideoGenerationService');
            services.registerService('together-video-generation', TogetherVideoGenerationService);
        }

        if ( config?.services?.['mistral'] ) {
            const { MistralAIService } = require('./MistralAIService');
            services.registerService('mistral', MistralAIService);
        }

        if ( config?.services?.['groq'] ) {
            const { GroqAIService } = require('./GroqAIService');
            services.registerService('groq', GroqAIService);
        }

        if ( config?.services?.['xai'] ) {
            const { XAIService } = require('./XAIService');
            services.registerService('xai', XAIService);
        }

        if ( config?.services?.['deepseek'] ) {
            const { DeepSeekService } = require('./DeepSeekService');
            services.registerService('deepseek', DeepSeekService);
        }
        if ( config?.services?.['gemini'] ) {
            const { GeminiService } =  require('./GeminiService/GeminiService.mjs');
            const { GeminiImageGenerationService } = require('./GeminiImageGenerationService');

            services.registerService('gemini', GeminiService);
            services.registerService('gemini-image-generation', GeminiImageGenerationService);
        }
        if ( config?.services?.['openrouter'] ) {
            const { OpenRouterService } = require('./OpenRouterService');
            services.registerService('openrouter', OpenRouterService);
        }

        // Autodiscover Ollama service and then check if its disabled in the config
        // if config.services.ollama.enabled is undefined, it means the user hasn't set it, so we should default to true
        const ollama_available = await fetch('http://localhost:11434/api/tags').then(resp => resp.json()).then(_data => {
            const ollama_enabled = config?.services?.['ollama']?.enabled;
            if ( ollama_enabled === undefined ) {
                return true;
            }
            return ollama_enabled;
        }).catch(_err => {
            return false;
        });
        // User can disable ollama in the config, but by default it should be enabled if discovery is successful
        if ( ollama_available || config?.services?.['ollama']?.enabled ) {
            console.log('Local AI support detected! Registering Ollama');
            const { OllamaService } = require('./OllamaService');
            services.registerService('ollama', OllamaService);
        }

        const { AIChatService } = require('./AIChatService');
        services.registerService('ai-chat', AIChatService);

        const { FakeChatService } = require('./FakeChatService');
        services.registerService('fake-chat', FakeChatService);

        const { AITestModeService } = require('./AITestModeService');
        services.registerService('ai-test-mode', AITestModeService);

        const { UsageLimitedChatService } = require('./UsageLimitedChatService');
        services.registerService('usage-limited-chat', UsageLimitedChatService);
    }
}

module.exports = {
    PuterAIModule,
};
