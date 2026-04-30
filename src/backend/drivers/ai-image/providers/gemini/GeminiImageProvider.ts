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

import { GenerateContentResponse, GoogleGenAI } from '@google/genai';
import { Context } from '../../../../core/context.js';
import type { MeteringService } from '../../../../services/metering/MeteringService.js';
import {
    GEMINI_DEFAULT_RATIO,
    GEMINI_ESTIMATED_IMAGE_TOKENS,
    GEMINI_IMAGE_GENERATION_MODELS,
    IGeminiImageModel,
} from './models.js';
import type {
    IGenerateParams,
    IImageModel,
    IImageProvider,
} from '../../types.js';

const MIME_SIGNATURES: Record<string, string> = {
    '/9j/': 'image/jpeg',
    iVBOR: 'image/png',
    UklGR: 'image/webp',
};

interface GeminiUsageMetadata {
    promptTokenCount: number;
    candidatesTokenCount: number;
    candidatesTextTokenCount: number;
    candidatesImageTokenCount: number;
    thoughtsTokenCount: number;
}

export class GeminiImageProvider implements IImageProvider {
    #meteringService: MeteringService;
    #client: GoogleGenAI;

    constructor(config: { apiKey: string }, meteringService: MeteringService) {
        if (!config.apiKey) {
            throw new Error('Gemini image generation requires an API key');
        }
        this.#meteringService = meteringService;
        this.#client = new GoogleGenAI({ apiKey: config.apiKey });
    }

    models(): IImageModel[] {
        return GEMINI_IMAGE_GENERATION_MODELS;
    }

    getDefaultModel(): string {
        return GEMINI_IMAGE_GENERATION_MODELS[0].id;
    }

    async generate(params: IGenerateParams): Promise<string> {
        const {
            prompt,
            test_mode,
            input_image,
            input_image_mime_type,
            model,
            quality,
        } = params;
        let { ratio, input_images } = params;

        const selectedModel =
            (this.models() as IGeminiImageModel[]).find(
                (m) => m.id === model,
            ) ||
            (this.models() as IGeminiImageModel[]).find(
                (m) => m.id === this.getDefaultModel(),
            )!;

        if (test_mode) {
            return 'https://puter-sample-data.puter.site/image_example.png';
        }

        if (typeof prompt !== 'string' || prompt.trim().length === 0) {
            throw new Error('`prompt` must be a non-empty string');
        }

        if (selectedModel.apiType === 'generateImages') {
            return this.#generateWithImagen(prompt, selectedModel, params);
        }

        const allowedRatios = selectedModel.allowedRatios ?? [
            GEMINI_DEFAULT_RATIO,
        ];
        ratio =
            ratio && this.#isValidRatio(ratio, allowedRatios)
                ? ratio
                : allowedRatios[0];

        // Backwards compat: merge singular input_image into input_images
        if (input_image && (!input_images || input_images.length === 0)) {
            input_images = [input_image];
        }

        // Validate input images have detectable MIME types
        if (input_images?.length) {
            for (const img of input_images) {
                const mime = this.#detectMimeType(img) ?? input_image_mime_type;
                if (!mime) {
                    throw new Error(
                        'Could not detect MIME type for an input image. Provide a known image format (JPEG, PNG, WebP) or set `input_image_mime_type`.',
                    );
                }
            }
        }

        const actor = Context.get('actor');

        // --- Pre-flight cost estimation ---
        const inputImageCount = input_images?.length ?? 0;
        const estimatedImageInputTokens = inputImageCount * 560; // https://ai.google.dev/gemini-api/docs/pricing#gemini-3-pro-image-preview
        const estimatedPromptTokenCount =
            this.#estimatePromptTokenCount(prompt) + estimatedImageInputTokens;
        const estimatedInputCostInCents = this.#calculateTokenCostInCents(
            estimatedPromptTokenCount,
            selectedModel.costs.input,
        );

        // Estimate output image tokens
        const imageTokenKey = quality
            ? `${selectedModel.id}:${quality}`
            : selectedModel.id;
        const estimatedOutputImageTokens =
            GEMINI_ESTIMATED_IMAGE_TOKENS[imageTokenKey] ??
            GEMINI_ESTIMATED_IMAGE_TOKENS[selectedModel.id];
        if (estimatedOutputImageTokens === undefined) {
            throw new Error(
                `No estimated image token count configured for '${imageTokenKey}'.`,
            );
        }
        const estimatedOutputImageCostInCents = this.#calculateTokenCostInCents(
            estimatedOutputImageTokens,
            selectedModel.costs.output_image,
        );
        const estimatedOutputTextCostInCents = this.#calculateTokenCostInCents(
            50,
            selectedModel.costs.output,
        ); // small text overhead estimate
        const estimatedOutputCostInCents =
            estimatedOutputImageCostInCents + estimatedOutputTextCostInCents;

        const estimatedTotalCostInMicroCents = this.#toMicroCents(
            estimatedInputCostInCents + estimatedOutputCostInCents,
        );
        const usageAllowed = await this.#meteringService.hasEnoughCredits(
            actor,
            estimatedTotalCostInMicroCents,
        );

        if (!usageAllowed) {
            throw new Error('Insufficient credits for image generation');
        }

        // --- API call ---
        const contents = this.#buildContents(
            prompt,
            input_images,
            input_image_mime_type,
        );
        const aspectRatio = `${ratio.w}:${ratio.h}`;

        const imageConfig: Record<string, string> = { aspectRatio };
        if (quality && selectedModel.allowedQualityLevels?.includes(quality)) {
            imageConfig.imageSize = quality;
        }

        const response = await this.#client.models.generateContent({
            model: selectedModel.id,
            contents,
            config: {
                responseModalities: ['TEXT', 'IMAGE'],
                imageConfig,
            },
        });

        // --- Actual cost calculation from response usage ---
        const usage = this.#extractUsageMetadata(response);
        const inputTokenCount =
            usage.promptTokenCount || estimatedPromptTokenCount;

        const outputTextTokenCount =
            usage.candidatesTextTokenCount + usage.thoughtsTokenCount;
        const outputImageTokenCount =
            usage.candidatesImageTokenCount || estimatedOutputImageTokens;

        const inputCostInCents = this.#calculateTokenCostInCents(
            inputTokenCount,
            selectedModel.costs.input,
        );
        const outputTextCostInCents = this.#calculateTokenCostInCents(
            outputTextTokenCount,
            selectedModel.costs.output,
        );
        const outputImageCostInCents = this.#calculateTokenCostInCents(
            outputImageTokenCount,
            selectedModel.costs.output_image,
        );

        const usagePrefix = `gemini:${selectedModel.id}`;
        this.#meteringService.batchIncrementUsages(actor, [
            {
                usageType: `${usagePrefix}:input`,
                usageAmount: Math.max(inputTokenCount, 1),
                costOverride: this.#toMicroCents(inputCostInCents),
            },
            {
                usageType: `${usagePrefix}:output:text`,
                usageAmount: Math.max(outputTextTokenCount, 1),
                costOverride: this.#toMicroCents(outputTextCostInCents),
            },
            {
                usageType: `${usagePrefix}:output:image`,
                usageAmount: Math.max(outputImageTokenCount, 1),
                costOverride: this.#toMicroCents(outputImageCostInCents),
            },
        ]);

        const url = this.#extractImageUrl(response);

        if (!url) {
            throw new Error('Failed to extract image URL from Gemini response');
        }

        return url;
    }

    async #generateWithImagen(
        prompt: string,
        selectedModel: IGeminiImageModel,
        params: IGenerateParams,
    ): Promise<string> {
        const actor = Context.get('actor');
        if (!actor) {
            throw new Error('actor not found in context');
        }
        const costCents = selectedModel.costs?.['per-image'];
        if (costCents === undefined) {
            throw new Error(
                `No per-image cost configured for model '${selectedModel.id}'`,
            );
        }
        const costInMicroCents = Math.ceil(costCents * 1_000_000);

        const usageAllowed = await this.#meteringService.hasEnoughCredits(
            actor,
            costInMicroCents,
        );
        if (!usageAllowed) {
            throw new Error('Insufficient credits for image generation');
        }

        const allowedRatios = selectedModel.allowedRatios ?? [
            GEMINI_DEFAULT_RATIO,
        ];
        const ratio =
            params.ratio && this.#isValidRatio(params.ratio, allowedRatios)
                ? params.ratio
                : allowedRatios[0];
        const aspectRatio = `${ratio.w}:${ratio.h}`;

        const config: Record<string, unknown> = {
            numberOfImages: 1,
            aspectRatio,
        };

        if (
            params.quality &&
            selectedModel.allowedQualityLevels?.includes(params.quality)
        ) {
            config.imageSize = params.quality;
        }

        const response = await this.#client.models.generateImages({
            model: selectedModel.id,
            prompt,
            config,
        });

        const generated = response?.generatedImages;
        if (!generated || generated.length === 0) {
            throw new Error('Imagen response did not include an image');
        }

        const entry = generated[0];
        if (entry.raiFilteredReason) {
            throw new Error(`Image was filtered: ${entry.raiFilteredReason}`);
        }

        const image = entry.image;
        if (!image?.imageBytes) {
            throw new Error('Imagen response did not include image bytes');
        }

        const usageKey = `gemini:${selectedModel.id}`;
        await this.#meteringService.incrementUsage(
            actor,
            usageKey,
            1,
            costInMicroCents,
        );

        const mimeType = image.mimeType ?? 'image/png';
        return `data:${mimeType};base64,${image.imageBytes}`;
    }

    #buildContents(
        prompt: string,
        input_images?: string[],
        input_image_mime_type?: string,
    ) {
        const parts: Record<string, unknown>[] = [{ text: prompt }];

        if (input_images?.length) {
            for (const img of input_images) {
                const parsed = this.#parseDataUri(img);
                const mimeType =
                    parsed?.mimeType ??
                    this.#detectMimeType(img) ??
                    input_image_mime_type ??
                    'image/png';
                const rawBase64 = parsed?.base64 ?? img;
                parts.push({
                    inlineData: {
                        mimeType,
                        data: rawBase64,
                    },
                });
            }
        }

        return parts;
    }

    #extractUsageMetadata(
        response: GenerateContentResponse,
    ): GeminiUsageMetadata {
        const usage = (
            response as GenerateContentResponse & {
                usageMetadata?: Record<string, unknown>;
            }
        ).usageMetadata;

        let candidatesImageTokenCount = 0;

        const details = usage?.candidatesTokensDetails;
        if (Array.isArray(details)) {
            for (const entry of details) {
                if (entry?.modality === 'IMAGE') {
                    candidatesImageTokenCount += this.#toSafeCount(
                        entry.tokenCount,
                    );
                }
            }
        }

        // api only returns modality image, so calculate text tokens as candidates (output) - image tokens
        const candidatesTokenCount = this.#toSafeCount(
            usage?.candidatesTokenCount,
        );
        const candidatesTextTokenCount = Math.max(
            0,
            candidatesTokenCount - candidatesImageTokenCount,
        );

        return {
            promptTokenCount: this.#toSafeCount(usage?.promptTokenCount),
            candidatesTokenCount,
            candidatesTextTokenCount,
            candidatesImageTokenCount,
            thoughtsTokenCount: this.#toSafeCount(usage?.thoughtsTokenCount),
        };
    }

    #estimatePromptTokenCount(prompt: string): number {
        const text = prompt.trim();
        if (text.length === 0) return 0;

        // Same approximation used by chat billing flow.
        return Math.max(
            1,
            Math.floor(
                (text.length / 4 + text.split(/\s+/).length * (4 / 3)) / 2,
            ),
        );
    }

    #calculateTokenCostInCents(
        tokenCount: number,
        centsPerMillion?: number,
    ): number {
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

    #extractImageUrl(response: GenerateContentResponse): string | undefined {
        const parts = response?.candidates?.[0]?.content?.parts;
        if (!Array.isArray(parts)) {
            return undefined;
        }

        for (const part of parts) {
            if (part?.inlineData?.data) {
                const mimeType = part.inlineData.mimeType ?? 'image/png';
                return `data:${mimeType};base64,${part.inlineData.data}`;
            }
        }
        return undefined;
    }

    #detectMimeType(data: string): string | undefined {
        // Handle data URIs like "data:image/jpeg;base64,..."
        const parsed = this.#parseDataUri(data);
        if (parsed) {
            return parsed.mimeType;
        }

        for (const [signature, mimeType] of Object.entries(MIME_SIGNATURES)) {
            if (data.startsWith(signature)) {
                return mimeType;
            }
        }
        return undefined;
    }

    #parseDataUri(
        data: string,
    ): { mimeType: string; base64: string } | undefined {
        if (!data.startsWith('data:image/')) return undefined;

        const commaIdx = data.indexOf(',');
        if (commaIdx === -1) return undefined;

        const header = data.substring(5, commaIdx); // after "data:" up to ","
        if (!header.endsWith(';base64')) return undefined;

        const mimeType = header.substring(0, header.length - 7); // strip ";base64"
        if (mimeType.length === 0) return undefined;

        return { mimeType, base64: data.substring(commaIdx + 1) };
    }

    #isValidRatio(
        ratio: { w: number; h: number },
        allowedRatios: { w: number; h: number }[],
    ) {
        return allowedRatios.some((r) => r.w === ratio.w && r.h === ratio.h);
    }
}
