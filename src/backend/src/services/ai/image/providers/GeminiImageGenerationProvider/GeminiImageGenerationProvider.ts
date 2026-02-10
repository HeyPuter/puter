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
import APIError from '../../../../../api/APIError.js';
import { ErrorService } from '../../../../../modules/core/ErrorService.js';
import { Context } from '../../../../../util/context.js';
import { MeteringService } from '../../../../MeteringService/MeteringService.js';
import { GEMINI_DEFAULT_RATIO, GEMINI_IMAGE_GENERATION_MODELS } from './models.js';
import { IGenerateParams, IImageModel, IImageProvider } from '../types.js';

type GeminiGenerateParams = IGenerateParams & {
    input_image?: string;
    input_image_mime_type?: string;
};

interface GeminiUsageMetadata {
    promptTokenCount: number;
    candidatesTokenCount: number;
    thoughtsTokenCount: number;
}

export class GeminiImageGenerationProvider implements IImageProvider {
    #meteringService: MeteringService;
    #client: GoogleGenAI;
    #errors: ErrorService;

    constructor (config: { apiKey: string }, meteringService: MeteringService, errorService: ErrorService) {
        if ( ! config.apiKey ) {
            throw new Error('Gemini image generation requires an API key');
        }
        this.#meteringService = meteringService;
        this.#client = new GoogleGenAI({ apiKey: config.apiKey });
        this.#errors = errorService;
    }

    models (): IImageModel[] {
        return GEMINI_IMAGE_GENERATION_MODELS;
    }

    getDefaultModel (): string {
        return GEMINI_IMAGE_GENERATION_MODELS[0].id;
    }

    async generate (params: IGenerateParams): Promise<string> {
        const { prompt, test_mode } = params;
        let { model, ratio, quality } = params;
        const { input_image, input_image_mime_type } = params as GeminiGenerateParams;

        const selectedModel = this.models().find(m => m.id === model) || this.models().find(m => m.id === this.getDefaultModel())!;

        if ( test_mode ) {
            return 'https://puter-sample-data.puter.site/image_example.png';
        }

        if ( typeof prompt !== 'string' || prompt.trim().length === 0 ) {
            throw new Error('`prompt` must be a non-empty string');
        }

        const allowedRatios = selectedModel.allowedRatios ?? [GEMINI_DEFAULT_RATIO];
        ratio = ratio && this.#isValidRatio(ratio, allowedRatios) ? ratio : allowedRatios[0];

        if ( input_image && !input_image_mime_type ) {
            throw new Error('`input_image_mime_type` is required when `input_image` is provided');
        }

        if ( input_image_mime_type && !input_image ) {
            throw new Error('`input_image` is required when `input_image_mime_type` is provided');
        }

        if ( input_image_mime_type && !this.#isValidImageMimeType(input_image_mime_type) ) {
            throw new Error('`input_image_mime_type` must be a valid image MIME type (image/png, image/jpeg, image/webp)');
        }

        const priceKey = `${quality ? `${quality}:` : ''}${ratio.w}x${ratio.h}`;
        const priceInCents = selectedModel.costs[priceKey];
        if ( priceInCents === undefined ) {
            const availableSizes = Object.keys(selectedModel.costs)
                .filter(key => key !== 'input' && key !== 'output');
            throw APIError.create('field_invalid', undefined, {
                key: 'size/quality combination',
                expected: `one of: ${ availableSizes.join(', ')}`,
                got: priceKey,
            });
        }

        const actor = Context.get('actor');
        const user_private_uid = actor?.private_uid ?? 'UNKNOWN';
        if ( user_private_uid === 'UNKNOWN' ) {
            this.#errors.report('gemini-image-generation:unknown-user', {
                message: 'failed to get a user ID for a Gemini request',
                alarm: true,
                trace: true,
            });
        }

        const estimatedPromptTokenCount = this.#estimatePromptTokenCount(prompt);
        const estimatedInputCostInCents = this.#calculateTokenCostInCents(estimatedPromptTokenCount, selectedModel.costs.input);
        const estimatedOutputCostInCents = priceInCents;
        const estimatedTotalCostInMicroCents = this.#toMicroCents(estimatedInputCostInCents + estimatedOutputCostInCents);
        const usageAllowed = await this.#meteringService.hasEnoughCredits(actor, estimatedTotalCostInMicroCents);

        if ( ! usageAllowed ) {
            throw APIError.create('insufficient_funds');
        }

        const contents = this.#buildContents(prompt, ratio, input_image, input_image_mime_type);
        const response = await this.#client.models.generateContent({
            model: selectedModel.id,
            contents,
        });

        const usage = this.#extractUsageMetadata(response);
        const inputTokenCount = usage.promptTokenCount || estimatedPromptTokenCount;
        const outputTokenCount = usage.candidatesTokenCount + usage.thoughtsTokenCount;

        const inputCostInCents = this.#calculateTokenCostInCents(inputTokenCount, selectedModel.costs.input);
        const outputTextCostInCents = this.#calculateTokenCostInCents(outputTokenCount, selectedModel.costs.output);
        const outputCostInCents = priceInCents + outputTextCostInCents;

        const usagePrefix = `gemini:${selectedModel.id}:${priceKey}`;
        this.#meteringService.batchIncrementUsages(actor, [
            {
                usageType: `${usagePrefix}:input`,
                usageAmount: Math.max(inputTokenCount, 1),
                costOverride: this.#toMicroCents(inputCostInCents),
            },
            {
                usageType: `${usagePrefix}:output`,
                usageAmount: Math.max(outputTokenCount, 1),
                costOverride: this.#toMicroCents(outputCostInCents),
            },
        ]);

        this.#setResponseCostMetadata({
            model: selectedModel.id,
            quality,
            ratio,
            inputCostInCents,
            outputCostInCents,
            inputTokenCount,
            outputTokenCount,
        });

        const url = this.#extractImageUrl(response);

        if ( ! url ) {
            throw new Error('Failed to extract image URL from Gemini response');
        }

        return url;
    }

    #buildContents (prompt: string, ratio: { w: number; h: number }, input_image?: string, input_image_mime_type?: string) {
        if ( input_image && input_image_mime_type ) {
            return [
                { text: `Generate a picture of dimensions ${parseInt(`${ratio.w}`)}x${parseInt(`${ratio.h}`)} with the prompt: ${prompt}` },
                {
                    inlineData: {
                        mimeType: input_image_mime_type,
                        data: input_image,
                    },
                },
            ];
        }

        return `Generate a picture of dimensions ${parseInt(`${ratio.w}`)}x${parseInt(`${ratio.h}`)} with the prompt: ${prompt}`;
    }

    #setResponseCostMetadata ({
        model,
        quality,
        ratio,
        inputCostInCents,
        outputCostInCents,
        inputTokenCount,
        outputTokenCount,
    }: {
        model: string;
        quality?: string;
        ratio: { w: number; h: number };
        inputCostInCents: number;
        outputCostInCents: number;
        inputTokenCount: number;
        outputTokenCount: number;
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
            provider: 'gemini-image-generation',
            model,
            quality,
            ratio: `${ratio.w}x${ratio.h}`,
            input_tokens: inputTokenCount,
            output_tokens: outputTokenCount,
            input_microcents: this.#toMicroCents(inputCostInCents),
            output_microcents: this.#toMicroCents(outputCostInCents),
            total_microcents: this.#toMicroCents(totalCostInCents),
        };
    }

    #extractUsageMetadata (response: GenerateContentResponse): GeminiUsageMetadata {
        const usage = (response as GenerateContentResponse & { usageMetadata?: Record<string, unknown> }).usageMetadata;
        return {
            promptTokenCount: this.#toSafeCount(usage?.promptTokenCount),
            candidatesTokenCount: this.#toSafeCount(usage?.candidatesTokenCount),
            thoughtsTokenCount: this.#toSafeCount(usage?.thoughtsTokenCount),
        };
    }

    #estimatePromptTokenCount (prompt: string): number {
        const text = prompt.trim();
        if ( text.length === 0 ) return 0;

        // Same approximation used by chat billing flow.
        return Math.max(1, Math.floor(((text.length / 4) + (text.split(/\s+/).length * (4 / 3))) / 2));
    }

    #calculateTokenCostInCents (tokenCount: number, centsPerMillion?: number): number {
        if ( !Number.isFinite(tokenCount) || tokenCount <= 0 ) return 0;
        if ( !Number.isFinite(centsPerMillion) || (centsPerMillion ?? 0) <= 0 ) return 0;

        return (tokenCount / 1_000_000) * (centsPerMillion as number);
    }

    #toMicroCents (cents: number): number {
        if ( !Number.isFinite(cents) || cents <= 0 ) return 0;
        return Math.ceil(cents * 1_000_000);
    }

    #toSafeCount (value: unknown): number {
        if ( typeof value !== 'number' || !Number.isFinite(value) || value < 0 ) return 0;
        return Math.floor(value);
    }

    #extractImageUrl (response: GenerateContentResponse): string | undefined {
        const parts = response?.candidates?.[0]?.content?.parts;
        if ( ! Array.isArray(parts) ) {
            return undefined;
        }

        for ( const part of parts ) {
            if ( part?.inlineData?.data ) {
                return `data:image/png;base64,${ part.inlineData.data}`;
            }
        }
        return undefined;
    }

    #isValidRatio (ratio: { w: number; h: number }, allowedRatios: { w: number; h: number }[]) {
        return allowedRatios.some(r => r.w === ratio.w && r.h === ratio.h);
    }

    #isValidImageMimeType (mimeType?: string) {
        if ( ! mimeType ) return false;
        const supportedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
        return supportedTypes.includes(mimeType.toLowerCase());
    }
}
