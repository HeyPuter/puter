import * as utils from '../../lib/utils.js';
import { hasTestModeFlag } from './lib/args.js';
import { toAudioElement } from './lib/media.js';

/** @typedef {import('../../../types/modules/ai').ListTTSEnginesOptions} ListTTSEnginesOptions */
/** @typedef {import('../../../types/modules/ai').ListTTSVoicesOptions} ListTTSVoicesOptions */
/** @typedef {import('../../../types/modules/ai').TTSEngine} TTSEngine */
/** @typedef {import('../../../types/modules/ai').TTSVoice} TTSVoice */
/** @typedef {import('../../../types/modules/ai').Txt2SpeechOptions} Txt2SpeechOptions */

const MAX_INPUT_SIZE = 3000;

// The unified TTS driver picks the provider from `options.provider` (or from
// an `engine` that names one) and applies that provider's defaults.
const TTS_DRIVER = 'ai-tts';

/**
 * @overload
 * @param {string} text
 * @param {boolean} [testMode]
 * @returns {Promise<HTMLAudioElement>}
 */
/**
 * @overload
 * @param {string} text
 * @param {Txt2SpeechOptions} options
 * @param {boolean} [testMode]
 * @returns {Promise<HTMLAudioElement>}
 */
/**
 * @overload
 * @param {string} text
 * @param {string} language
 * @param {boolean} [testMode]
 * @returns {Promise<HTMLAudioElement>}
 */
/**
 * @overload
 * @param {string} text
 * @param {string} language
 * @param {string} voice
 * @param {boolean} [testMode]
 * @returns {Promise<HTMLAudioElement>}
 */
/**
 * @overload
 * @param {string} text
 * @param {string} language
 * @param {string} voice
 * @param {string} engine
 * @param {boolean} [testMode]
 * @returns {Promise<HTMLAudioElement>}
 */
/**
 * Documented forms:
 *   txt2speech(text, [testMode])                                — shorthand
 *   txt2speech(text, { voice, engine, language }, [testMode])   — verbose
 *   txt2speech(text, language, [voice], [engine], [testMode])   — legacy positional
 * A boolean `true` in any trailing slot enables test mode.
 *
 * @this {import('./index.js').AIModule}
 * @param {string} [text]
 * @param {Txt2SpeechOptions | string | boolean} [optionsOrLanguage]
 * @param {string | boolean} [voice]
 * @param {string | boolean} [engine]
 * @param {boolean} [testModeFlag]
 * @returns {Promise<HTMLAudioElement>}
 */
export async function txt2speech (text, optionsOrLanguage, voice, engine, testModeFlag) {
    const { puter } = this;
    /** @type {Txt2SpeechOptions} */
    let options = {};

    if ( typeof text === 'string' ) {
        options = { text };
    }

    if ( optionsOrLanguage && typeof optionsOrLanguage === 'object' && !Array.isArray(optionsOrLanguage) ) {
        // verbose object API
        Object.assign(options, optionsOrLanguage);
    } else if ( optionsOrLanguage && typeof optionsOrLanguage === 'string' ) {
        // legacy positional-arguments API
        options.language = optionsOrLanguage;

        if ( voice && typeof voice === 'string' ) {
            options.voice = voice;
        }

        if ( engine && typeof engine === 'string' ) {
            options.engine = engine;
        }
    } else if ( optionsOrLanguage && typeof optionsOrLanguage !== 'boolean' ) {
        throw { message: 'Second argument must be an options object or language string. Use: txt2speech("text", { voice: "name", engine: "type", language: "code" }) or txt2speech("text", "language", "voice", "engine")', code: 'invalid_arguments' };
    }

    if ( ! options.text ) {
        throw { message: 'Text parameter is required', code: 'text_required' };
    }

    if ( options.text.length > MAX_INPUT_SIZE ) {
        throw { message: `Input size cannot be larger than ${ MAX_INPUT_SIZE}`, code: 'input_too_large' };
    }

    return await utils.makeDriverMethod({
        iface: 'puter-tts',
        driver: TTS_DRIVER,
        method: 'synthesize',
        argNames: ['source'],
        puter,
        responseType: 'blob',
        testMode: hasTestModeFlag([optionsOrLanguage, voice, engine, testModeFlag]),
        transform: toAudioElement,
    })(options);
}

/**
 * @overload
 * @param {string} [provider]
 * @returns {Promise<TTSEngine[]>}
 */
/**
 * @overload
 * @param {ListTTSEnginesOptions} [options]
 * @returns {Promise<TTSEngine[]>}
 */
/**
 * List available TTS engines with pricing information.
 *
 * @this {import('./index.js').AIModule}
 * @param {ListTTSEnginesOptions | string} [options]
 * @returns {Promise<TTSEngine[]>}
 */
export async function listEngines (options = {}) {
    const { puter } = this;
    /** @type {{ provider?: string }} */
    const params = typeof options === 'string' ? { provider: options } : { ...options };

    return await utils.makeDriverMethod({
        iface: 'puter-tts',
        driver: TTS_DRIVER,
        method: 'list_engines',
        argNames: ['source'],
        puter,
        readonly: true,
        responseType: 'text',
    })(params);
}

/**
 * @overload
 * @param {string} [engine]
 * @returns {Promise<TTSVoice[]>}
 */
/**
 * @overload
 * @param {ListTTSVoicesOptions} [options]
 * @returns {Promise<TTSVoice[]>}
 */
/**
 * List all available voices, optionally filtered by engine.
 *
 * @this {import('./index.js').AIModule}
 * @param {ListTTSVoicesOptions | string} [options]
 * @returns {Promise<TTSVoice[]>}
 */
export async function listVoices (options) {
    const { puter } = this;
    /** @type {{ provider?: string, engine?: string }} */
    const params = typeof options === 'string' ? { engine: options } : { ...options };

    return utils.makeDriverMethod({
        iface: 'puter-tts',
        driver: TTS_DRIVER,
        method: 'list_voices',
        argNames: ['source'],
        puter,
        readonly: true,
        responseType: 'text',
    })(params);
}
