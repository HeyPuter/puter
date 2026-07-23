import * as utils from '../../lib/utils.js';
import { hasTestModeFlag } from './lib/args.js';
import { toAudioElement } from './lib/media.js';
import { normalizeTTSProvider, ttsDriverName } from './lib/ttsProviders.js';

/** @typedef {import('../../../types/modules/ai').ListTTSEnginesOptions} ListTTSEnginesOptions */
/** @typedef {import('../../../types/modules/ai').ListTTSVoicesOptions} ListTTSVoicesOptions */
/** @typedef {import('../../../types/modules/ai').TTSEngine} TTSEngine */
/** @typedef {import('../../../types/modules/ai').TTSVoice} TTSVoice */
/** @typedef {import('../../../types/modules/ai').Txt2SpeechOptions} Txt2SpeechOptions */

const MAX_INPUT_SIZE = 3000;
const VALID_AWS_ENGINES = ['standard', 'neural', 'long-form', 'generative'];
const NAMED_PROVIDERS = ['openai', 'elevenlabs', 'gemini', 'xai'];

// Fill in each provider's defaults and rename options to what its driver
// expects. Mutates `options`; returns the effective provider.
const applyProviderDefaults = (provider, options) => {
    if ( provider === 'openai' ) {
        if ( !options.model && typeof options.engine === 'string' ) {
            options.model = options.engine;
        }
        if ( ! options.voice ) {
            options.voice = 'alloy';
        }
        if ( ! options.model ) {
            options.model = 'gpt-4o-mini-tts';
        }
        if ( ! options.response_format ) {
            options.response_format = 'mp3';
        }
        delete options.engine;
    } else if ( provider === 'elevenlabs' ) {
        if ( ! options.voice ) {
            options.voice = '21m00Tcm4TlvDq8ikWAM';
        }
        if ( !options.model && typeof options.engine === 'string' ) {
            options.model = options.engine;
        }
        if ( ! options.model ) {
            options.model = 'eleven_multilingual_v2';
        }
        if ( !options.output_format && !options.response_format ) {
            options.output_format = 'mp3_44100_128';
        }
        if ( options.response_format && !options.output_format ) {
            options.output_format = options.response_format;
        }
        delete options.engine;
    } else if ( provider === 'gemini' ) {
        if ( !options.model && typeof options.engine === 'string' ) {
            options.model = options.engine;
        }
        if ( ! options.voice ) {
            options.voice = 'Kore';
        }
        if ( ! options.model ) {
            options.model = 'gemini-2.5-flash-preview-tts';
        }
        delete options.engine;
    } else if ( provider === 'xai' ) {
        if ( ! options.voice ) {
            options.voice = 'eve';
        }
        if ( ! options.language ) {
            options.language = 'en';
        }
        delete options.engine;
    } else {
        provider = 'aws-polly';

        if ( options.engine && !VALID_AWS_ENGINES.includes(options.engine) ) {
            throw { message: `Invalid engine. Must be one of: ${ VALID_AWS_ENGINES.join(', ')}`, code: 'invalid_engine' };
        }

        if ( ! options.voice ) {
            options.voice = 'Joanna';
        }
        if ( ! options.engine ) {
            options.engine = 'standard';
        }
        if ( ! options.language ) {
            options.language = 'en-US';
        }
    }
    return provider;
};

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

    let provider = normalizeTTSProvider(options.provider);

    // An engine that names a provider (e.g. engine: 'openai') selects that
    // provider when none was given explicitly.
    if ( !options.provider && options.engine ) {
        const engineProvider = normalizeTTSProvider(options.engine);
        if ( NAMED_PROVIDERS.includes(engineProvider) ) {
            provider = engineProvider;
        }
    }

    provider = applyProviderDefaults(provider, options);

    if ( options.text.length > MAX_INPUT_SIZE ) {
        throw { message: `Input size cannot be larger than ${ MAX_INPUT_SIZE}`, code: 'input_too_large' };
    }

    return await utils.make_driver_method(['source'], 'puter-tts', ttsDriverName(provider), 'synthesize', {
        puter,
        responseType: 'blob',
        test_mode: hasTestModeFlag([optionsOrLanguage, voice, engine, testModeFlag]),
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
    let provider = 'aws-polly';
    /** @type {{ provider?: string }} */
    let params = {};

    if ( typeof options === 'string' ) {
        provider = normalizeTTSProvider(options);
    } else if ( options && typeof options === 'object' ) {
        provider = normalizeTTSProvider(options.provider) || provider;
        params = { ...options };
        delete params.provider;
    }

    if ( NAMED_PROVIDERS.includes(provider) ) {
        params.provider = provider;
    }

    return await utils.make_driver_method(['source'], 'puter-tts', ttsDriverName(provider), 'list_engines', {
        puter,
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
    let provider = 'aws-polly';
    /** @type {{ provider?: string, engine?: string }} */
    let params = {};

    if ( typeof options === 'string' ) {
        params.engine = options;
    } else if ( options && typeof options === 'object' ) {
        provider = normalizeTTSProvider(options.provider) || provider;
        params = { ...options };
        delete params.provider;
    }

    if ( NAMED_PROVIDERS.includes(provider) ) {
        params.provider = provider;
        // Of the named providers only the elevenlabs driver accepts an
        // engine filter; aws-polly (the default) accepts one too.
        if ( provider !== 'elevenlabs' ) {
            delete params.engine;
        }
    }

    return utils.make_driver_method(['source'], 'puter-tts', ttsDriverName(provider), 'list_voices', {
        puter,
        responseType: 'text',
    })(params);
}
