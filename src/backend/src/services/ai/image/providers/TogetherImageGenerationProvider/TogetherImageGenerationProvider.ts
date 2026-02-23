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

import { Together } from 'together-ai';
import APIError from '../../../../../api/APIError.js';
import { ErrorService } from '../../../../../modules/core/ErrorService.js';
import { Context } from '../../../../../util/context.js';
import { EventService } from '../../../../EventService.js';
import { MeteringService } from '../../../../MeteringService/MeteringService.js';
import { IGenerateParams, IImageModel, IImageProvider } from '../types.js';
import { TOGETHER_IMAGE_GENERATION_MODELS, GEMINI_3_IMAGE_RESOLUTION_MAP } from './models.js';

const TOGETHER_DEFAULT_RATIO = { w: 1024, h: 1024 };
type TogetherGenerateParams = IGenerateParams & {
    steps?: number;
    seed?: number;
    negative_prompt?: string;
    n?: number;
    image_url?: string;
    image_base64?: string;
    mask_image_url?: string;
    mask_image_base64?: string;
    prompt_strength?: number;
    disable_safety_checker?: boolean;
    response_format?: string;
    input_image?: string;
};

const DEFAULT_MODEL = 'togetherai:black-forest-labs/FLUX.1-schnell';
const CONDITION_IMAGE_MODELS = [
    'togetherai:black-forest-labs/flux.1-kontext-dev',
    'togetherai:black-forest-labs/flux.1-kontext-pro',
    'togetherai:black-forest-labs/flux.1-kontext-max',
];

export class TogetherImageGenerationProvider implements IImageProvider {
    #client: Together;
    #meteringService: MeteringService;
    #errors: ErrorService;
    #eventService: EventService;

    constructor (config: { apiKey: string }, meteringService: MeteringService, errorService: ErrorService, eventService: EventService) {
        if ( ! config.apiKey ) {
            throw new Error('Together AI image generation requires an API key');
        }
        this.#meteringService = meteringService;
        this.#errors = errorService;
        this.#eventService = eventService;
        this.#client = new Together({ apiKey: config.apiKey });
    }

    models (): IImageModel[] {
        return TOGETHER_IMAGE_GENERATION_MODELS;
    }

    getDefaultModel (): string {
        return DEFAULT_MODEL;
    }

    async generate (params: IGenerateParams): Promise<string> {
        const { prompt, test_mode } = params;
        let { model, ratio, quality } = params;
        const options = params as TogetherGenerateParams;

        const selectedModel = this.#getModel(model);

        await this.#eventService.emit('ai.log.image', { actor: Context.get('actor'), parameters: params, completionId: '0', intended_service: selectedModel.id });

        if ( test_mode ) {
            return 'https://puter-sample-data.puter.site/image_example.png';
        }

        if ( typeof prompt !== 'string' || prompt.trim().length === 0 ) {
            throw new Error('`prompt` must be a non-empty string');
        }

        ratio = ratio || TOGETHER_DEFAULT_RATIO;

        const actor = Context.get('actor');
        if ( ! actor ) {
            this.#errors.report('together-image-generation:unknown-actor', {
                message: 'failed to resolve actor for Together image generation',
                trace: true,
            });
            throw new Error('actor not found in context');
        }

        const isGemini3 = selectedModel.id === 'togetherai:google/gemini-3-pro-image';

        let costInMicroCents: number;
        let usageAmount: number;
        const qualityCostKey = isGemini3 && quality && selectedModel.costs[quality] !== undefined ? quality : undefined;

        if ( qualityCostKey ) {
            const centsPerImage = selectedModel.costs[qualityCostKey];
            costInMicroCents = centsPerImage * 1_000_000;
            usageAmount = 1;
        } else {
            const priceKey = '1MP';
            const centsPerMP = selectedModel.costs[priceKey];
            if ( centsPerMP === undefined ) {
                throw new Error(`No pricing configured for model ${selectedModel.id}`);
            }
            const MP = (ratio.h * ratio.w) / 1_000_000;
            costInMicroCents = centsPerMP * MP * 1_000_000;
            usageAmount = MP;
        }

        const usageType = `${selectedModel.id}:${quality || '1MP'}`;

        const usageAllowed = await this.#meteringService.hasEnoughCredits(actor, costInMicroCents);

        if ( ! usageAllowed ) {
            throw APIError.create('insufficient_funds');
        }

        // Resolve abstract aspect ratios to actual pixel dimensions for Gemini 3 Pro
        let resolvedRatio = ratio;
        if ( isGemini3 && quality ) {
            const ratioKey = `${ratio.w}:${ratio.h}`;
            const resolutionEntry = GEMINI_3_IMAGE_RESOLUTION_MAP[ratioKey]?.[quality];
            if ( resolutionEntry ) {
                resolvedRatio = resolutionEntry;
            }
        }

        const request = this.#buildRequest(prompt, { ...options, ratio: resolvedRatio, model: selectedModel.id.replace('togetherai:', '') }) as unknown as Together.Images.ImageGenerateParams;

        try {
            const response = await this.#client.images.generate(request);
            if ( ! response?.data?.length ) {
                throw new Error('Together AI response did not include image data');
            }

            this.#meteringService.incrementUsage(actor, usageType, usageAmount, costInMicroCents);

            const first = response.data[0] as { url?: string; b64_json?: string };
            const url = first.url || (first.b64_json ? `data:image/png;base64,${ first.b64_json}` : undefined);

            if ( ! url ) {
                throw new Error('Together AI response did not include an image URL');
            }

            return url;
        } catch ( error ) {
            throw new Error(`Together AI image generation error: ${(error as Error).message}`);
        }
    }

    #getModel (model?: string) {
        return this.models().find(m => m.id === model) || this.models().find(m => m.id === DEFAULT_MODEL)!;
    }

    #buildRequest (prompt: string, options: TogetherGenerateParams) {
        const {
            ratio,
            model,
            steps,
            seed,
            negative_prompt,
            n,
            image_url,
            image_base64,
            mask_image_url,
            mask_image_base64,
            prompt_strength,
            disable_safety_checker,
            response_format,
            input_image,
        } = options;

        const request: Record<string, unknown> = {
            prompt,
            model: model ?? DEFAULT_MODEL,
        };

        const requiresConditionImage = this.#modelRequiresConditionImage(request.model as string);

        const ratioWidth = ratio?.w !== undefined ? Number(ratio.w) : undefined;
        const ratioHeight = ratio?.h !== undefined ? Number(ratio.h) : undefined;

        const normalizedWidth = this.#normalizeDimension((ratioWidth ?? TOGETHER_DEFAULT_RATIO.w));
        const normalizedHeight = this.#normalizeDimension((ratioHeight ?? TOGETHER_DEFAULT_RATIO.h));

        if ( normalizedWidth ) request.width = normalizedWidth;
        if ( normalizedHeight ) request.height = normalizedHeight;

        if ( typeof steps === 'number' && Number.isFinite(steps) ) {
            request.steps = Math.max(1, Math.min(50, Math.round(steps)));
        }
        if ( typeof seed === 'number' && Number.isFinite(seed) ) request.seed = Math.round(seed);
        if ( typeof negative_prompt === 'string' ) request.negative_prompt = negative_prompt;
        if ( typeof n === 'number' && Number.isFinite(n) ) {
            request.n = Math.max(1, Math.min(4, Math.round(n)));
        }
        if ( disable_safety_checker ) {
            request.disable_safety_checker = true;
        }
        if ( typeof response_format === 'string' ) request.response_format = response_format;

        const resolvedImageBase64 = typeof image_base64 === 'string'
            ? image_base64
            : (typeof input_image === 'string' ? input_image : undefined);

        if ( typeof image_url === 'string' ) request.image_url = image_url;
        if ( resolvedImageBase64 ) request.image_base64 = resolvedImageBase64;
        if ( typeof mask_image_url === 'string' ) request.mask_image_url = mask_image_url;
        if ( typeof mask_image_base64 === 'string' ) request.mask_image_base64 = mask_image_base64;
        if ( typeof prompt_strength === 'number' && Number.isFinite(prompt_strength) ) {
            request.prompt_strength = Math.max(0, Math.min(1, prompt_strength));
        }
        if ( requiresConditionImage ) {
            const conditionSource = resolvedImageBase64
                ? resolvedImageBase64
                : (typeof image_url === 'string' ? image_url : undefined);

            if ( ! conditionSource ) {
                throw new Error(`Model ${request.model} requires an image_url or image_base64 input`);
            }

            request.condition_image = conditionSource;
        }

        return request;
    }

    #normalizeDimension (value?: number) {
        if ( typeof value !== 'number' || Number.isNaN(value) ) return undefined;
        const rounded = Math.max(64, Math.round(value));
        // Flux models expect multiples of 8. Snap to the nearest multiple without going below 64.
        return Math.max(64, Math.round(rounded / 8) * 8);
    }

    #modelRequiresConditionImage (modelId?: string) {
        if ( typeof modelId !== 'string' || modelId.trim() === '' ) {
            return false;
        }

        const normalized = modelId.toLowerCase();
        return CONDITION_IMAGE_MODELS.some(required => normalized === required);
    }
}
