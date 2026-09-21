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

import { assertImagePrompt } from '../../imageValidation.js';
import {
    closestAspectRatio,
    expandAspectRatio,
} from '../../imageDimensions.js';
import { imageDataUri } from '../../imageOutput.js';
import { Together } from 'together-ai';
import { Context } from '../../../../core/context.js';
import type { MeteringService } from '../../../../services/metering/MeteringService.js';
import type { IGenerateParams, IImageProvider } from '../../types.js';
import {
    TOGETHER_IMAGE_GENERATION_MODELS,
    RETIRED_TOGETHER_IMAGE_MODELS,
    type TogetherImageModel,
} from './models.js';
import {
    isHttpUrl,
    parseDataUri,
    resolveSingleInputImage,
    toUrlOrDataUri,
} from '../../inputImage.js';
import { HttpError } from '@heyputer/backend/src/core/http/HttpError.js';

const TOGETHER_DEFAULT_RATIO = { w: 1024, h: 1024 };
type TogetherGenerateParams = IGenerateParams & {
    steps?: number;
    seed?: number;
    negative_prompt?: string;
    image_url?: string;
    image_base64?: string;
    mask_image_url?: string;
    mask_image_base64?: string;
    prompt_strength?: number;
    disable_safety_checker?: boolean;
    response_format?: string;
    input_image?: string;
};

const DEFAULT_MODEL = 'togetherai:black-forest-labs/FLUX.2-dev';

export class TogetherImageProvider implements IImageProvider {
    readonly retiredModelAliases = RETIRED_TOGETHER_IMAGE_MODELS.flatMap(
        (id) => [id, `togetherai:${id}`, id.split('/').at(-1)!],
    );

    #client: Together;
    #meteringService: MeteringService;

    constructor(config: { apiKey: string }, meteringService: MeteringService) {
        if (!config.apiKey) {
            throw new Error('Together AI image generation requires an API key');
        }
        this.#meteringService = meteringService;
        this.#client = new Together({ apiKey: config.apiKey });
    }

    models(): TogetherImageModel[] {
        return TOGETHER_IMAGE_GENERATION_MODELS;
    }

    getDefaultModel(): string {
        return DEFAULT_MODEL;
    }

    async generate(params: IGenerateParams): Promise<string> {
        const { prompt, test_mode } = params;
        const { model, quality } = params;
        const options = { ...params } as TogetherGenerateParams;

        const selectedModel = this.#getModel(model);

        if (test_mode) {
            return 'https://puter-sample-data.puter.site/image_example.png';
        }

        assertImagePrompt(prompt);

        const singleInput = resolveSingleInputImage(params, 'Together AI');
        if (singleInput) {
            if (isHttpUrl(singleInput)) options.image_url ??= singleInput;
            else options.image_base64 ??= singleInput;
        }
        if (
            selectedModel.requiresInputImage &&
            !options.image_url &&
            !options.image_base64
        ) {
            throw new HttpError(
                400,
                `${selectedModel.id} requires an input image`,
                { legacyCode: 'bad_request' },
            );
        }
        if (quality != null && typeof quality !== 'string') {
            throw new HttpError(400, 'quality must be a string', {
                legacyCode: 'bad_request',
            });
        }
        // The driver resolves every caller-facing size field into `imageSize`.
        const { imageSize } = params;
        const defaultRatio =
            selectedModel.defaultRatio ?? TOGETHER_DEFAULT_RATIO;
        let ratio = imageSize ?? defaultRatio;
        const pricingUnit = selectedModel.pricing_unit ?? 'per-MP';
        const tiers = Object.keys(selectedModel.costs).filter(
            (key) => key !== 'input_image',
        );
        // Blank quality is "not set", as it is everywhere else in the driver.
        const wantedTier = quality?.trim().toLowerCase() || undefined;
        const requestedTier = tiers.find(
            (tier) => tier.toLowerCase() === wantedTier,
        );
        // Without `quality`, use the tier the catalog prices by (Google's
        // native 1K default), not whichever tier happens to be listed first.
        const defaultTier =
            selectedModel.index_cost_key &&
            tiers.includes(selectedModel.index_cost_key)
                ? selectedModel.index_cost_key
                : tiers[0];
        let tierKey = requestedTier ?? defaultTier;
        if (pricingUnit === 'per-tier' && wantedTier && !requestedTier) {
            throw new HttpError(
                400,
                `Unsupported quality tier: ${quality}. Expected ${tiers.join(', ')}`,
                { legacyCode: 'bad_request' },
            );
        }
        if (pricingUnit === 'per-tier') {
            const aspects = Object.entries(
                selectedModel.resolution_map ?? {},
            ).map(([key, sizes]) => {
                const [w, h] = key.split(':').map(Number);
                return { w, h, sizes };
            });
            if (aspects.length === 0) {
                throw new Error(
                    `Model ${selectedModel.id} missing resolution map`,
                );
            }
            const { sizes } = closestAspectRatio(ratio, aspects);
            if (!requestedTier && imageSize?.kind === 'pixels') {
                const pixels = imageSize.w * imageSize.h;
                tierKey = Object.keys(sizes).reduce((best, tier) =>
                    Math.abs(
                        Math.log((sizes[tier].w * sizes[tier].h) / pixels),
                    ) <
                    Math.abs(Math.log((sizes[best].w * sizes[best].h) / pixels))
                        ? tier
                        : best,
                );
            }
            ratio = sizes[tierKey];
        } else if (selectedModel.allowedRatios?.length) {
            // Fixed-size models reject arbitrary dimensions, so explicit
            // pixel sizes snap to the supported list the same as aspect hints.
            ratio = closestAspectRatio(ratio, selectedModel.allowedRatios);
        } else if (imageSize?.kind === 'aspect') {
            ratio = expandAspectRatio(ratio, defaultRatio.w * defaultRatio.h);
        }

        ratio = {
            w: this.#normalizeDimension(ratio.w, selectedModel),
            h: this.#normalizeDimension(ratio.h, selectedModel),
        };

        const actor = Context.get('actor');
        if (!actor) {
            throw new HttpError(401, 'actor not found in context', {
                legacyCode: 'unauthorized',
            });
        }

        let costInMicroCents: number;
        let usageAmount: number;
        let usageKey: string;

        if (pricingUnit === 'per-image') {
            const centsPerImage = selectedModel.costs['per-image'];
            if (centsPerImage === undefined) {
                throw new Error(
                    `Model ${selectedModel.id} missing 'per-image' cost`,
                );
            }
            costInMicroCents = centsPerImage * 1_000_000;
            usageAmount = 1;
            usageKey = 'per-image';
        } else if (pricingUnit === 'per-tier') {
            const centsPerImage = selectedModel.costs[tierKey];
            if (centsPerImage === undefined) {
                throw new Error(`Model ${selectedModel.id} missing tier cost`);
            }
            costInMicroCents = centsPerImage * 1_000_000;
            usageAmount = 1;
            usageKey = tierKey;
        } else {
            const centsPerMP = selectedModel.costs['1MP'];
            if (centsPerMP === undefined) {
                throw new Error(`Model ${selectedModel.id} missing '1MP' cost`);
            }
            const MP = (ratio.h * ratio.w) / 1_000_000;
            costInMicroCents = centsPerMP * MP * 1_000_000;
            usageAmount = MP;
            usageKey = '1MP';
        }

        const usageType = `${selectedModel.id}:${usageKey}`;
        const inputImageCost =
            options.image_url || options.image_base64
                ? (selectedModel.costs.input_image ?? 0) * 1_000_000
                : 0;

        const usageAllowed = await this.#meteringService.hasEnoughCredits(
            actor,
            costInMicroCents + inputImageCost,
        );

        if (!usageAllowed) {
            throw new HttpError(
                402,
                'Insufficient credits for image generation',
                { legacyCode: 'insufficient_funds' },
            );
        }

        const request = this.#buildRequest(
            prompt,
            {
                ...options,
                ratio,
                model: selectedModel.id.replace('togetherai:', ''),
            },
            selectedModel,
        ) as unknown as Together.Images.ImageGenerateParams;

        // Let SDK errors bubble — together-ai SDK errors carry `.status`
        // which the driver-boundary `translateProviderError` maps to
        // `upstream_*` HttpErrors. Re-wrapping in `new Error(...)` would
        // strip the status field and cause these to surface as 500s.
        const response = await this.#client.images.generate(request);
        if (!response?.data?.length) {
            throw new HttpError(
                400,
                'Together AI response did not include image data',
                {
                    legacyCode: 'upstream_bad_request',
                    fields: { provider: 'together' },
                },
            );
        }

        this.#meteringService.incrementUsage(
            actor,
            usageType,
            usageAmount,
            costInMicroCents,
        );
        if (inputImageCost > 0) {
            this.#meteringService.incrementUsage(
                actor,
                `${selectedModel.id}:input_image`,
                1,
                inputImageCost,
            );
        }

        const first = response.data[0] as {
            url?: string;
            b64_json?: string;
        };
        const url =
            first.url ||
            (first.b64_json ? imageDataUri(first.b64_json) : undefined);

        if (!url) {
            throw new HttpError(
                400,
                'Together AI response did not include an image URL',
                {
                    legacyCode: 'upstream_bad_request',
                    fields: { provider: 'together' },
                },
            );
        }

        return url;
    }

    #getModel(model?: string) {
        return (
            this.models().find((m) =>
                [m.id, m.puterId, ...(m.aliases ?? [])].some(
                    (id) =>
                        id !== undefined &&
                        id.toLowerCase() === model?.trim().toLowerCase(),
                ),
            ) || this.models().find((m) => m.id === DEFAULT_MODEL)!
        );
    }

    #buildRequest(
        prompt: string,
        options: TogetherGenerateParams,
        selectedModel: TogetherImageModel,
    ) {
        const {
            ratio,
            model,
            steps,
            seed,
            negative_prompt,
            image_url,
            image_base64,
            mask_image_url,
            mask_image_base64,
            prompt_strength,
            disable_safety_checker,
            response_format,
        } = options;

        const request: Record<string, unknown> = {
            prompt,
            model: model ?? DEFAULT_MODEL,
        };
        // Google's image endpoints can reject even an explicit count of one.
        if (selectedModel.supportsImageCount !== false) request.n = 1;

        request.width = ratio?.w ?? TOGETHER_DEFAULT_RATIO.w;
        request.height = ratio?.h ?? TOGETHER_DEFAULT_RATIO.h;

        if (typeof steps === 'number' && Number.isFinite(steps)) {
            request.steps = Math.max(1, Math.min(50, Math.round(steps)));
        }
        if (typeof seed === 'number' && Number.isFinite(seed))
            request.seed = Math.round(seed);
        if (typeof negative_prompt === 'string')
            request.negative_prompt = negative_prompt;
        if (disable_safety_checker) {
            request.disable_safety_checker = true;
        }
        if (typeof response_format === 'string')
            request.response_format = response_format;

        const resolvedImageBase64 =
            typeof image_base64 === 'string' ? image_base64 : undefined;

        const referenceField = selectedModel.referenceImageField;
        if (referenceField) {
            const reference =
                image_url ||
                (resolvedImageBase64
                    ? toUrlOrDataUri(
                          resolvedImageBase64,
                          options.input_image_mime_type,
                      )
                    : undefined);
            if (reference)
                request[referenceField] =
                    referenceField === 'reference_images'
                        ? [reference]
                        : reference;
        } else {
            if (typeof image_url === 'string') request.image_url = image_url;
            if (resolvedImageBase64)
                request.image_base64 =
                    parseDataUri(resolvedImageBase64)?.base64 ??
                    resolvedImageBase64;
        }
        if (typeof mask_image_url === 'string')
            request.mask_image_url = mask_image_url;
        if (typeof mask_image_base64 === 'string')
            request.mask_image_base64 = mask_image_base64;
        if (
            typeof prompt_strength === 'number' &&
            Number.isFinite(prompt_strength)
        ) {
            request.prompt_strength = Math.max(0, Math.min(1, prompt_strength));
        }

        return request;
    }

    #normalizeDimension(value: number, model: TogetherImageModel) {
        if (
            typeof value !== 'number' ||
            !Number.isFinite(value) ||
            value <= 0
        ) {
            throw new HttpError(400, 'Invalid image dimension', {
                legacyCode: 'bad_request',
            });
        }
        const step = model.dimensionStep ?? 8;
        return Math.min(
            model.maxDimension ?? Infinity,
            Math.max(model.minDimension ?? 64, Math.round(value / step) * step),
        );
    }
}
