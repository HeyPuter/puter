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
const { GoogleGenAI } = require('@google/genai');

/**
* Service class for generating images using Gemini's API
* Extends BaseService to provide image generation capabilities through
* the puter-image-generation interface.
*/
class GeminiImageGenerationService extends BaseService {
    /** @type {import('../../services/MeteringService/MeteringService').MeteringService} */
    get meteringService () {
        return this.services.get('meteringService').meteringService;
    }
    static MODULES = {
    };

    _construct () {
        this.models_ = {
            'gemini-2.5-flash-image-preview': {
                '1024x1024': 0.039,
            },
            'gemini-3-pro-image-preview': {
                '1024x1024': 0.156,
            },
        };
    }

    /**
    * Initializes the Gemini client with API credentials from config
    * @private
    * @async
    * @returns {Promise<void>}
    */
    async _init () {
        this.genAI = new GoogleGenAI({ apiKey: this.global_config.services.gemini.apiKey });
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
            * Generates an image using Gemini's gemini-2.5-flash-image-preview
            * @param {string} prompt - The text description of the image to generate
            * @param {Object} options - Generation options
            * @param {Object} options.ratio - Image dimensions ratio object with w/h properties
            * @param {string} [options.model='gemini-2.5-flash-image-preview'] - The model to use for generation
            * @param {string} [options.input_image] - Base64 encoded input image for image-to-image generation
            * @param {string} [options.input_image_mime_type] - MIME type of the input image
            * @returns {Promise<string>} URL of the generated image
            * @throws {Error} If prompt is not a string or ratio is invalid
            */
            async generate (params) {
                const { prompt, quality, test_mode, model, ratio, input_image, input_image_mime_type } = params;

                if ( test_mode ) {
                    return new TypedValue({
                        $: 'string:url:web',
                        content_type: 'image',
                    }, 'https://puter-sample-data.puter.site/image_example.png');
                }

                const url = await this.generate(prompt, {
                    quality,
                    ratio: ratio || this.constructor.RATIO_SQUARE,
                    model,
                    input_image,
                    input_image_mime_type,
                });

                // Determine if this is a data URL or web URL
                const isDataUrl = url.startsWith('data:');
                const image = new TypedValue({
                    $: isDataUrl ? 'string:url:data' : 'string:url:web',
                    content_type: 'image',
                }, url);

                return image;
            },
        },
    };

    static RATIO_SQUARE = { w: 1024, h: 1024 };

    async generate (prompt, {
        ratio,
        model,
        input_image,
        input_image_mime_type,
    }) {
        if ( typeof prompt !== 'string' ) {
            throw new Error('`prompt` must be a string');
        }

        if ( !ratio || !this._validate_ratio(ratio, model) ) {
            throw new Error(`\`ratio\` must be a valid ratio for model ${ model}`);
        }

        // Validate input image if provided
        if ( input_image && !input_image_mime_type ) {
            throw new Error('`input_image_mime_type` is required when `input_image` is provided');
        }

        if ( input_image_mime_type && !input_image ) {
            throw new Error('`input_image` is required when `input_image_mime_type` is provided');
        }

        if ( input_image_mime_type && !this._validate_image_mime_type(input_image_mime_type) ) {
            throw new Error('`input_image_mime_type` must be a valid image MIME type (image/png, image/jpeg, image/webp)');
        }

        // Somewhat sane defaults
        model = model ?? 'gemini-2.5-flash-image-preview';

        if ( ! this.models_[model] ) {
            throw APIError.create('field_invalid', null, {
                key: 'model',
                expected: `one of: ${
                    Object.keys(this.models_).join(', ')}`,
                got: model,
            });
        }

        const price_key = `${ratio.w}x${ratio.h}`;
        if ( ! this.models_[model][price_key] ) {
            const availableSizes = Object.keys(this.models_[model]);
            throw APIError.create('field_invalid', null, {
                key: 'size/quality combination',
                expected: `one of: ${ availableSizes.join(', ')}`,
                got: price_key,
            });
        }

        const actor = Context.get('actor');
        const user_private_uid = actor?.private_uid ?? 'UNKNOWN';
        if ( user_private_uid === 'UNKNOWN' ) {
            this.errors.report('chat-completion-service:unknown-user', {
                message: 'failed to get a user ID for a Gemini request',
                alarm: true,
                trace: true,
            });
        }

        const usageType = `gemini:${model}:${price_key}`;

        const usageAllowed = await this.meteringService.hasEnoughCreditsFor(actor, usageType, 1);

        if ( ! usageAllowed ) {
            throw APIError.create('insufficient_funds');
        }

        // Construct the prompt based on whether we have an input image
        let contents;
        if ( input_image && input_image_mime_type ) {
            // Image-to-image generation
            contents = [
                { text: `Generate a picture of dimensions ${parseInt(ratio.w)}x${parseInt(ratio.h)} with the prompt: ${prompt}` },
                {
                    inlineData: {
                        mimeType: input_image_mime_type,
                        data: input_image,
                    },
                },
            ];
        } else {
            // Text-to-image generation
            contents = `Generate a picture of dimensions ${parseInt(ratio.w)}x${parseInt(ratio.h)} with the prompt: ${prompt}`;
        }

        const response = await this.genAI.models.generateContent({
            model,
            contents,
        });

        // Metering usage tracking
        // Gemini usage: always 1 image, resolution, cost, model
        this.meteringService.incrementUsage(actor, usageType, 1);
        let url = undefined;
        for ( const part of response.candidates[0].content.parts ) {
            if ( part.text ) {
                // do nothing here
            } else if ( part.inlineData ) {
                const imageData = part.inlineData.data;
                url = `data:image/png;base64,${ imageData}`;
            }
        }

        if ( ! url ) {
            throw new Error('Failed to extract image URL from Gemini response');
        }

        return url;
    }

    /**
     * Get valid ratios for a specific model
     * @param {string} model - The model name
     * @returns {Array<Object>} Array of valid ratio objects
     * @private
     */
    _getValidRatios(model) {
        if (
            model === 'gemini-2.5-flash-image-preview' ||
            model === 'gemini-3-pro-image-preview'
        ) {
            return [this.constructor.RATIO_SQUARE];
        }
        return [];
    }

    _validate_ratio (ratio, model) {
        const validRatios = this._getValidRatios(model);
        return validRatios.includes(ratio);
    }

    /**
     * Validates if the provided MIME type is supported for input images
     * @param {string} mimeType - The MIME type to validate
     * @returns {boolean} True if the MIME type is supported
     * @private
     */
    _validate_image_mime_type (mimeType) {
        const supportedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
        return supportedTypes.includes(mimeType.toLowerCase());
    }
}

module.exports = {
    GeminiImageGenerationService,
};
