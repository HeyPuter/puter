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
import {
    ImageGenerateParamsNonStreaming,
    ImagesResponse,
} from 'openai/resources/images.js';
import { Context } from '../../../../core/context.js';
import type { MeteringService } from '../../../../services/metering/MeteringService.js';
import type {
    IGenerateParams,
    IImageModel,
    IImageProvider,
} from '../../types.js';
import { OPEN_AI_IMAGE_GENERATION_MODELS } from './models.js';
import { HttpError } from '@heyputer/backend/src/core/http/HttpError.js';

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
 * OpenAI image generation provider for v2.
 * Supports DALL-E 2/3 and GPT Image models.
 */
export class OpenAiImageProvider implements IImageProvider {
    #meteringService: MeteringService;
    #openai: OpenAI;

    static #NON_SIZE_COST_KEYS = [
        'text_input',
        'text_cached_input',
        'text_output',
        'image_input',
        'image_cached_input',
        'image_output',
    ];

    constructor(config: { apiKey: string }, meteringService: MeteringService) {
        this.#meteringService = meteringService;
        this.#openai = new openai.OpenAI({
            apiKey: config.apiKey,
        });
    }

    models() {
        return OPEN_AI_IMAGE_GENERATION_MODELS;
    }

    getDefaultModel(): string {
        return 'dall-e-2';
    }

    async generate({
        prompt,
        quality,
        test_mode,
        model,
        ratio,
    }: IGenerateParams) {
        const selectedModel =
            this.models().find((m) => m.id === model) ||
            this.models().find((m) => m.id === this.getDefaultModel())!;

        if (test_mode) {
            return 'https://puter-sample-data.puter.site/image_example.png';
        }

        if (typeof prompt !== 'string') {
            throw new HttpError(400, '`prompt` must be a string', {
                legacyCode: 'bad_request',
            });
        }

        const validRatios = selectedModel?.allowedRatios;
        if (validRatios) {
            if (
                !ratio ||
                !validRatios.some((r) => r.w === ratio.w && r.h === ratio.h)
            ) {
                ratio = validRatios[0]; // Default to the first allowed ratio
            }
        } else {
            // Open-ended size models (gpt-image-2): conform to OpenAI's size
            // rules (16px multiples, 3840 cap, 3:1 ratio, pixel budget).
            ratio = this.#normalizeGptImage2Ratio(ratio);
        }

        if (!ratio) {
            ratio = { w: 1024, h: 1024 }; // Fallback ratio
        }

        const validQualities = selectedModel?.allowedQualityLevels;
        if (validQualities && (!quality || !validQualities.includes(quality))) {
            quality = validQualities[0]; // Default to the first allowed quality
        }

        const size = `${ratio.w}x${ratio.h}`;
        const price_key = this.#buildPriceKey(selectedModel.id, quality!, size);
        let outputPriceInCents: number | undefined =
            selectedModel?.costs[price_key];
        if (outputPriceInCents === undefined) {
            outputPriceInCents = this.#estimateOutputCostFromTokens(
                selectedModel,
                ratio,
                quality,
            );
        }
        if (outputPriceInCents === undefined) {
            const availableSizes = Object.keys(selectedModel?.costs).filter(
                (key) => !OpenAiImageProvider.#NON_SIZE_COST_KEYS.includes(key),
            );
            throw new HttpError(
                400,
                `Invalid size/quality combination. Expected one of: ${availableSizes.join(', ')}. Got: ${price_key}`,
                { legacyCode: 'bad_request' },
            );
        }

        const actor = Context.get('actor');
        const userIdentifier =
            actor?.user.id + actor?.app?.uid ? `:${actor?.app?.uid}` : '';

        const estimatedPromptTokenCount =
            this.#estimatePromptTokenCount(prompt);
        const estimatedInputCostInCents = this.#calculateInputCostInCents(
            selectedModel,
            {
                inputTokens: estimatedPromptTokenCount,
                inputTextTokens: estimatedPromptTokenCount,
                inputImageTokens: 0,
                cachedInputTokens: 0,
                cachedInputTextTokens: 0,
                cachedInputImageTokens: 0,
            } as OpenAIImageUsage,
        );
        const estimatedOutputCostInCents = outputPriceInCents;
        const estimatedTotalCostInMicroCents = this.#toMicroCents(
            estimatedInputCostInCents + estimatedOutputCostInCents,
        );
        const usageAllowed = await this.#meteringService.hasEnoughCredits(
            actor,
            estimatedTotalCostInMicroCents,
        );

        if (!usageAllowed) {
            throw new HttpError(
                402,
                'Insufficient credits for image generation',
                { legacyCode: 'insufficient_funds' },
            );
        }

        // Build API parameters based on model
        const apiParams = this.#buildApiParams(selectedModel.id, {
            user: userIdentifier,
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

        const billableUsage = hasInputTokenUsage
            ? usage
            : {
                  ...usage,
                  inputTokens: estimatedPromptTokenCount,
                  inputTextTokens: estimatedPromptTokenCount,
              };

        const inputCostInCents = hasInputTokenUsage
            ? this.#calculateInputCostInCents(selectedModel, billableUsage)
            : estimatedInputCostInCents;
        const outputCostInCents = this.#calculateOutputCostInCents(
            selectedModel,
            usage,
            outputPriceInCents,
        );

        const usageType = `openai:${selectedModel.id}:${price_key}`;
        const usageEntries: Array<{
            usageType: string;
            usageAmount: number;
            costOverride: number;
        }> = [];
        if (inputCostInCents > 0) {
            usageEntries.push({
                usageType: `${usageType}:input`,
                usageAmount: Math.max(
                    billableUsage.inputTokens || estimatedPromptTokenCount,
                    1,
                ),
                costOverride: this.#toMicroCents(inputCostInCents),
            });
        }
        if (outputCostInCents > 0) {
            usageEntries.push({
                usageType: `${usageType}:output`,
                usageAmount: Math.max(usage.outputTokens, 1),
                costOverride: this.#toMicroCents(outputCostInCents),
            });
        }
        if (usageEntries.length) {
            this.#meteringService.batchIncrementUsages(actor, usageEntries);
        }

        const url =
            result.data?.[0]?.url ||
            (result.data?.[0]?.b64_json
                ? `data:image/png;base64,${result.data[0].b64_json}`
                : null);

        if (!url) {
            throw new HttpError(
                400,
                'Failed to extract image URL from OpenAI response',
                { legacyCode: 'unknown_error' },
            );
        }

        return url;
    }

    #extractUsage(result: ImagesResponse): OpenAIImageUsage {
        const usage = (result.usage ?? {}) as ImagesResponse.Usage &
            Record<string, unknown>;
        const inputTokens = this.#toSafeCount(usage.input_tokens);
        const outputTokens = this.#toSafeCount(usage.output_tokens);

        const inputDetails = (usage.input_tokens_details ??
            {}) as unknown as Record<string, unknown>;
        const inputTextTokens = this.#toSafeCount(inputDetails.text_tokens);
        const inputImageTokens = this.#toSafeCount(inputDetails.image_tokens);

        const cachedInputTokens = Math.max(
            this.#toSafeCount(
                (usage as Record<string, unknown>).cached_input_tokens,
            ),
            this.#toSafeCount(inputDetails.cached_tokens),
        );

        const cachedDetails = ((inputDetails.cached_tokens_details ||
            inputDetails.cache_tokens_details) ??
            {}) as Record<string, unknown>;
        const cachedInputTextTokens = this.#toSafeCount(
            cachedDetails.text_tokens,
        );
        const cachedInputImageTokens = this.#toSafeCount(
            cachedDetails.image_tokens,
        );

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

    #calculateInputCostInCents(
        selectedModel: IImageModel,
        usage: OpenAIImageUsage,
    ): number {
        if (!this.#isGptImageModel(selectedModel.id)) {
            return 0;
        }

        const textInputRate = this.#getCostRate(selectedModel, 'text_input');
        const textCachedInputRate =
            this.#getCostRate(selectedModel, 'text_cached_input') ??
            textInputRate;
        const imageInputRate = this.#getCostRate(selectedModel, 'image_input');
        const imageCachedInputRate =
            this.#getCostRate(selectedModel, 'image_cached_input') ??
            imageInputRate;

        if (textInputRate === undefined && imageInputRate === undefined) {
            return 0;
        }

        const totalInputTokens = Math.max(
            usage.inputTokens,
            usage.inputTextTokens + usage.inputImageTokens,
        );
        let textTokens = usage.inputTextTokens;
        const imageTokens = usage.inputImageTokens;

        // Current image generate calls are usually text-only prompts.
        if (textTokens + imageTokens === 0 && totalInputTokens > 0) {
            textTokens = totalInputTokens;
        }

        const knownInputTokens = textTokens + imageTokens;
        const cachedInputTokens = Math.min(
            usage.cachedInputTokens,
            knownInputTokens || totalInputTokens,
        );

        let cachedTextTokens = Math.min(
            usage.cachedInputTextTokens,
            textTokens,
        );
        let cachedImageTokens = Math.min(
            usage.cachedInputImageTokens,
            imageTokens,
        );

        let cachedRemaining = Math.max(
            0,
            cachedInputTokens - (cachedTextTokens + cachedImageTokens),
        );
        if (cachedRemaining > 0) {
            const availableText = Math.max(textTokens - cachedTextTokens, 0);
            const availableImage = Math.max(imageTokens - cachedImageTokens, 0);
            const availableTotal = availableText + availableImage;

            if (availableTotal > 0) {
                const proportionalText = Math.min(
                    availableText,
                    Math.round(
                        (availableText / availableTotal) * cachedRemaining,
                    ),
                );
                cachedTextTokens += proportionalText;
                cachedRemaining -= proportionalText;

                const proportionalImage = Math.min(
                    availableImage,
                    cachedRemaining,
                );
                cachedImageTokens += proportionalImage;
                cachedRemaining -= proportionalImage;
            }

            if (cachedRemaining > 0 && textTokens > cachedTextTokens) {
                const extraText = Math.min(
                    textTokens - cachedTextTokens,
                    cachedRemaining,
                );
                cachedTextTokens += extraText;
                cachedRemaining -= extraText;
            }

            if (cachedRemaining > 0 && imageTokens > cachedImageTokens) {
                const extraImage = Math.min(
                    imageTokens - cachedImageTokens,
                    cachedRemaining,
                );
                cachedImageTokens += extraImage;
                cachedRemaining -= extraImage;
            }
        }

        const uncachedTextTokens = Math.max(textTokens - cachedTextTokens, 0);
        const uncachedImageTokens = Math.max(
            imageTokens - cachedImageTokens,
            0,
        );

        return (
            this.#costForTokens(uncachedTextTokens, textInputRate) +
            this.#costForTokens(cachedTextTokens, textCachedInputRate) +
            this.#costForTokens(uncachedImageTokens, imageInputRate) +
            this.#costForTokens(cachedImageTokens, imageCachedInputRate)
        );
    }

    #calculateOutputCostInCents(
        selectedModel: IImageModel,
        usage: OpenAIImageUsage,
        fallbackPriceInCents: number,
    ): number {
        if (!this.#isGptImageModel(selectedModel.id)) {
            return fallbackPriceInCents;
        }

        if (usage.outputTokens <= 0) {
            return fallbackPriceInCents;
        }

        const imageOutputRate = this.#getCostRate(
            selectedModel,
            'image_output',
        );
        if (imageOutputRate !== undefined) {
            return this.#costForTokens(usage.outputTokens, imageOutputRate);
        }

        const textOutputRate = this.#getCostRate(selectedModel, 'text_output');
        if (textOutputRate !== undefined) {
            return this.#costForTokens(usage.outputTokens, textOutputRate);
        }

        return fallbackPriceInCents;
    }

    #estimatePromptTokenCount(prompt: string): number {
        const text = prompt.trim();
        if (text.length === 0) return 0;

        // Same approximation used by chat and Gemini image billing flows.
        return Math.max(
            1,
            Math.floor(
                (text.length / 4 + text.split(/\s+/).length * (4 / 3)) / 2,
            ),
        );
    }

    #getCostRate(selectedModel: IImageModel, key: string): number | undefined {
        const value = selectedModel.costs[key];
        if (!Number.isFinite(value)) {
            return undefined;
        }
        return value;
    }

    #costForTokens(tokenCount: number, centsPerMillion?: number): number {
        if (!Number.isFinite(tokenCount) || tokenCount <= 0) return 0;
        if (!Number.isFinite(centsPerMillion) || (centsPerMillion ?? 0) <= 0)
            return 0;
        return (tokenCount / 1_000_000) * (centsPerMillion as number);
    }

    #toMicroCents(cents: number): number {
        if (!Number.isFinite(cents) || cents <= 0) return 1;
        return Math.ceil(cents * 1_000_000);
    }

    #toSafeCount(value: unknown): number {
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
            return 0;
        return Math.floor(value);
    }

    #isGptImageModel(model: string) {
        // Covers gpt-image-1, gpt-image-1-mini, gpt-image-1.5, gpt-image-2 and future variants.
        return model.startsWith('gpt-image-');
    }

    // gpt-image-2 size rules: each edge in [16, 3840] and a multiple of 16,
    // long:short ratio <= 3:1, pixel count in [655360, 8294400]. Silently
    // clamps/snaps rather than throwing so arbitrary user input is accepted.
    // https://developers.openai.com/api/docs/guides/image-generation
    #normalizeGptImage2Ratio(ratio?: { w: number; h: number }) {
        const MIN_EDGE = 16;
        const MAX_EDGE = 3840;
        const STEP = 16;
        const MAX_RATIO = 3;
        const MIN_PIXELS = 655_360;
        const MAX_PIXELS = 8_294_400;

        let w = Number(ratio?.w);
        let h = Number(ratio?.h);
        if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
            return { w: 1024, h: 1024 };
        }

        // 1. Clamp long:short ratio to MAX_RATIO by shrinking the longer edge.
        if (w / h > MAX_RATIO) w = h * MAX_RATIO;
        else if (h / w > MAX_RATIO) h = w * MAX_RATIO;

        // 2. Cap each edge at MAX_EDGE, preserving aspect ratio.
        if (w > MAX_EDGE) {
            const s = MAX_EDGE / w;
            w = MAX_EDGE;
            h *= s;
        }
        if (h > MAX_EDGE) {
            const s = MAX_EDGE / h;
            h = MAX_EDGE;
            w *= s;
        }

        // 3. Scale uniformly into the pixel budget.
        const prescaledPixels = w * h;
        if (prescaledPixels < MIN_PIXELS) {
            const s = Math.sqrt(MIN_PIXELS / prescaledPixels);
            w *= s;
            h *= s;
        } else if (prescaledPixels > MAX_PIXELS) {
            const s = Math.sqrt(MAX_PIXELS / prescaledPixels);
            w *= s;
            h *= s;
        }

        // 4. Snap to STEP. Bias rounding direction so snap doesn't push pixels
        //    back out of the budget.
        const dir =
            prescaledPixels < MIN_PIXELS
                ? 1
                : prescaledPixels > MAX_PIXELS
                  ? -1
                  : 0;
        const snap = (v: number) => {
            const snapped =
                dir > 0
                    ? Math.ceil(v / STEP) * STEP
                    : dir < 0
                      ? Math.floor(v / STEP) * STEP
                      : Math.round(v / STEP) * STEP;
            return Math.max(MIN_EDGE, Math.min(MAX_EDGE, snapped));
        };
        w = snap(w);
        h = snap(h);

        // 5. If snap rounding pushed ratio above MAX_RATIO, trim the longer
        //    edge by one STEP. Pixel budget had headroom from step 3 so this
        //    won't drop below MIN_PIXELS.
        if (Math.max(w, h) / Math.min(w, h) > MAX_RATIO) {
            if (w >= h) w = Math.max(MIN_EDGE, w - STEP);
            else h = Math.max(MIN_EDGE, h - STEP);
        }
        return { w, h };
    }

    // extracted from calculator at https://developers.openai.com/api/docs/guides/image-generation#cost-and-latency
    #estimateGptImage2OutputTokens(
        width: number,
        height: number,
        quality?: string,
    ): number {
        const FACTORS: Record<string, number> = {
            low: 16,
            medium: 48,
            high: 96,
        };
        const factor = FACTORS[quality ?? ''] ?? FACTORS.medium;
        const longEdge = Math.max(width, height);
        const shortEdge = Math.min(width, height);
        const shortLatent = Math.round((factor * shortEdge) / longEdge);
        const latentW = width >= height ? factor : shortLatent;
        const latentH = width >= height ? shortLatent : factor;
        const baseArea = latentW * latentH;
        return Math.ceil((baseArea * (2_000_000 + width * height)) / 4_000_000);
    }

    #estimateOutputCostFromTokens(
        selectedModel: IImageModel,
        ratio: { w: number; h: number },
        quality?: string,
    ): number | undefined {
        if (!selectedModel.id.startsWith('gpt-image-2')) return undefined;
        const rate = this.#getCostRate(selectedModel, 'image_output');
        if (rate === undefined) return undefined;
        const tokens = this.#estimateGptImage2OutputTokens(
            ratio.w,
            ratio.h,
            quality,
        );
        return this.#costForTokens(tokens, rate);
    }

    #buildPriceKey(model: string, quality: string, size: string) {
        if (this.#isGptImageModel(model)) {
            // GPT image models use format: "quality:size" - default to low if not specified
            const qualityLevel = quality || 'low';
            return `${qualityLevel}:${size}`;
        }

        // DALL-E models use format: "hd:size" or just "size"
        return (quality === 'hd' ? 'hd:' : '') + size;
    }

    #buildApiParams(
        model: string,
        baseParams: Partial<ImageGenerateParamsNonStreaming>,
    ): ImageGenerateParamsNonStreaming {
        const apiParams = {
            user: baseParams.user,
            prompt: baseParams.prompt,
            size: baseParams.size,
        } as ImageGenerateParamsNonStreaming;

        if (this.#isGptImageModel(model)) {
            // GPT image models require the model parameter and use quality mapping
            apiParams.model = model;
            // Default to low quality if not specified, consistent with _buildPriceKey
            apiParams.quality = baseParams.quality || 'low';
        } else {
            // dall-e models
            apiParams.model = model;
            if (baseParams.quality === 'hd') {
                apiParams.quality = 'hd';
            }
        }

        return apiParams;
    }
}
