import * as utils from '../../lib/utils.js';
import getAbsolutePathForApp from '../FileSystem/utils/getAbsolutePathForApp.js';
import { toVideoElement } from './lib/media.js';

/** @typedef {import('../../../types/modules/ai').Txt2VidOptions} Txt2VidOptions */

/**
 * @overload
 * @param {string} prompt
 * @param {boolean} [testMode]
 * @returns {Promise<HTMLVideoElement>}
 */
/**
 * @overload
 * @param {string} prompt
 * @param {Txt2VidOptions} options
 * @returns {Promise<HTMLVideoElement>}
 */
/**
 * @overload
 * @param {Txt2VidOptions} options
 * @param {boolean} [testMode]
 * @returns {Promise<HTMLVideoElement>}
 */
/**
 * Generate videos from text prompts.
 *
 * Documented forms:
 *   txt2vid(prompt, [testMode])
 *   txt2vid(prompt, options)
 *   txt2vid({ prompt, duration | seconds, ... }, [testMode])
 *
 * @this {import('./index.js').AIModule}
 * @param {string | Txt2VidOptions} [promptOrOptions]
 * @param {Txt2VidOptions | boolean} [optionsOrTestMode]
 * @returns {Promise<HTMLVideoElement>}
 */
export async function txt2vid (promptOrOptions, optionsOrTestMode) {
    const { puter } = this;
    /** @type {Txt2VidOptions} */
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

    if ( ! options.prompt ) {
        throw ({ message: 'Prompt parameter is required', code: 'prompt_required' });
    }

    // `duration` is accepted as an alias of `seconds`
    if ( options.duration !== undefined && options.seconds === undefined ) {
        options.seconds = options.duration;
    }

    if ( options.test_mode === true ) {
        testMode = true;
    }

    const driverHint = typeof options.driver === 'string' ? options.driver : undefined;
    const videoService = driverHint || 'ai-video';

    if ( options.puter_output_path ) {
        options.puter_output_path = getAbsolutePathForApp(options.puter_output_path, puter);
    }

    return await utils.make_driver_method(['prompt'], 'puter-video-generation', videoService, 'generate', {
        puter,
        responseType: 'blob',
        test_mode: testMode ?? false,
        transform: toVideoElement,
    })(options);
}
