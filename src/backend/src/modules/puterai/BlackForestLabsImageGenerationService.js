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

/**
* Service class for generating images using Black Forest Labs' FLUX APIs.
* Handles request normalization, endpoint selection, polling, and metering.
*/
class BlackForestLabsImageGenerationService extends BaseService {
    /** @type {import('../../services/MeteringService/MeteringService').MeteringService} */
    get meteringService () {
        return this.services.get('meteringService').meteringService;
    }

    static MODULES = {};

    _construct () {
        this.baseUrl = 'https://api.bfl.ai';
        this.pollIntervalMs = 1000;
        this.pollTimeoutMs = 300_000;
    }

    async _init () {
        this.apiKey =
            this.config?.apiKey ??
            this.global_config?.services?.['black-forest-labs']?.apiKey ??
            this.global_config?.services?.bfl?.apiKey ??
            process.env.BFL_API_KEY;

        this.baseUrl =
            this.config?.baseUrl ??
            this.global_config?.services?.['black-forest-labs']?.baseUrl ??
            this.global_config?.services?.bfl?.baseUrl ??
            this.baseUrl;

        this.pollIntervalMs =
            this.config?.pollIntervalMs ??
            this.global_config?.services?.['black-forest-labs']?.pollIntervalMs ??
            this.global_config?.services?.bfl?.pollIntervalMs ??
            this.pollIntervalMs;

        this.pollTimeoutMs =
            this.config?.pollTimeoutMs ??
            this.global_config?.services?.['black-forest-labs']?.pollTimeoutMs ??
            this.global_config?.services?.bfl?.pollTimeoutMs ??
            this.pollTimeoutMs;

        if ( ! this.apiKey ) {
            throw new Error('Black Forest Labs image generation requires an API key');
        }
    }

    static IMPLEMENTS = {
        ['driver-capabilities']: {
            supports_test_mode (iface, method_name) {
                return iface === 'puter-image-generation' &&
                    method_name === 'generate';
            },
        },
        ['puter-image-generation']: {
            /**
            * Generates an image using BFL FLUX APIs.
            * Supports text-to-image, image-to-image, and inpainting/outpainting depending on the selected endpoint.
            */
            async generate (params) {
                const { prompt, test_mode } = params;

                if ( test_mode ) {
                    return new TypedValue({
                        $: 'string:url:web',
                        content_type: 'image',
                    }, 'https://puter-sample-data.puter.site/image_example.png');
                }

                const url = await this.generate(prompt, params);
                const isDataUrl = typeof url === 'string' && url.startsWith('data:');

                return new TypedValue({
                    $: isDataUrl ? 'string:url:data' : 'string:url:web',
                    content_type: 'image',
                }, url);
            },
        },
    };

    static DEFAULT_MODEL = 'flux-pro-1.1';

    _resolveModel (rawModel) {
        const model = (rawModel || this.constructor.DEFAULT_MODEL).toLowerCase();

        const map = {
            'flux-2-pro': { path: '/v1/flux-2-pro', usageKey: 'flux-2-pro' },
            'flux-2-flex': { path: '/v1/flux-2-flex', usageKey: 'flux-2-flex' },
            'flux-pro-1.1': { path: '/v1/flux-pro-1.1', usageKey: 'flux-pro-1.1' },
            'flux-pro-1.1-ultra': { path: '/v1/flux-pro-1.1-ultra', usageKey: 'flux-pro-1.1-ultra' },
            'flux-pro-1.1-raw': { path: '/v1/flux-pro-1.1-ultra', usageKey: 'flux-pro-1.1-raw', defaults: { raw: true } },
            'flux-kontext-pro': { path: '/v1/flux-kontext-pro', usageKey: 'flux-kontext-pro' },
            'flux-kontext-max': { path: '/v1/flux-kontext-max', usageKey: 'flux-kontext-max' },
            'flux-pro-1.0-fill': { path: '/v1/flux-pro-1.0-fill', usageKey: 'flux-pro-1.0-fill' },
            'flux-pro-1.0-expand': { path: '/v1/flux-pro-1.0-expand', usageKey: 'flux-pro-1.0-expand' },
        };

        if ( map[model] ) {
            return { model: rawModel, ...map[model] };
        }

        return { model: rawModel, path: '/v1/flux-pro-1.1', usageKey: 'flux-pro-1.1' };
    }

    async generate (prompt, options) {
        if ( typeof prompt !== 'string' || prompt.trim().length === 0 ) {
            throw new Error('`prompt` must be a non-empty string');
        }

        const resolved = this._resolveModel(options?.model);
        const actor = Context.get('actor');

        if ( ! actor ) {
            throw new Error('actor not found in context');
        }

        const usageType = `bfl:${resolved.usageKey}`;
        const usageAllowed = await this.meteringService.hasEnoughCreditsFor(actor, usageType, 1);
        if ( ! usageAllowed ) {
            throw APIError.create('insufficient_funds');
        }

        const payload = this._buildRequest(prompt, options, resolved);
        const submitUrl = this._joinUrl(this.baseUrl, resolved.path);
        const submission = await this._postJson(submitUrl, payload);

        const pollingUrl = submission?.polling_url || submission?.url || null;
        if ( ! pollingUrl ) {
            throw new Error('BFL response did not include a polling URL');
        }

        const result = await this._pollForResult(pollingUrl);
        const imageUrl = this._extractImageUrl(result);
        if ( ! imageUrl ) {
            throw new Error('BFL response did not include an image URL');
        }

        this.meteringService.incrementUsage(actor, usageType, 1);
        return imageUrl;
    }

    _buildRequest (prompt, options = {}, resolvedModel) {
        const {
            width,
            height,
            aspect_ratio,
            steps,
            seed,
            guidance,
            prompt_upsampling,
            safety_tolerance,
            output_format,
            raw,
            image_prompt,
            image_prompt_strength,
            negative_prompt,
            prompt_strength,
            n,
            num_outputs,
            image_url,
            mask_image_url,
            webhook_url,
            webhook_secret,
            bfl_params,
        } = options;

        const payload = {
            prompt,
            ...(resolvedModel.defaults || {}),
        };

        const passthrough = {
            width,
            height,
            aspect_ratio,
            steps,
            seed,
            guidance,
            prompt_upsampling,
            safety_tolerance,
            output_format,
            raw,
            image_prompt,
            image_prompt_strength,
            negative_prompt,
            prompt_strength,
            webhook_url,
            webhook_secret,
        };

        for ( const [key, value] of Object.entries(passthrough) ) {
            if ( value !== undefined ) {
                payload[key] = value;
            }
        }

        const resolvedImage = this._stripDataUrl(
            options.image_base64 ??
            options.input_image ??
            null,
        );
        const resolvedMask = this._stripDataUrl(options.mask_image_base64 ?? null);
        const resolvedImagePrompt = this._stripDataUrl(options.image_prompt_base64 ?? image_prompt ?? null);

        if ( resolvedImage ) payload.image = resolvedImage;
        if ( typeof image_url === 'string' ) payload.image_url = image_url;
        if ( resolvedMask ) payload.mask = resolvedMask;
        if ( typeof mask_image_url === 'string' ) payload.mask_image_url = mask_image_url;
        if ( resolvedImagePrompt && !payload.image_prompt ) payload.image_prompt = resolvedImagePrompt;

        const outputCount = (typeof num_outputs === 'number' && Number.isFinite(num_outputs))
            ? num_outputs
            : (typeof n === 'number' && Number.isFinite(n) ? n : undefined);
        if ( outputCount !== undefined ) {
            payload.num_outputs = Math.max(1, Math.min(10, Math.round(outputCount)));
        }

        if ( typeof options.expand_top === 'number' ) payload.expand_top = options.expand_top;
        if ( typeof options.expand_bottom === 'number' ) payload.expand_bottom = options.expand_bottom;
        if ( typeof options.expand_left === 'number' ) payload.expand_left = options.expand_left;
        if ( typeof options.expand_right === 'number' ) payload.expand_right = options.expand_right;

        if ( bfl_params && typeof bfl_params === 'object' ) {
            Object.assign(payload, bfl_params);
        }

        return payload;
    }

    async _pollForResult (pollingUrl) {
        const start = Date.now();
        while ( Date.now() - start < this.pollTimeoutMs ) {
            const response = await this._getJson(pollingUrl);
            const status = (response?.status || '').toLowerCase();

            if ( status === 'ready' ) {
                return response;
            }
            if ( status === 'error' || status === 'failed' ) {
                throw new Error(`BFL generation failed: ${ JSON.stringify(response) }`);
            }

            await this._sleep(this.pollIntervalMs);
        }

        throw new Error('Timed out waiting for BFL image generation to complete');
    }

    async _postJson (url, body) {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                accept: 'application/json',
                'content-type': 'application/json',
                'x-key': this.apiKey,
            },
            body: JSON.stringify(body),
        });

        if ( ! response.ok ) {
            const text = await response.text();
            throw new Error(`BFL request failed (${ response.status }): ${ text }`);
        }

        return await response.json();
    }

    async _getJson (url) {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                accept: 'application/json',
                'x-key': this.apiKey,
            },
        });

        if ( ! response.ok ) {
            const text = await response.text();
            throw new Error(`BFL polling failed (${ response.status }): ${ text }`);
        }

        return await response.json();
    }

    _extractImageUrl (result) {
        if ( ! result ) return null;
        const sample = result?.result?.sample || result?.result?.image;
        if ( sample ) return sample;

        const samples = result?.result?.samples;
        if ( Array.isArray(samples) && samples.length > 0 ) {
            return samples[0];
        }

        return null;
    }

    _joinUrl (base, path) {
        if ( path.startsWith('http') ) return path;
        if ( base.endsWith('/') && path.startsWith('/') ) {
            return `${ base.slice(0, -1) }${ path }`;
        }
        if ( ! base.endsWith('/') && ! path.startsWith('/') ) {
            return `${ base }/${ path }`;
        }
        return `${ base }${ path }`;
    }

    _stripDataUrl (value) {
        if ( typeof value !== 'string' ) return value;
        const commaIndex = value.indexOf(',');
        if ( value.startsWith('data:') && commaIndex !== -1 ) {
            return value.slice(commaIndex + 1);
        }
        return value;
    }

    _sleep (ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = {
    BlackForestLabsImageGenerationService,
};
