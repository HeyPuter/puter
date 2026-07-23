import * as utils from '../../lib/utils.js';
import { dataUriByteLength, isPlainObject, toDataUriIfBlob } from './lib/args.js';

/** @typedef {import('../../../types/modules/ai').Speech2TxtOptions} Speech2TxtOptions */
/** @typedef {import('../../../types/modules/ai').Speech2TxtResult} Speech2TxtResult */
/** @typedef {import('../../../types/modules/ai').TextFormatSpeech2TxtOptions} TextFormatSpeech2TxtOptions */

const MAX_INPUT_SIZE = 25 * 1024 * 1024;

const STT_DRIVER_NAMES = {
    'xai': 'xai-speech2txt',
    'grok': 'xai-speech2txt',
    'x-ai': 'xai-speech2txt',
};

/**
 * @overload
 * @param {string | File | Blob} source
 * @param {boolean} [testMode]
 * @returns {Promise<Speech2TxtResult>}
 */
/**
 * @overload
 * @param {string | File | Blob} source
 * @param {TextFormatSpeech2TxtOptions} options
 * @param {boolean} [testMode]
 * @returns {Promise<string>}
 */
/**
 * @overload
 * @param {string | File | Blob} source
 * @param {Speech2TxtOptions} options
 * @param {boolean} [testMode]
 * @returns {Promise<Speech2TxtResult>}
 */
/**
 * @overload
 * @param {TextFormatSpeech2TxtOptions} options
 * @param {boolean} [testMode]
 * @returns {Promise<string>}
 */
/**
 * @overload
 * @param {Speech2TxtOptions} options
 * @param {boolean} [testMode]
 * @returns {Promise<Speech2TxtResult>}
 */
/**
 * Documented forms:
 *   speech2txt(audio, [testMode])
 *   speech2txt(audio, [options], [testMode])
 *   speech2txt({ file | audio, translate, provider, ... }, [testMode])
 * Resolves to the transcription result, or its bare text when
 * `response_format: 'text'` is requested.
 *
 * @this {import('./index.js').AIModule}
 * @param {string | File | Blob | Speech2TxtOptions} [audioOrOptions]
 * @param {Speech2TxtOptions | boolean} [optionsOrTestMode]
 * @param {boolean} [testModeFlag]
 * @returns {Promise<Speech2TxtResult | string>}
 */
export async function speech2txt (audioOrOptions, optionsOrTestMode, testModeFlag) {
    const { puter } = this;
    if ( audioOrOptions === undefined && optionsOrTestMode === undefined && testModeFlag === undefined ) {
        throw ({ message: 'Arguments are required', code: 'arguments_required' });
    }

    /** @type {Speech2TxtOptions} */
    let options = {};
    let testMode = false;

    if ( isPlainObject(audioOrOptions) ) {
        options = { ...audioOrOptions };
    } else {
        options.file = await toDataUriIfBlob(audioOrOptions);
    }

    if ( isPlainObject(optionsOrTestMode) ) {
        options = { ...options, ...optionsOrTestMode };
    } else if ( typeof optionsOrTestMode === 'boolean' ) {
        testMode = optionsOrTestMode;
    }

    if ( typeof testModeFlag === 'boolean' ) {
        testMode = testModeFlag;
    }

    // `audio` is accepted as an alias of `file`
    if ( options.audio ) {
        options.file = await toDataUriIfBlob(options.audio);
        delete options.audio;
    }

    if ( options.file instanceof Blob ) {
        options.file = await toDataUriIfBlob(options.file);
    }

    if ( ! options.file ) {
        throw { message: 'Audio input is required', code: 'audio_required' };
    }

    if ( typeof options.file === 'string' && options.file.startsWith('data:') ) {
        if ( dataUriByteLength(options.file) > MAX_INPUT_SIZE ) {
            throw { message: 'Input size cannot be larger than 25 MB', code: 'input_too_large' };
        }
    }

    const driverMethod = options.translate ? 'translate' : 'transcribe';
    const driverArgs = { ...options };
    delete driverArgs.translate;

    const sttProvider = driverArgs.provider;
    delete driverArgs.provider;

    const sttDriverName = (sttProvider && STT_DRIVER_NAMES[sttProvider.toLowerCase()]) || 'openai-speech2txt';

    const responseFormat = driverArgs.response_format;

    return await utils.make_driver_method([], 'puter-speech2txt', sttDriverName, driverMethod, {
        puter,
        test_mode: testMode,
        transform: async (result) => {
            if ( responseFormat === 'text' && result && typeof result === 'object' && typeof result.text === 'string' ) {
                return result.text;
            }
            return result;
        },
    })(driverArgs);
}
