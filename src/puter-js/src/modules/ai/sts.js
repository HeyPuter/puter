import * as utils from '../../lib/utils.js';
import { dataUriByteLength, isPlainObject, toDataUriIfBlob } from './lib/args.js';
import { toAudioElement } from './lib/media.js';

/** @typedef {import('../../../types/modules/ai').Speech2SpeechOptions} Speech2SpeechOptions */

const MAX_INPUT_SIZE = 25 * 1024 * 1024;

/**
 * camelCase option aliases are accepted and mapped onto the snake_case
 * names the driver expects (the snake_case name wins when both are given).
 *
 * @param {Record<string, unknown>} [opts]
 * @returns {Record<string, unknown>}
 */
const normalizeOptions = (opts = {}) => {
    const normalized = { ...opts };
    if ( normalized.voiceId && !normalized.voice && !normalized.voice_id ) normalized.voice = normalized.voiceId;
    if ( normalized.modelId && !normalized.model && !normalized.model_id ) normalized.model = normalized.modelId;
    if ( normalized.outputFormat && !normalized.output_format ) normalized.output_format = normalized.outputFormat;
    if ( normalized.voiceSettings && !normalized.voice_settings ) normalized.voice_settings = normalized.voiceSettings;
    if ( normalized.fileFormat && !normalized.file_format ) normalized.file_format = normalized.fileFormat;
    if ( normalized.removeBackgroundNoise !== undefined && normalized.remove_background_noise === undefined ) {
        normalized.remove_background_noise = normalized.removeBackgroundNoise;
    }
    if ( normalized.optimizeStreamingLatency !== undefined && normalized.optimize_streaming_latency === undefined ) {
        normalized.optimize_streaming_latency = normalized.optimizeStreamingLatency;
    }
    if ( normalized.enableLogging !== undefined && normalized.enable_logging === undefined ) {
        normalized.enable_logging = normalized.enableLogging;
    }
    delete normalized.voiceId;
    delete normalized.modelId;
    delete normalized.outputFormat;
    delete normalized.voiceSettings;
    delete normalized.fileFormat;
    delete normalized.removeBackgroundNoise;
    delete normalized.optimizeStreamingLatency;
    delete normalized.enableLogging;
    return normalized;
};

/**
 * @overload
 * @param {string | File | Blob} source
 * @param {boolean} [testMode]
 * @returns {Promise<HTMLAudioElement>}
 */
/**
 * @overload
 * @param {string | File | Blob} source
 * @param {Speech2SpeechOptions} options
 * @param {boolean} [testMode]
 * @returns {Promise<HTMLAudioElement>}
 */
/**
 * @overload
 * @param {Speech2SpeechOptions} options
 * @param {boolean} [testMode]
 * @returns {Promise<HTMLAudioElement>}
 */
/**
 * Documented forms:
 *   speech2speech(audio, [testMode])
 *   speech2speech(audio, [options], [testMode])
 *   speech2speech({ audio | file, voice, ... }, [testMode])
 *
 * @this {import('./index.js').AIModule}
 * @param {string | File | Blob | Speech2SpeechOptions} [audioOrOptions]
 * @param {Speech2SpeechOptions | boolean} [optionsOrTestMode]
 * @param {boolean} [testModeFlag]
 * @returns {Promise<HTMLAudioElement>}
 */
export async function speech2speech (audioOrOptions, optionsOrTestMode, testModeFlag) {
    const { puter } = this;
    if ( audioOrOptions === undefined && optionsOrTestMode === undefined && testModeFlag === undefined ) {
        throw ({ message: 'Arguments are required', code: 'arguments_required' });
    }

    /** @type {Speech2SpeechOptions} */
    let options = {};
    let testMode = false;

    if ( isPlainObject(audioOrOptions) ) {
        options = { ...audioOrOptions };
    } else {
        options.audio = await toDataUriIfBlob(audioOrOptions);
    }

    if ( isPlainObject(optionsOrTestMode) ) {
        options = { ...options, ...optionsOrTestMode };
    } else if ( typeof optionsOrTestMode === 'boolean' ) {
        testMode = optionsOrTestMode;
    }

    if ( typeof testModeFlag === 'boolean' ) {
        testMode = testModeFlag;
    }

    // `file` is accepted as an alias of `audio`
    if ( options.file ) {
        options.audio = await toDataUriIfBlob(options.file);
        delete options.file;
    }

    if ( options.audio instanceof Blob ) {
        options.audio = await toDataUriIfBlob(options.audio);
    }

    if ( ! options.audio ) {
        throw { message: 'Audio input is required', code: 'audio_required' };
    }

    if ( typeof options.audio === 'string' && options.audio.startsWith('data:') ) {
        if ( dataUriByteLength(options.audio) > MAX_INPUT_SIZE ) {
            throw { message: 'Input size cannot be larger than 25 MB', code: 'input_too_large' };
        }
    }

    const driverArgs = normalizeOptions({ ...options });
    delete driverArgs.provider;

    return await utils.make_driver_method(['audio'], 'puter-speech2speech', 'elevenlabs-voice-changer', 'convert', {
        puter,
        responseType: 'blob',
        test_mode: testMode,
        transform: toAudioElement,
    })(driverArgs);
}
