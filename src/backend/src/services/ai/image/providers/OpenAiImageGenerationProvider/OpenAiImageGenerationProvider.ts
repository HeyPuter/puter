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

import openai, { OpenAI } from 'openai';
import { ImageGenerateParamsNonStreaming } from 'openai/resources/images.js';
import APIError from '../../../../../api/APIError.js';
import { ErrorService } from '../../../../../modules/core/ErrorService.js';
import { Context } from '../../../../../util/context.js';
import { MeteringService } from '../../../../MeteringService/MeteringService.js';
import { IGenerateParams, IImageProvider } from '../types.js';
import { OPEN_AI_IMAGE_GENERATION_MODELS } from './models.js';
/**
* Service class for generating images using OpenAI's DALL-E API.
* Extends BaseService to provide image generation capabilities through
* the puter-image-generation interface. Supports different aspect ratios
* (square, portrait, landscape) and handles API authentication, request
* validation, and spending tracking.
*/
export class OpenAiImageGenerationProvider implements IImageProvider {
    #meteringService: MeteringService;
    #openai: OpenAI;
    #errors: ErrorService;

    constructor (config: { apiKey: string }, meteringService: MeteringService, errorService: ErrorService) {
        this.#meteringService = meteringService;
        this.#openai = new openai.OpenAI({
            apiKey: config.apiKey,
        });
        this.#errors = errorService;
    }

    models () {
        return OPEN_AI_IMAGE_GENERATION_MODELS;
    }

    getDefaultModel (): string {
        return 'dall-e-2';
    }

    async generate ({ prompt, quality, test_mode, model, ratio }: IGenerateParams) {

        const selectedModel = this.models().find(m => m.id === model) || this.models().find(m => m.id === this.getDefaultModel())!;

        if ( test_mode ) {
            return 'https://puter-sample-data.puter.site/image_example.png';
        }

        if ( typeof prompt !== 'string' ) {
            throw new Error('`prompt` must be a string');
        }

        const validRations = selectedModel?.allowedRatios;
        if ( validRations && (!ratio || !validRations.some(r => r.w === ratio.w && r.h === ratio.h)) ) {
            ratio = validRations[0]; // Default to the first allowed ratio
        }

        if ( ! ratio ) {
            ratio = { w: 1024, h: 1024 }; // Fallback ratio
        }

        const validQualities = selectedModel?.allowedQualityLevels;
        if ( validQualities && (!quality || !validQualities.includes(quality)) ) {
            quality = validQualities[0]; // Default to the first allowed quality
        }

        const size = `${ratio.w}x${ratio.h}`;
        const price_key = this.#buildPriceKey(selectedModel.id, quality!, size);
        if ( ! selectedModel?.costs[price_key] ) {
            const availableSizes = Object.keys(selectedModel?.costs);
            throw APIError.create('field_invalid', undefined, {
                key: 'size/quality combination',
                expected: `one of: ${ availableSizes.join(', ')}`,
                got: price_key,
            });
        }

        const actor = Context.get('actor');
        const user_private_uid = actor?.private_uid ?? 'UNKNOWN';
        if ( user_private_uid === 'UNKNOWN' ) {
            this.#errors.report('chat-completion-service:unknown-user', {
                message: 'failed to get a user ID for an OpenAI request',
                alarm: true,
                trace: true,
            });
        }

        const costInMicroCents = selectedModel.costs[price_key] * 1_000_000;
        const usageAllowed = await this.#meteringService.hasEnoughCredits(actor, costInMicroCents);

        if ( ! usageAllowed ) {
            throw APIError.create('insufficient_funds');
        }

        // Build API parameters based on model
        const apiParams = this.#buildApiParams(selectedModel.id, {
            user: user_private_uid,
            prompt,
            size,
            quality,
        } as Partial<ImageGenerateParamsNonStreaming>);

        const result = await this.#openai.images.generate(apiParams);

        // For image generation, usage is typically image count and resolution
        const usageType = `openai:${selectedModel.id}:${price_key}`;
        this.#meteringService.incrementUsage(actor, usageType, 1, costInMicroCents);

        const spending_meta = {
            model,
            size: `${ratio.w}x${ratio.h}`,
        };

        if ( quality ) {
            spending_meta.size = `${quality}:${ spending_meta.size}`;
        }

        const url = result.data?.[0]?.url || (result.data?.[0]?.b64_json ? `data:image/png;base64,${ result.data[0].b64_json}` : null);

        if ( ! url ) {
            throw new Error('Failed to extract image URL from OpenAI response');
        }

        return url;
    }

    #buildPriceKey (model: string, quality: string, size: string) {
        if ( model === 'gpt-image-1' || model === 'gpt-image-1-mini' ) {
            // gpt-image-1 and gpt-image-1-mini use format: "quality:size" - default to low if not specified
            const qualityLevel = quality || 'low';
            return `${qualityLevel}:${size}`;
        } else {
            // dall-e models use format: "hd:size" or just "size"
            return (quality === 'hd' ? 'hd:' : '') + size;
        }
    }

    #buildApiParams (model: string, baseParams: Partial<ImageGenerateParamsNonStreaming>): ImageGenerateParamsNonStreaming {
        const apiParams = {
            user: baseParams.user,
            prompt: baseParams.prompt,
            size: baseParams.size,
        } as ImageGenerateParamsNonStreaming;

        if ( model === 'gpt-image-1' || model === 'gpt-image-1-mini' ) {
            // gpt-image-1 requires the model parameter and uses different quality mapping
            apiParams.model = model;
            // Default to low quality if not specified, consistent with _buildPriceKey
            apiParams.quality = baseParams.quality || 'low';
        } else {
            // dall-e models
            apiParams.model = model;
            if ( baseParams.quality === 'hd' ) {
                apiParams.quality = 'hd';
            }
        }

        return apiParams;
    }
}
