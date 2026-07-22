import * as utils from '../../lib/utils.js';
import getAbsolutePathForApp from '../FileSystem/utils/getAbsolutePathForApp.js';
import { toImageElement } from './lib/media.js';

/** @typedef {import('../../../types/modules/ai').Txt2ImgOptions} Txt2ImgOptions */

// Friendly model aliases expanded to the models the drivers know.
const MODEL_ALIASES = {
    'nano-banana': 'gemini-2.5-flash-image-preview',
    'nano-banana-pro': 'gemini-3-pro-image-preview',
};

/**
 * @overload
 * @param {string} prompt
 * @param {boolean} [testMode]
 * @returns {Promise<HTMLImageElement>}
 */
/**
 * @overload
 * @param {string} prompt
 * @param {Txt2ImgOptions} options
 * @returns {Promise<HTMLImageElement>}
 */
/**
 * @overload
 * @param {Txt2ImgOptions} options
 * @param {boolean} [testMode]
 * @returns {Promise<HTMLImageElement>}
 */
/**
 * Generate images from text prompts or perform image-to-image generation.
 *
 * Documented forms:
 *   txt2img(prompt, [testMode])
 *   txt2img(prompt, options)
 *   txt2img({ prompt, model, input_image, ... }, [testMode])
 *
 * @this {import('./index.js').AIModule}
 * @param {string | Txt2ImgOptions} [promptOrOptions]
 * @param {Txt2ImgOptions | boolean} [optionsOrTestMode]
 * @returns {Promise<HTMLImageElement>}
 */
export async function txt2img (promptOrOptions, optionsOrTestMode) {
    const { puter } = this;
    /** @type {Txt2ImgOptions} */
    let options = {};
    let testMode = false;

    if ( typeof promptOrOptions === 'string' ) {
        options = { prompt: promptOrOptions };
    }

    if ( optionsOrTestMode === true ) {
        testMode = true;
    }

    if ( typeof promptOrOptions === 'string' && typeof optionsOrTestMode === 'object' ) {
        options = optionsOrTestMode;
        options.prompt = promptOrOptions;
    }

    if ( typeof promptOrOptions === 'object' ) {
        options = promptOrOptions;
    }

    if ( options.model && MODEL_ALIASES[options.model] ) {
        options.model = MODEL_ALIASES[options.model];
    }

    const driverHint = typeof options.driver === 'string' ? options.driver : undefined;
    const imageService = driverHint || 'ai-image';

    if ( options.puter_output_path ) {
        options.puter_output_path = getAbsolutePathForApp(options.puter_output_path, puter);
    }

    return await utils.make_driver_method(['prompt'], 'puter-image-generation', imageService, 'generate', {
        puter,
        responseType: 'blob',
        test_mode: testMode ?? false,
        transform: toImageElement,
    })(options);
}
