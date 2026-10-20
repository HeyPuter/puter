import * as utils from '../../lib/utils.js';
import getAbsolutePathForApp from '../FileSystem/utils/getAbsolutePathForApp.js';
import { toImageElement } from './lib/media.js';
import { createMediaStager } from './lib/stage.js';

/** @typedef {import('./types.js').Txt2ImgOptions} Txt2ImgOptions */

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
 * A Blob, File or data URI over 1 MiB given as an input or mask image is
 * written to a temporary Puter file for the request and deleted afterwards,
 * or sent inline if it can't be written.
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

    if ( typeof promptOrOptions === 'string' && optionsOrTestMode && typeof optionsOrTestMode === 'object' ) {
        options = { ...optionsOrTestMode };
        options.prompt = promptOrOptions;
    }

    if ( promptOrOptions && typeof promptOrOptions === 'object' ) {
        options = { ...promptOrOptions };
    }

    if ( typeof options.prompt !== 'string' || ! options.prompt.trim() ) {
        throw ({ message: 'Prompt parameter is required', code: 'prompt_required' });
    }

    const driverHint = typeof options.driver === 'string' ? options.driver : undefined;
    const imageService = driverHint || 'ai-image';

    if ( options.puter_output_path ) {
        options.puter_output_path = getAbsolutePathForApp(options.puter_output_path, puter);
    }

    const stager = createMediaStager(puter);
    try {
        const { stageImage } = stager;
        const [inputImage, inputImages, maskImage] = await Promise.all([
            stageImage(options.input_image),
            Array.isArray(options.input_images)
                ? Promise.all(options.input_images.map(stageImage))
                : options.input_images,
            stageImage(options.maskImage),
        ]);
        for ( const [key, value] of Object.entries({
            input_image: inputImage,
            input_images: inputImages,
            maskImage,
        }) ) {
            if ( value !== undefined ) options[key] = value;
        }

        return await utils.makeDriverMethod({
            iface: 'puter-image-generation',
            driver: imageService,
            method: 'generate',
            argNames: ['prompt'],
            puter,
            responseType: 'blob',
            testMode: testMode ?? false,
            transform: toImageElement,
        })(options);
    } finally {
        await stager.cleanup();
    }
}
