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
import { AIInterfaceService } from '../../services/ai/AIInterfaceService.js';
import { AIChatService } from '../../services/ai/chat/AIChatService.js';
import { GeminiImageGenerationService } from '../../services/ai/image/GeminiImageGenerationService.js';
import { OpenAIImageGenerationService } from '../../services/ai/image/OpenAIImageGenerationService.js';
import { TogetherImageGenerationService } from '../../services/ai/image/TogetherImageGenerationService.js';
import { AWSTextractService } from '../../services/ai/ocr/AWSTextractService.js';
import { ElevenLabsVoiceChangerService } from '../../services/ai/sts/ElevenLabsVoiceChangerService.js';
import { OpenAISpeechToTextService } from '../../services/ai/stt/OpenAISpeechToTextService.js';
import { AWSPollyService } from '../../services/ai/tts/AWSPollyService.js';
import { ElevenLabsTTSService } from '../../services/ai/tts/ElevenLabsTTSService.js';
import { OpenAITTSService } from '../../services/ai/tts/OpenAITTSService.js';
import { OpenAIVideoGenerationService } from '../../services/ai/video/OpenAIVideoGenerationService.js';
import { TogetherVideoGenerationService } from '../../services/ai/video/TogetherVideoGenerationService.js';

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

        services.registerService('__ai-interfaces', AIInterfaceService);

        // completion ai service
        services.registerService('ai-chat', AIChatService);

        // TODO DS: centralize other service types too

        // TODO: services should govern their own availability instead of the module deciding what to register
        if ( config?.services?.['aws-textract']?.aws ) {

            services.registerService('aws-textract', AWSTextractService);
        }

        if ( config?.services?.['aws-polly']?.aws ) {

            services.registerService('aws-polly', AWSPollyService);
        }

        if ( config?.services?.['elevenlabs'] || config?.elevenlabs ) {
            services.registerService('elevenlabs-tts', ElevenLabsTTSService);

            services.registerService('elevenlabs-voice-changer', ElevenLabsVoiceChangerService);
        }

        if ( config?.services?.openai || config?.openai ) {

            services.registerService('openai-image-generation', OpenAIImageGenerationService);

            services.registerService('openai-video-generation', OpenAIVideoGenerationService);

            services.registerService('openai-tts', OpenAITTSService);

            services.registerService('openai-speech2txt', OpenAISpeechToTextService);
        }

        if ( config?.services?.['together-ai'] ) {

            services.registerService('together-image-generation', TogetherImageGenerationService);

            services.registerService('together-video-generation', TogetherVideoGenerationService);
        }

        if ( config?.services?.['gemini'] ) {

            services.registerService('gemini-image-generation', GeminiImageGenerationService);
        }
    }
}