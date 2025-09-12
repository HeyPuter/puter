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
const { GoogleGenAI } = require('@google/genai');

/**
* Service class for generating images using Gemini's API
* Extends BaseService to provide image generation capabilities through
* the puter-image-generation interface.
*/
class GeminiImageGenerationService extends BaseService {
    static MODULES = {
    }

    _construct() {
        this.models_ = {
            'gemini-2.5-flash-image-preview': {
                "1024x1024": 0.039,
            }
        };
    }

    /**
    * Initializes the Gemini client with API credentials from config
    * @private
    * @async
    * @returns {Promise<void>}
    */
    async _init() {
        this.genAI = new GoogleGenAI({apiKey: this.global_config.services.gemini.apiKey});
    }

    static IMPLEMENTS = {
        ['driver-capabilities']: {
            supports_test_mode(iface, method_name) {
                return iface === 'puter-image-generation' &&
                    method_name === 'generate';
            }
        },
        ['puter-image-generation']: {
            /**
            * Generates an image using Gemini's gemini-2.5-flash-image-preview
            * @param {string} prompt - The text description of the image to generate
            * @param {Object} options - Generation options
            * @param {Object} options.ratio - Image dimensions ratio object with w/h properties
            * @param {string} [options.model='gemini-2.5-flash-image-preview'] - The model to use for generation
            * @returns {Promise<string>} URL of the generated image
            * @throws {Error} If prompt is not a string or ratio is invalid
            */
            async generate(params) {
                const { prompt, quality, test_mode, model, ratio } = params;
                
                if (test_mode) {
                    return new TypedValue({
                        $: 'string:url:web',
                        content_type: 'image',
                    }, 'https://puter-sample-data.puter.site/image_example.png');
                }
                const url = await this.generate(prompt, {
                    quality,
                    ratio: ratio || this.constructor.RATIO_SQUARE,
                    model
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

    async generate(prompt, {
        ratio,
        model,
    }) {
        if (typeof prompt !== 'string') {
            throw new Error('`prompt` must be a string');
        }

        if (!ratio || !this._validate_ratio(ratio, model)) {
            throw new Error('`ratio` must be a valid ratio for model ' + model);
        }

        // Somewhat sane defaults
        model = model ?? 'gemini-2.5-flash-image-preview';

        if (!this.models_[model]) {
            throw APIError.create('field_invalid', null, {
                key: 'model',
                expected: 'one of: ' +
                    Object.keys(this.models_).join(', '),
                got: model,
            });
        }

        const price_key = `${ratio.w}x${ratio.h}`;
        if (!this.models_[model][price_key]) {
            const availableSizes = Object.keys(this.models_[model]);
            throw APIError.create('field_invalid', null, {
                key: 'size/quality combination',
                expected: 'one of: ' + availableSizes.join(', '),
                got: price_key,
            });
        }

        const user_private_uid = Context.get('actor')?.private_uid ?? 'UNKNOWN';
        if (user_private_uid === 'UNKNOWN') {
            this.errors.report('chat-completion-service:unknown-user', {
                message: 'failed to get a user ID for a Gemini request',
                alarm: true,
                trace: true,
            });
        }

        const exact_cost = this.models_[model][price_key]
            * 100 // $ USD to cents USD
            * Math.pow(10, 6) // cents to microcents

        const svc_cost = this.services.get('cost');
        const usageAllowed = await svc_cost.get_funding_allowed({
            minimum: exact_cost,
        });

        if (!usageAllowed) {
            throw APIError.create('insufficient_funds');
        }

        // We can charge immediately
        await svc_cost.record_cost({ cost: exact_cost });

        const response = await this.genAI.models.generateContent({
            model: "gemini-2.5-flash-image-preview",
            contents: `Generate a picture of dimensions ${parseInt(ratio.w)}x${parseInt(ratio.h)} with the prompt: ${prompt}`,
        });
        let url = undefined;
        for (const part of response.candidates[0].content.parts) {
            if (part.text) {
            } else if (part.inlineData) {
                const imageData = part.inlineData.data;
                url = "data:image/png;base64," + imageData
            }
        }

        if (!url) {
            throw new Error('Failed to extract image URL from Gemini response');
        }

        const spending_meta = {
            model,
            size: `${ratio.w}x${ratio.h}`,
        };

        const svc_spending = Context.get('services').get('spending');
        svc_spending.record_spending('gemini', 'image-generation', spending_meta);

        return url;
    }

    /**
     * Get valid ratios for a specific model
     * @param {string} model - The model name
     * @returns {Array<Object>} Array of valid ratio objects
     * @private
     */
    _getValidRatios(model) {
        if (model === 'gemini-2.5-flash-image-preview') {
            return [this.constructor.RATIO_SQUARE];
        }
    }

    _validate_ratio(ratio, model) {
        const validRatios = this._getValidRatios(model);
        return validRatios.includes(ratio);
    }
}

module.exports = {
    GeminiImageGenerationService,
};
