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
import { AdvancedBase } from '@heyputer/putility';
import config from '../../config.js';

/**
* PuterAIModule class extends AdvancedBase to manage and register various AI services.
* This module handles the initialization and registration of multiple AI-related services
* including text processing, speech synthesis, chat completion, and image generation.
* Services are conditionally registered based on configuration settings, allowing for
* flexible deployment with different AI providers like AWS, OpenAI, Claude, Together AI,
* Mistral, Groq, and XAI.
* @extends AdvancedBase
*/
export class PuterAIModule extends AdvancedBase {
    /**
    * Module for managing AI-related services in the Puter platform
    * Extends AdvancedBase to provide core functionality
    * Handles registration and configuration of various AI services like OpenAI, Claude, AWS services etc.
    */
    async install (context) {
        const services = context.get('services');

        const { AIInterfaceService } = require('../../services/ai/AIInterfaceService');
        services.registerService('__ai-interfaces', AIInterfaceService);

        // TODO: services should govern their own availability instead of
        //       the module deciding what to register

        if ( config?.services?.['aws-textract']?.aws ) {
            const { AWSTextractService } = require('../../services/ai/ocr/AWSTextractService.js');
            services.registerService('aws-textract', AWSTextractService);
        }

        if ( config?.services?.['aws-polly']?.aws ) {
            const { AWSPollyService } = require('../../services/ai/tts/AWSPollyService.js');
            services.registerService('aws-polly', AWSPollyService);
        }

        if ( config?.services?.['elevenlabs'] || config?.elevenlabs ) {
            const { ElevenLabsTTSService } = require('../../services/ai/tts/ElevenLabsTTSService.js');
            services.registerService('elevenlabs-tts', ElevenLabsTTSService);

            const { ElevenLabsVoiceChangerService } = require('../../services/ai/sts/ElevenLabsVoiceChangerService.js');
            services.registerService('elevenlabs-voice-changer', ElevenLabsVoiceChangerService);
        }

        if ( config?.services?.openai || config?.openai ) {
            const { OpenAICompletionServiceWrapper } = require('./OpenAiCompletionService/index.mjs');
            services.registerService('openai-completion', OpenAICompletionServiceWrapper);

            const { OpenAIImageGenerationService } = require('../../services/ai/image/OpenAIImageGenerationService.js');
            services.registerService('openai-image-generation', OpenAIImageGenerationService);

            const { OpenAIVideoGenerationService } = require('../../services/ai/video/OpenAIVideoGenerationService.js');
            services.registerService('openai-video-generation', OpenAIVideoGenerationService);

            const { OpenAITTSService } = require('../../services/ai/tts/OpenAITTSService.js');
            services.registerService('openai-tts', OpenAITTSService);

            const { OpenAISpeechToTextService } = require('../../services/ai/stt/OpenAISpeechToTextService.js');
            services.registerService('openai-speech2txt', OpenAISpeechToTextService);
        }

        if ( config?.services?.claude ) {
            const { ClaudeService } = require('../../services/ai/chat/providers/ClaudeProvider/ClaudeProvider.mjs');
            services.registerService('claude', ClaudeService);
        }

        if ( config?.services?.['together-ai'] ) {
            const { TogetherAIService } = require('./TogetherAIService');
            services.registerService('together-ai', TogetherAIService);

            const { TogetherImageGenerationService } = require('./TogetherImageGenerationService');
            services.registerService('together-image-generation', TogetherImageGenerationService);

            const { TogetherVideoGenerationService } = require('../../services/ai/video/TogetherVideoGenerationService.js');
            services.registerService('together-video-generation', TogetherVideoGenerationService);
        }

        if ( config?.services?.['mistral'] ) {
            const { MistralAIService } = require('../../services/ai/chat/providers/MistralAIService.js');
            services.registerService('mistral', MistralAIService);
        }

        if ( config?.services?.['groq'] ) {
            const { GroqAIService } = require('../../services/ai/chat/providers/GroqAIService.js');
            services.registerService('groq', GroqAIService);
        }

        if ( config?.services?.['xai'] ) {
            const { XAIService } = require('../../services/ai/chat/providers/XAIService.js');
            services.registerService('xai', XAIService);
        }

        if ( config?.services?.['deepseek'] ) {
            const { DeepSeekService } = require('../../services/ai/chat/providers/DeepSeekService.js');
            services.registerService('deepseek', DeepSeekService);
        }
        if ( config?.services?.['gemini'] ) {
            const { GeminiService } =  require('./GeminiService/GeminiService.mjs');
            const { GeminiImageGenerationService } = require('../../services/ai/image/GeminiImageGenerationService.js');

            services.registerService('gemini', GeminiService);
            services.registerService('gemini-image-generation', GeminiImageGenerationService);
        }
        if ( config?.services?.['openrouter'] ) {
            const { OpenRouterService } = require('../../services/ai/chat/providers/OpenRouterService.js');
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
            const { OllamaService } = require('../../services/ai/chat/providers/OllamaService.js');
            services.registerService('ollama', OllamaService);
        }

        const { AIChatService } = require('./AIChatService');
        services.registerService('ai-chat', AIChatService);

        const { FakeChatService } = require('../../services/ai/chat/providers/FakeChatService.js');
        services.registerService('fake-chat', FakeChatService);

        const { AITestModeService } = require('../../services/ai/AITestModeService');
        services.registerService('ai-test-mode', AITestModeService);

        const { UsageLimitedChatService } = require('../../services/ai/chat/providers/UsageLimitedChatService.js');
        services.registerService('usage-limited-chat', UsageLimitedChatService);
    }
}