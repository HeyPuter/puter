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

import { closestAspectRatio } from '../../../interfaces/image/imageDimensions.js';
import { assertImagePrompt } from '../../../interfaces/image/imageValidation.js';
import { GenerateContentResponse, GoogleGenAI } from '@google/genai';
import { Context } from '../../../../../core/context.js';
import {
    type AiMeteringService,
    withAiCreditHold,
} from '../../../../../util/aiCostFactor.js';
import {
    GEMINI_DEFAULT_RATIO,
    GEMINI_ESTIMATED_IMAGE_TOKENS,
    GEMINI_ESTIMATED_TEXT_OUTPUT_TOKENS,
    GEMINI_IMAGE_GENERATION_MODELS,
} from './models.js';
import type {
    IGenerateParams,
    IImageModel,
    IImageProvider,
} from '../../../interfaces/image/types.js';
import {
    isHttpUrl,
    parseDataUri,
    toBase64DataUri,
} from '../../../interfaces/image/inputImage.js';
import {
    estimateImagePromptTokens,
    reportedTokenCount,
} from '../../../interfaces/image/imageTokens.js';
import { HttpError } from '@heyputer/backend/src/core/http/HttpError.js';
import {
    isTransientUpstreamError,
    malformedUpstreamResponse,
    UpstreamDeadlineError,
} from '../../../../util/upstreamErrors.js';
import { SAMPLE_IMAGE_URL } from '../../../shared/testMode.js';

/** One generation, reply included. */
export const GEMINI_IMAGE_TIMEOUT_MS = 5 * 60 * 1000;

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
    #meteringService: AiMeteringService;
    #client: GoogleGenAI;

    constructor(
        config: { apiKey: string },
        meteringService: AiMeteringService,
    ) {
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
        const { prompt, test_mode, input_image, input_image_mime_type, model } =
            params;
        let { ratio, input_images, quality } = params;

        const selectedModel =
            this.models().find(
                (m) => m.id === model || m.aliases?.includes(model ?? ''),
            ) || this.models().find((m) => m.id === this.getDefaultModel())!;

        if (test_mode) {
            return SAMPLE_IMAGE_URL;
        }

        assertImagePrompt(prompt);

        const allowedRatios = selectedModel.allowedRatios ?? [
            GEMINI_DEFAULT_RATIO,
        ];
        ratio = ratio
            ? closestAspectRatio(ratio, allowedRatios)
            : allowedRatios[0];

        // Backwards compat: merge singular input_image into input_images
        if (input_image && (!input_images || input_images.length === 0)) {
            input_images = [input_image];
        }

        // Resolve any http(s) URL inputs to base64 data-URIs server-side
        // (SSRF-guarded) so the rest of the flow only deals with inline data.
        if (input_images?.length) {
            input_images = await Promise.all(
                input_images.map((img) =>
                    isHttpUrl(img)
                        ? toBase64DataUri(img, input_image_mime_type)
                        : img,
                ),
            );
        }

        // Validate input images have detectable MIME types
        if (input_images?.length) {
            for (const img of input_images) {
                const mime = this.#detectMimeType(img) ?? input_image_mime_type;
                if (!mime) {
                    throw new HttpError(
                        400,
                        'Could not detect MIME type for an input image. Provide a known image format (JPEG, PNG, WebP) or set `input_image_mime_type`.',
                        { legacyCode: 'bad_request' },
                    );
                }
            }
        }

        const actor = Context.get('actor');
        if (!actor) {
            throw new HttpError(401, 'actor not found in context', {
                legacyCode: 'unauthorized',
            });
        }

        // --- Pre-flight cost estimation ---
        const inputImageCount = input_images?.length ?? 0;
        const estimatedImageInputTokens = inputImageCount * 560; // https://ai.google.dev/gemini-api/docs/pricing#gemini-3-pro-image-preview
        const estimatedPromptTokenCount =
            estimateImagePromptTokens(prompt) + estimatedImageInputTokens;
        const estimatedInputCostInCents = this.#calculateTokenCostInCents(
            estimatedPromptTokenCount,
            selectedModel.costs.input,
        );

        // Tiered models resolve `quality` case-insensitively against their
        // catalog levels, as Together and xAI do; a tier the model lacks is
        // the caller's mistake, not a missing token-table entry.
        const tiers = (selectedModel.allowedQualityLevels ?? []).filter(
            Boolean,
        );
        if (quality) {
            const wanted = quality.trim().toLowerCase();
            const requestedTier = tiers.find(
                (tier) => tier.toLowerCase() === wanted,
            );
            if (tiers.length && !requestedTier) {
                throw new HttpError(
                    400,
                    `Unsupported quality tier: ${quality}. Expected ${tiers.join(', ')}`,
                    { legacyCode: 'bad_request' },
                );
            }
            quality = requestedTier ?? '';
        } else {
            quality = tiers[0] ?? '';
        }
        params.quality = quality;

        // Estimate output image tokens
        const imageTokenKey = quality
            ? `${selectedModel.id}:${quality}`
            : selectedModel.id;
        const estimatedOutputImageTokens =
            GEMINI_ESTIMATED_IMAGE_TOKENS[imageTokenKey] ??
            GEMINI_ESTIMATED_IMAGE_TOKENS[selectedModel.id];
        if (estimatedOutputImageTokens === undefined) {
            throw new HttpError(
                400,
                `No estimated image token count configured for '${imageTokenKey}'.`,
                { legacyCode: 'bad_request' },
            );
        }
        const estimatedOutputImageCostInCents = this.#calculateTokenCostInCents(
            estimatedOutputImageTokens,
            selectedModel.costs.output_image,
        );
        const estimatedOutputTextCostInCents = this.#calculateTokenCostInCents(
            GEMINI_ESTIMATED_TEXT_OUTPUT_TOKENS[selectedModel.id] ?? 50,
            selectedModel.costs.output,
        );
        const estimatedOutputCostInCents =
            estimatedOutputImageCostInCents + estimatedOutputTextCostInCents;

        const estimatedTotalCostInMicroCents = this.#toMicroCents(
            estimatedInputCostInCents + estimatedOutputCostInCents,
        );
        const usagePrefix = `gemini:${selectedModel.id}`;
        return withAiCreditHold(
            this.#meteringService,
            actor,
            usagePrefix,
            estimatedTotalCostInMicroCents,
            async () => {
                // --- API call ---
                const contents = this.#buildContents(
                    prompt,
                    input_images,
                    input_image_mime_type,
                );
                const aspectRatio = `${ratio.w}:${ratio.h}`;

                const imageConfig: Record<string, string> = { aspectRatio };
                if (
                    quality &&
                    selectedModel.allowedQualityLevels?.includes(quality)
                ) {
                    imageConfig.imageSize = quality;
                }

                // The SDK aborts without a reason, so the deadline is told
                // apart from other aborts here.
                const deadline = AbortSignal.timeout(GEMINI_IMAGE_TIMEOUT_MS);
                let response: GenerateContentResponse;
                try {
                    response = await this.#client.models.generateContent({
                        model: selectedModel.id,
                        contents,
                        config: {
                            responseModalities: ['TEXT', 'IMAGE'],
                            imageConfig,
                            abortSignal: deadline,
                        },
                    });
                } catch (error) {
                    if (deadline.aborted) {
                        throw new UpstreamDeadlineError(
                            'Gemini request timed out',
                            { cause: error },
                        );
                    }
                    // What the SDK throws on a 2xx body that isn't the JSON
                    // object it expects; a dropped connection has a cause.
                    if (
                        (error instanceof SyntaxError ||
                            error instanceof TypeError) &&
                        !isTransientUpstreamError(error)
                    ) {
                        throw malformedUpstreamResponse('gemini', 'Gemini');
                    }
                    throw error;
                }

                // --- Actual cost calculation from response usage ---
                const usage = this.#extractUsageMetadata(response);
                const inputTokenCount =
                    usage.promptTokenCount || estimatedPromptTokenCount;

                const outputTextTokenCount =
                    usage.candidatesTextTokenCount + usage.thoughtsTokenCount;
                const outputImageTokenCount =
                    usage.candidatesImageTokenCount ||
                    estimatedOutputImageTokens;

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
                        costOverride: this.#toMicroCents(
                            outputImageCostInCents,
                        ),
                    },
                ]);

                const url = this.#extractImageUrl(response);

                if (!url) {
                    throw new HttpError(
                        400,
                        'Failed to extract image URL from Gemini response',
                        { legacyCode: 'unknown_error' },
                    );
                }

                return url;
            },
        );
    }

    #buildContents(
        prompt: string,
        input_images?: string[],
        input_image_mime_type?: string,
    ) {
        const parts: Record<string, unknown>[] = [{ text: prompt }];

        if (input_images?.length) {
            for (const img of input_images) {
                const parsed = parseDataUri(img);
                const mimeType =
                    parsed?.mime ??
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
                    candidatesImageTokenCount += reportedTokenCount(
                        entry.tokenCount,
                    );
                }
            }
        }

        // api only returns modality image, so calculate text tokens as candidates (output) - image tokens
        const candidatesTokenCount = reportedTokenCount(
            usage?.candidatesTokenCount,
        );
        const candidatesTextTokenCount = Math.max(
            0,
            candidatesTokenCount - candidatesImageTokenCount,
        );

        return {
            promptTokenCount: reportedTokenCount(usage?.promptTokenCount),
            candidatesTokenCount,
            candidatesTextTokenCount,
            candidatesImageTokenCount,
            thoughtsTokenCount: reportedTokenCount(usage?.thoughtsTokenCount),
        };
    }

    #calculateTokenCostInCents(
        tokenCount: number,
        centsPerMillion?: number,
    ): number {
        if (!Number.isFinite(tokenCount) || tokenCount <= 0) return 0;
        if (!Number.isFinite(centsPerMillion) || (centsPerMillion ?? 0) <= 0)
            return 0;

        return (tokenCount * (centsPerMillion as number)) / 1_000_000;
    }

    #toMicroCents(cents: number): number {
        if (!Number.isFinite(cents) || cents <= 0) return 1;
        return Math.ceil(cents * 1_000_000);
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
        const parsed = parseDataUri(data);
        if (parsed) {
            return parsed.mime;
        }

        for (const [signature, mimeType] of Object.entries(MIME_SIGNATURES)) {
            if (data.startsWith(signature)) {
                return mimeType;
            }
        }
        return undefined;
    }
}
