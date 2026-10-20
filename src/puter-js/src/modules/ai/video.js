import * as utils from '../../lib/utils.js';
import getAbsolutePathForApp from '../FileSystem/utils/getAbsolutePathForApp.js';
import { toVideoElement } from './lib/media.js';
import { createMediaStager } from './lib/stage.js';

/** @typedef {import('./types.js').Txt2VidOptions} Txt2VidOptions */

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
 * With `inputVideo` on a model that edits video, the prompt describes the edit.
 * A Blob, File or data URI over 1 MiB given as a video or image input is
 * written to a temporary Puter file for the request and deleted afterwards.
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

    // `duration` is accepted as an alias of `seconds`
    if ( options.duration !== undefined && options.seconds === undefined ) {
        options.seconds = options.duration;
    }

    if ( options.test_mode === true ) {
        testMode = true;
    }

    if ( options.inputVideo !== undefined ) {
        options.input_video = options.inputVideo;
        delete options.inputVideo;
    }

    const driverHint = typeof options.driver === 'string' ? options.driver : undefined;
    const videoService = driverHint || 'ai-video';

    if ( options.puter_output_path ) {
        options.puter_output_path = getAbsolutePathForApp(options.puter_output_path, puter);
    }

    const stager = createMediaStager(puter);
    try {
        const { stage } = stager;
        const [inputVideo, inputReference, lastFrame, referenceImages, frameImages] = await Promise.all([
            stage(options.input_video),
            stage(options.input_reference),
            stage(options.last_frame),
            Array.isArray(options.reference_images)
                ? Promise.all(options.reference_images.map(stage))
                : options.reference_images,
            Array.isArray(options.frame_images)
                ? Promise.all(options.frame_images.map(async (frame) =>
                    frame && typeof frame === 'object'
                        ? { ...frame, input_image: await stage(frame.input_image) }
                        : frame))
                : options.frame_images,
        ]);
        for ( const [key, value] of Object.entries({
            input_video: inputVideo,
            input_reference: inputReference,
            last_frame: lastFrame,
            reference_images: referenceImages,
            frame_images: frameImages,
        }) ) {
            if ( value !== undefined ) options[key] = value;
        }

        return await utils.makeDriverMethod({
            iface: 'puter-video-generation',
            driver: videoService,
            method: 'generate',
            argNames: ['prompt'],
            puter,
            responseType: 'blob',
            testMode: testMode ?? false,
            transform: toVideoElement,
        })(options);
    } finally {
        await stager.cleanup();
    }
}
