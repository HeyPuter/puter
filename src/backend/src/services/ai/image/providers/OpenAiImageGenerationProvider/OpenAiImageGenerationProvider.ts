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
import { ImageGenerateParamsNonStreaming, ImagesResponse } from 'openai/resources/images.js';
import APIError from '../../../../../api/APIError.js';
import { ErrorService } from '../../../../../modules/core/ErrorService.js';
import { Context } from '../../../../../util/context.js';
import { MeteringService } from '../../../../MeteringService/MeteringService.js';
import { IGenerateParams, IImageModel, IImageProvider } from '../types.js';
import { OPEN_AI_IMAGE_GENERATION_MODELS } from './models.js';

interface OpenAIImageUsage {
    inputTokens: number;
    outputTokens: number;
    inputTextTokens: number;
    inputImageTokens: number;
    cachedInputTokens: number;
    cachedInputTextTokens: number;
    cachedInputImageTokens: number;
}

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

    static #NON_SIZE_COST_KEYS = [
        'text_input',
        'text_cached_input',
        'text_output',
        'image_input',
        'image_cached_input',
        'image_output',
    ];

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
        const outputPriceInCents = selectedModel?.costs[price_key];
        if ( outputPriceInCents === undefined ) {
            const availableSizes = Object.keys(selectedModel?.costs)
                .filter(key => !OpenAiImageGenerationProvider.#NON_SIZE_COST_KEYS.includes(key));
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

        const estimatedPromptTokenCount = this.#estimatePromptTokenCount(prompt);
        const estimatedInputCostInCents = this.#calculateInputCostInCents(selectedModel, {
            inputTokens: estimatedPromptTokenCount,
            inputTextTokens: estimatedPromptTokenCount,
            inputImageTokens: 0,
            cachedInputTokens: 0,
            cachedInputTextTokens: 0,
            cachedInputImageTokens: 0,
        } as OpenAIImageUsage);
        const estimatedOutputCostInCents = outputPriceInCents;
        const estimatedTotalCostInMicroCents = this.#toMicroCents(estimatedInputCostInCents + estimatedOutputCostInCents);
        const usageAllowed = await this.#meteringService.hasEnoughCredits(actor, estimatedTotalCostInMicroCents);

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

        const usage = this.#extractUsage(result);
        const hasInputTokenUsage =
            usage.inputTokens > 0 ||
            usage.inputTextTokens > 0 ||
            usage.inputImageTokens > 0;
        const hasOutputTokenUsage = usage.outputTokens > 0;

        const billableUsage = hasInputTokenUsage ? usage : {
            ...usage,
            inputTokens: estimatedPromptTokenCount,
            inputTextTokens: estimatedPromptTokenCount,
        };

        const inputCostInCents = hasInputTokenUsage
            ? this.#calculateInputCostInCents(selectedModel, billableUsage)
            : estimatedInputCostInCents;
        const outputCostInCents = this.#calculateOutputCostInCents(selectedModel, usage, outputPriceInCents);

        const usageType = `openai:${selectedModel.id}:${price_key}`;
        const usageEntries: Array<{ usageType: string; usageAmount: number; costOverride: number }> = [];
        if ( inputCostInCents > 0 ) {
            usageEntries.push({
                usageType: `${usageType}:input`,
                usageAmount: Math.max(billableUsage.inputTokens || estimatedPromptTokenCount, 1),
                costOverride: this.#toMicroCents(inputCostInCents),
            });
        }
        if ( outputCostInCents > 0 ) {
            usageEntries.push({
                usageType: `${usageType}:output`,
                usageAmount: Math.max(usage.outputTokens, 1),
                costOverride: this.#toMicroCents(outputCostInCents),
            });
        }
        if ( usageEntries.length ) {
            this.#meteringService.batchIncrementUsages(actor, usageEntries);
        }

        this.#setResponseCostMetadata({
            model: selectedModel.id,
            quality,
            ratio,
            inputCostInCents,
            outputCostInCents,
            usage: billableUsage,
            inputUsageSource: hasInputTokenUsage ? 'token-usage' : 'prompt-estimate',
            outputUsageSource: hasOutputTokenUsage ? 'token-usage' : 'per-image-fallback',
            outputPriceInCents,
        });

        const url = result.data?.[0]?.url || (result.data?.[0]?.b64_json ? `data:image/png;base64,${ result.data[0].b64_json}` : null);

        if ( ! url ) {
            throw new Error('Failed to extract image URL from OpenAI response');
        }

        return url;
    }

    #extractUsage (result: ImagesResponse): OpenAIImageUsage {
        const usage = (result.usage ?? {}) as ImagesResponse.Usage & Record<string, unknown>;
        const inputTokens = this.#toSafeCount(usage.input_tokens);
        const outputTokens = this.#toSafeCount(usage.output_tokens);

        const inputDetails = (usage.input_tokens_details ?? {}) as unknown as Record<string, unknown>;
        const inputTextTokens = this.#toSafeCount(inputDetails.text_tokens);
        const inputImageTokens = this.#toSafeCount(inputDetails.image_tokens);

        const cachedInputTokens = Math.max(
            this.#toSafeCount((usage as Record<string, unknown>).cached_input_tokens),
            this.#toSafeCount(inputDetails.cached_tokens),
        );

        const cachedDetails = ((inputDetails.cached_tokens_details || inputDetails.cache_tokens_details) ?? {}) as Record<string, unknown>;
        const cachedInputTextTokens = this.#toSafeCount(cachedDetails.text_tokens);
        const cachedInputImageTokens = this.#toSafeCount(cachedDetails.image_tokens);

        return {
            inputTokens,
            outputTokens,
            inputTextTokens,
            inputImageTokens,
            cachedInputTokens,
            cachedInputTextTokens,
            cachedInputImageTokens,
        };
    }

    #calculateInputCostInCents (selectedModel: IImageModel, usage: OpenAIImageUsage): number {
        if ( ! this.#isGptImageModel(selectedModel.id) ) {
            return 0;
        }

        const textInputRate = this.#getCostRate(selectedModel, 'text_input');
        const textCachedInputRate = this.#getCostRate(selectedModel, 'text_cached_input') ?? textInputRate;
        const imageInputRate = this.#getCostRate(selectedModel, 'image_input');
        const imageCachedInputRate = this.#getCostRate(selectedModel, 'image_cached_input') ?? imageInputRate;

        if ( textInputRate === undefined && imageInputRate === undefined ) {
            return 0;
        }

        const totalInputTokens = Math.max(usage.inputTokens, usage.inputTextTokens + usage.inputImageTokens);
        let textTokens = usage.inputTextTokens;
        let imageTokens = usage.inputImageTokens;

        // Current image generate calls are usually text-only prompts.
        if ( textTokens + imageTokens === 0 && totalInputTokens > 0 ) {
            textTokens = totalInputTokens;
        }

        const knownInputTokens = textTokens + imageTokens;
        let cachedInputTokens = Math.min(usage.cachedInputTokens, knownInputTokens || totalInputTokens);

        let cachedTextTokens = Math.min(usage.cachedInputTextTokens, textTokens);
        let cachedImageTokens = Math.min(usage.cachedInputImageTokens, imageTokens);

        let cachedRemaining = Math.max(0, cachedInputTokens - (cachedTextTokens + cachedImageTokens));
        if ( cachedRemaining > 0 ) {
            const availableText = Math.max(textTokens - cachedTextTokens, 0);
            const availableImage = Math.max(imageTokens - cachedImageTokens, 0);
            const availableTotal = availableText + availableImage;

            if ( availableTotal > 0 ) {
                const proportionalText = Math.min(availableText, Math.round((availableText / availableTotal) * cachedRemaining));
                cachedTextTokens += proportionalText;
                cachedRemaining -= proportionalText;

                const proportionalImage = Math.min(availableImage, cachedRemaining);
                cachedImageTokens += proportionalImage;
                cachedRemaining -= proportionalImage;
            }

            if ( cachedRemaining > 0 && textTokens > cachedTextTokens ) {
                const extraText = Math.min(textTokens - cachedTextTokens, cachedRemaining);
                cachedTextTokens += extraText;
                cachedRemaining -= extraText;
            }

            if ( cachedRemaining > 0 && imageTokens > cachedImageTokens ) {
                const extraImage = Math.min(imageTokens - cachedImageTokens, cachedRemaining);
                cachedImageTokens += extraImage;
                cachedRemaining -= extraImage;
            }
        }

        const uncachedTextTokens = Math.max(textTokens - cachedTextTokens, 0);
        const uncachedImageTokens = Math.max(imageTokens - cachedImageTokens, 0);

        return this.#costForTokens(uncachedTextTokens, textInputRate)
            + this.#costForTokens(cachedTextTokens, textCachedInputRate)
            + this.#costForTokens(uncachedImageTokens, imageInputRate)
            + this.#costForTokens(cachedImageTokens, imageCachedInputRate);
    }

    #calculateOutputCostInCents (selectedModel: IImageModel, usage: OpenAIImageUsage, fallbackPriceInCents: number): number {
        if ( ! this.#isGptImageModel(selectedModel.id) ) {
            return fallbackPriceInCents;
        }

        if ( usage.outputTokens <= 0 ) {
            return fallbackPriceInCents;
        }

        const imageOutputRate = this.#getCostRate(selectedModel, 'image_output');
        if ( imageOutputRate !== undefined ) {
            return this.#costForTokens(usage.outputTokens, imageOutputRate);
        }

        const textOutputRate = this.#getCostRate(selectedModel, 'text_output');
        if ( textOutputRate !== undefined ) {
            return this.#costForTokens(usage.outputTokens, textOutputRate);
        }

        return fallbackPriceInCents;
    }

    #setResponseCostMetadata ({
        model,
        quality,
        ratio,
        inputCostInCents,
        outputCostInCents,
        usage,
        inputUsageSource,
        outputUsageSource,
        outputPriceInCents,
    }: {
        model: string;
        quality?: string;
        ratio: { w: number; h: number };
        inputCostInCents: number;
        outputCostInCents: number;
        usage: OpenAIImageUsage;
        inputUsageSource: 'token-usage' | 'prompt-estimate';
        outputUsageSource: 'token-usage' | 'per-image-fallback';
        outputPriceInCents: number;
    }) {
        const clientDriverCall = Context.get('client_driver_call') as { response_metadata?: Record<string, unknown> } | undefined;
        const responseMetadata = clientDriverCall?.response_metadata;
        if ( ! responseMetadata ) return;

        const totalCostInCents = inputCostInCents + outputCostInCents;
        responseMetadata.cost = {
            currency: 'usd-cents',
            input: inputCostInCents,
            output: outputCostInCents,
            total: totalCostInCents,
        };
        responseMetadata.cost_components = {
            provider: 'openai-image-generation',
            model,
            quality,
            ratio: `${ratio.w}x${ratio.h}`,
            input_usage_source: inputUsageSource,
            output_usage_source: outputUsageSource,
            output_image_price_cents: outputPriceInCents,
            input_tokens: usage.inputTokens,
            output_tokens: usage.outputTokens,
            input_text_tokens: usage.inputTextTokens,
            input_image_tokens: usage.inputImageTokens,
            cached_input_tokens: usage.cachedInputTokens,
            cached_input_text_tokens: usage.cachedInputTextTokens,
            cached_input_image_tokens: usage.cachedInputImageTokens,
            input_microcents: this.#toMicroCents(inputCostInCents),
            output_microcents: this.#toMicroCents(outputCostInCents),
            total_microcents: this.#toMicroCents(totalCostInCents),
        };
    }

    #estimatePromptTokenCount (prompt: string): number {
        const text = prompt.trim();
        if ( text.length === 0 ) return 0;

        // Same approximation used by chat and Gemini image billing flows.
        return Math.max(1, Math.floor(((text.length / 4) + (text.split(/\s+/).length * (4 / 3))) / 2));
    }

    #getCostRate (selectedModel: IImageModel, key: string): number | undefined {
        const value = selectedModel.costs[key];
        if ( ! Number.isFinite(value) ) {
            return undefined;
        }
        return value;
    }

    #costForTokens (tokenCount: number, centsPerMillion?: number): number {
        if ( !Number.isFinite(tokenCount) || tokenCount <= 0 ) return 0;
        if ( !Number.isFinite(centsPerMillion) || (centsPerMillion ?? 0) <= 0 ) return 0;
        return (tokenCount / 1_000_000) * (centsPerMillion as number);
    }

    #toMicroCents (cents: number): number {
        if ( !Number.isFinite(cents) || cents <= 0 ) return 1;
        return Math.ceil(cents * 1_000_000);
    }

    #toSafeCount (value: unknown): number {
        if ( typeof value !== 'number' || !Number.isFinite(value) || value < 0 ) return 0;
        return Math.floor(value);
    }

    #isGptImageModel (model: string) {
        // Covers gpt-image-1, gpt-image-1-mini, gpt-image-1.5 and future variants.
        return model.startsWith('gpt-image-1');
    }

    #buildPriceKey (model: string, quality: string, size: string) {
        if ( this.#isGptImageModel(model) ) {
            // GPT image models use format: "quality:size" - default to low if not specified
            const qualityLevel = quality || 'low';
            return `${qualityLevel}:${size}`;
        }

        // DALL-E models use format: "hd:size" or just "size"
        return (quality === 'hd' ? 'hd:' : '') + size;
    }

    #buildApiParams (model: string, baseParams: Partial<ImageGenerateParamsNonStreaming>): ImageGenerateParamsNonStreaming {
        const apiParams = {
            user: baseParams.user,
            prompt: baseParams.prompt,
            size: baseParams.size,
        } as ImageGenerateParamsNonStreaming;

        if ( this.#isGptImageModel(model) ) {
            // GPT image models require the model parameter and use quality mapping
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
