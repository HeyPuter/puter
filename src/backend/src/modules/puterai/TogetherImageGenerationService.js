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
const APIError = require('../../api/APIError');
const BaseService = require('../../services/BaseService');
const { TypedValue } = require('../../services/drivers/meta/Runtime');
const { Context } = require('../../util/context');
const { Together } = require('together-ai');

/**
* Service class for generating images using Together AI models.
* Extends BaseService to provide image generation capabilities through the
* puter-image-generation interface. Handles authentication, request validation,
* and metering integration.
*/
class TogetherImageGenerationService extends BaseService {
    /** @type {import('../../services/MeteringService/MeteringService').MeteringService} */
    get meteringService() {
        return this.services.get('meteringService').meteringService;
    }

    static MODULES = {};

    async _init() {
        const apiKey =
            this.config?.apiKey ??
            this.global_config?.services?.['together-ai']?.apiKey;

        if ( !apiKey ) {
            throw new Error('Together AI image generation requires an API key');
        }

        this.client = new Together({ apiKey });
    }

    static IMPLEMENTS = {
        ['driver-capabilities']: {
            supports_test_mode(iface, method_name) {
                return iface === 'puter-image-generation' &&
                    method_name === 'generate';
            },
        },
        ['puter-image-generation']: {
            /**
            * Generates an image using Together AI image models
            * @param {object} params - Generation parameters
            * @param {string} params.prompt - Prompt describing the desired image
            * @param {string} [params.model] - Together AI model identifier
            * @param {object} [params.ratio] - Width/height ratio object (e.g., { w: 1024, h: 1024 })
            * @param {number} [params.width] - Explicit width override
            * @param {number} [params.height] - Explicit height override
            * @param {string} [params.aspect_ratio] - Aspect ratio string (e.g., "16:9")
            * @param {number} [params.steps] - Diffusion step count
            * @param {number} [params.seed] - Seed for reproducibility
            * @param {string} [params.negative_prompt] - Negative prompt text
            * @param {number} [params.n] - Number of images to generate (default 1)
            * @param {string} [params.image_url] - Reference image URL for image-to-image
            * @param {string} [params.image_base64] - Base64 encoded reference image
            * @param {boolean} [params.disable_safety_checker] - Disable Together AI safety checker
            * @param {boolean} [params.test_mode] - Enable Puter test mode shortcut
            * @returns {Promise<TypedValue>} TypedValue containing the generated image URL or data URI
            */
            async generate(params) {
                const {
                    prompt,
                    test_mode,
                    ratio,
                    model,
                    width,
                    height,
                    aspect_ratio,
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
                } = params;

                if ( test_mode ) {
                    return new TypedValue({
                        $: 'string:url:web',
                        content_type: 'image',
                    }, 'https://puter-sample-data.puter.site/image_example.png');
                }

                const url = await this.generate(prompt, {
                    ratio,
                    model,
                    width,
                    height,
                    aspect_ratio,
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
                });

                const isDataUrl = url.startsWith('data:');
                return new TypedValue({
                    $: isDataUrl ? 'string:url:data' : 'string:url:web',
                    content_type: 'image',
                }, url);
            },
        },
    };

    static DEFAULT_MODEL = 'black-forest-labs/FLUX.1-schnell';
    static DEFAULT_RATIO = { w: 1024, h: 1024 };
    static CONDITION_IMAGE_MODELS = [
        'black-forest-labs/flux.1-kontext-dev',
        'black-forest-labs/flux.1-kontext-pro',
        'black-forest-labs/flux.1-kontext-max',
    ];

    /**
    * Generates an image using Together AI client
    * @private
    */
    async generate(prompt, options) {
        if ( typeof prompt !== 'string' || prompt.trim().length === 0 ) {
            throw new Error('`prompt` must be a non-empty string');
        }

        const request = this._buildRequest(prompt, options);

        const actor = Context.get('actor');
        if ( !actor ) {
            throw new Error('actor not found in context');
        }

        const usageType = `together-image:${request.model}`;
        const usageAllowed = await this.meteringService.hasEnoughCreditsFor(actor, usageType, 1);
        if ( !usageAllowed ) {
            throw APIError.create('insufficient_funds');
        }

        const response = await this.client.images.create(request);
        if ( !response?.data?.length ) {
            throw new Error('Together AI response did not include image data');
        }

        this.meteringService.incrementUsage(actor, usageType, 1);

        const first = response.data[0];
        if ( first.url ) {
            return first.url;
        }
        if ( first.b64_json ) {
            return 'data:image/png;base64,' + first.b64_json;
        }

        throw new Error('Together AI response did not include an image URL');
    }

    /**
    * Normalizes Together AI image generation request parameters
    * @private
    */
    _buildRequest(prompt, options = {}) {
        const {
            ratio,
            model,
            width,
            height,
            aspect_ratio,
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

        const request = {
            prompt,
            model: model ?? this.constructor.DEFAULT_MODEL,
        };
        const requiresConditionImage =
            this.constructor._modelRequiresConditionImage(request.model);

        const ratioWidth = (ratio && ratio.w !== undefined) ? Number(ratio.w) : undefined;
        const ratioHeight = (ratio && ratio.h !== undefined) ? Number(ratio.h) : undefined;

        const normalizedWidth = this._normalizeDimension(
            width !== undefined ? Number(width) : (ratioWidth ?? this.constructor.DEFAULT_RATIO.w)
        );
        const normalizedHeight = this._normalizeDimension(
            height !== undefined ? Number(height) : (ratioHeight ?? this.constructor.DEFAULT_RATIO.h)
        );

        if ( aspect_ratio ) {
            request.aspect_ratio = aspect_ratio;
        } else {
            if ( normalizedWidth ) request.width = normalizedWidth;
            if ( normalizedHeight ) request.height = normalizedHeight;
        }

        if ( typeof steps === 'number' && Number.isFinite(steps) ) {
            request.steps = Math.max(1, Math.min(50, Math.round(steps)));
        }
        if ( typeof seed === 'number' && Number.isFinite(seed) ) request.seed = Math.round(seed);
        if ( typeof negative_prompt === 'string' ) request.negative_prompt = negative_prompt;
        if ( typeof n === 'number' && Number.isFinite(n) ) {
            request.n = Math.max(1, Math.min(4, Math.round(n)));
        }
        if ( typeof disable_safety_checker === 'boolean' ) {
            request.disable_safety_checker = disable_safety_checker;
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

            if ( !conditionSource ) {
                throw new Error(`Model ${request.model} requires an image_url or image_base64 input`);
            }

            request.condition_image = conditionSource;
        }

        return request;
    }

    _normalizeDimension(value) {
        if ( typeof value !== 'number' ) return undefined;
        const rounded = Math.max(64, Math.round(value));
        // Flux models expect multiples of 8. Snap to the nearest multiple without going below 64.
        return Math.max(64, Math.round(rounded / 8) * 8);
    }

    static _modelRequiresConditionImage(model) {
        if ( typeof model !== 'string' || model.trim() === '' ) {
            return false;
        }

        const normalized = model.toLowerCase();
        return this.CONDITION_IMAGE_MODELS.some(required => normalized === required);
    }
}

module.exports = {
    TogetherImageGenerationService,
};
