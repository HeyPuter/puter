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
const APIError = require("../../api/APIError");
const BaseService = require("../../services/BaseService");
const { TypedValue } = require("../../services/drivers/meta/Runtime");
const { Context } = require("../../util/context");


/**
* Service class for generating images using OpenAI's DALL-E API.
* Extends BaseService to provide image generation capabilities through
* the puter-image-generation interface. Supports different aspect ratios
* (square, portrait, landscape) and handles API authentication, request
* validation, and spending tracking.
*/
class OpenAIImageGenerationService extends BaseService {
    static MODULES = {
        openai: require('openai'),
    }
    
    _construct () {
        this.models_ = {
            'dall-e-3': {
                '1024x1024': 0.04,
                '1024x1792': 0.08,
                '1792x1024': 0.08,
                'hd:1024x1024': 0.08,
                'hd:1024x1792': 0.12,
                'hd:1792x1024': 0.12,
            },
            'dall-e-2': {
                '1024x1024': 0.02,
                '512x512': 0.018,
                '256x256': 0.016,
            },
        };
    }
    
    /**
    * Initializes the OpenAI client with API credentials from config
    * @private
    * @async
    * @returns {Promise<void>}
    */
    async _init () {
        const sk_key =
            this.config?.openai?.secret_key ??
            this.global_config.openai?.secret_key;

        this.openai = new this.modules.openai.OpenAI({
            apiKey: sk_key
        });
    }

    static IMPLEMENTS = {
        ['driver-capabilities']: {
            supports_test_mode (iface, method_name) {
                return iface === 'puter-image-generation' &&
                    method_name === 'generate';
            }
        },
        ['puter-image-generation']: {
            /**
            * Generates an image using OpenAI's DALL-E API
            * @param {string} prompt - The text description of the image to generate
            * @param {Object} options - Generation options
            * @param {Object} options.ratio - Image dimensions ratio object with w/h properties
            * @param {string} [options.model='dall-e-3'] - The model to use for generation
            * @returns {Promise<string>} URL of the generated image
            * @throws {Error} If prompt is not a string or ratio is invalid
            */
            async generate ({ prompt, quality, test_mode }) {
                if ( test_mode ) {
                    return new TypedValue({
                        $: 'string:url:web',
                        content_type: 'image',
                    }, 'https://puter-sample-data.puter.site/image_example.png');
                }

                const url = await this.generate(prompt, {
                    quality,
                    ratio: this.constructor.RATIO_SQUARE,
                });

                const image = new TypedValue({
                    $: 'string:url:web',
                    content_type: 'image'
                }, url);

                return image;
            }
        }
    };

    static RATIO_SQUARE = { w: 1024, h: 1024 };
    static RATIO_PORTRAIT = { w: 1024, h: 1792 };
    static RATIO_LANDSCAPE = { w: 1792, h: 1024 };

    async generate (prompt, {
        ratio,
        model,
        quality,
    }) {
        if ( typeof prompt !== 'string' ) {
            throw new Error('`prompt` must be a string');
        }

        if ( ! ratio || ! this._validate_ratio(ratio) ) {
            throw new Error('`ratio` must be a valid ratio');
        }

        model = model ?? 'dall-e-3';
        
        if ( ! this.models_[model] ) {
            throw APIError.create('field_invalid', null, {
                key: 'model',
                expected: 'one of: ' +
                    Object.keys(this.models_).join(', '),
                got: model,
            });
        }
        
        if ( quality && quality !== 'standard' && quality !== 'hd' ) {
            throw APIError.create('field_invalid', null, {
                key: 'quality',
                expected: 'one of: standard, hd',
                got: quality,
            });
        }
        
        console.log('SPECIFIED QUALITY:', quality);
        
        const size = `${ratio.w}x${ratio.h}`;
        const price_key = (quality === 'hd' ? 'hd:' : '') + size;
        if ( ! this.models_[model][price_key] ) {
            throw APIError.create('field_invalid', null, {
                key: 'size',
                expected: 'one of: standard, hd',
                got: quality,
            });
        }
        
        if ( ! this.models_[model][size] ) {
            throw APIError.create('internal_error', null, {
                message: `price of ${size} not known for model ${model}`
            });
        }
        
        const user_private_uid = Context.get('actor')?.private_uid ?? 'UNKNOWN';
        if ( user_private_uid === 'UNKNOWN' ) {
            this.errors.report('chat-completion-service:unknown-user', {
                message: 'failed to get a user ID for an OpenAI request',
                alarm: true,
                trace: true,
            });
        }
        
        const svc_cost = this.services.get('cost');
        const usageAllowed = await svc_cost.get_funding_allowed({
            minimum: this.models_[model][price_key]
                * 100 // $ USD to cents USD
                * Math.pow(10,6) // cents to microcents
        });
        
        if ( ! usageAllowed ) {
            throw APIError.create('insufficient_funds');
        }

        const result = await this.openai.images.generate({
            user: user_private_uid,
            prompt,
            size,
        });
            
        // Tiny base64 result for testing
        // const result = {
        //     data: [
        //         {
        //             url: 'data:image/png;base64,' +
        //                 'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAA' +
        //                 '2ElEQVR4nADIADf/AkRgiOi4oaIHfdeNCE2vFMURlKdHdb/H' +
        //                 '4wRTROeyGdCpn089i13t42v73DQSsCwSDAsEBLH783BZu1si' +
        //                 'LkiwqfGwHAC/8bL0NggaA47QKDuRDp0NRgtALj8W+mSm9BIH' +
        //                 'PMGYegR+bu/c85wWQGLYrjLhis9E8AE1F/AFbCMA53+9d73t' +
        //                 '/QKPbbdLHZY8wB4OewzT8CrCBG3RE7kyWAXuJvaHHHzFhbIN' +
        //                 '1hryGU5vvwD6liTD3hytRktVRRAaRi71k2PYCro6AlYBAAD/' +
        //                 '/wWtWjI5xEefAAAAAElFTkSuQmCC'
        //         }
        //     ]
        // };

        const spending_meta = {
            model,
            size: `${ratio.w}x${ratio.h}`,
        };

        const svc_spending = Context.get('services').get('spending');
        svc_spending.record_spending('openai', 'image-generation', spending_meta);

        const url = result.data?.[0]?.url;
        return url;
    }

    _validate_ratio (ratio) {
        return false
            || ratio === this.constructor.RATIO_SQUARE
            || ratio === this.constructor.RATIO_PORTRAIT
            || ratio === this.constructor.RATIO_LANDSCAPE
            ;
    }
}

module.exports = {
    OpenAIImageGenerationService,
};
