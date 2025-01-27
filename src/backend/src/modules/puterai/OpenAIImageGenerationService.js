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
            async generate ({ prompt, test_mode }) {
                if ( test_mode ) {
                    return new TypedValue({
                        $: 'string:url:web',
                        content_type: 'image',
                    }, 'https://puter-sample-data.puter.site/image_example.png');
                }

                const url = await this.generate(prompt, {
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
    }) {
        if ( typeof prompt !== 'string' ) {
            throw new Error('`prompt` must be a string');
        }

        if ( ! ratio || ! this._validate_ratio(ratio) ) {
            throw new Error('`ratio` must be a valid ratio');
        }

        model = model ?? 'dall-e-3';

        const user_private_uid = Context.get('actor')?.private_uid ?? 'UNKNOWN';
        if ( user_private_uid === 'UNKNOWN' ) {
            this.errors.report('chat-completion-service:unknown-user', {
                message: 'failed to get a user ID for an OpenAI request',
                alarm: true,
                trace: true,
            });
        }

        const result =
            await this.openai.images.generate({
                user: user_private_uid,
                prompt,
                size: `${ratio.w}x${ratio.h}`,
            });

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
