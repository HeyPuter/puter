import * as utils from '../lib/utils.js';

const normalizeTTSProvider = (value) => {
    if ( typeof value !== 'string' ) {
        return 'aws-polly';
    }
    const lower = value.toLowerCase();
    if ( lower === 'openai' ) return 'openai';
    if ( ['elevenlabs', 'eleven', '11labs', '11-labs', 'eleven-labs', 'elevenlabs-tts'].includes(lower) ) return 'elevenlabs';
    if ( lower === 'aws' || lower === 'polly' || lower === 'aws-polly' ) return 'aws-polly';
    return value;
};

const TOGETHER_VIDEO_MODEL_PREFIXES = [
    'minimax/',
    'google/',
    'bytedance/',
    'pixverse/',
    'kwaivgi/',
    'vidu/',
    'wan-ai/',
];

class AI {
    /**
     * Creates a new instance with the given authentication token, API origin, and app ID,
     *
     * @class
     * @param {string} authToken - Token used to authenticate the user.
     * @param {string} APIOrigin - Origin of the API server. Used to build the API endpoint URLs.
     * @param {string} appID - ID of the app to use.
     */
    constructor (puter) {
        this.puter = puter;
        this.authToken = puter.authToken;
        this.APIOrigin = puter.APIOrigin;
        this.appID = puter.appID;
    }

    /**
     * Sets a new authentication token and resets the socket connection with the updated token, if applicable.
     *
     * @param {string} authToken - The new authentication token.
     * @memberof [AI]
     * @returns {void}
     */
    setAuthToken (authToken) {
        this.authToken = authToken;
    }

    /**
     * Sets the API origin.
     *
     * @param {string} APIOrigin - The new API origin.
     * @memberof [AI]
     * @returns {void}
     */
    setAPIOrigin (APIOrigin) {
        this.APIOrigin = APIOrigin;
    }

    /**
     * Returns a list of available AI models.
     * @param {string} provider - The provider to filter the models returned.
     * @returns {Array} Array containing available model objects
     */
    async listModels (provider) {
        // Prefer the public API endpoint and fall back to the legacy driver call if needed.
        const headers = this.authToken ? { Authorization: `Bearer ${this.authToken}` } : {};

        const tryFetchModels = async () => {
            const resp = await fetch(`${this.APIOrigin }/puterai/chat/models/details`, { headers });
            if ( ! resp.ok ) return null;
            const data = await resp.json();
            const models = Array.isArray(data?.models) ? data.models : [];
            return provider ? models.filter(model => model.provider === provider) : models;
        };

        const tryDriverModels = async () => {
            const models = await puter.drivers.call('puter-chat-completion', 'ai-chat', 'models');
            const result = Array.isArray(models?.result) ? models.result : [];
            return provider ? result.filter(model => model.provider === provider) : result;
        };

        const models = await (async () => {
            try {
                const apiModels = await tryFetchModels();
                if ( apiModels !== null ) return apiModels;
            } catch (e) {
                // Ignore and fall back to the driver call below.
            }
            try {
                return await tryDriverModels();
            } catch (e) {
                return [];
            }
        })();

        return models;
    }

    /**
     * Returns a list of all available AI providers
     * @returns {Array} Array containing providers
     */
    async listModelProviders () {
        const models = await this.listModels();
        const providers = new Set();
        (models ?? []).forEach(item => {
            if ( item?.provider ) providers.add(item.provider);
        });
        return Array.from(providers);
    }

    img2txt = async (...args) => {
        const MAX_INPUT_SIZE = 10 * 1024 * 1024;
        if ( !args || args.length === 0 ) {
            throw { message: 'Arguments are required', code: 'arguments_required' };
        }

        const isBlobLike = (value) => {
            if ( typeof Blob === 'undefined' ) return false;
            return value instanceof Blob || (typeof File !== 'undefined' && value instanceof File);
        };
        const isPlainObject = (value) => value && typeof value === 'object' && !Array.isArray(value) && !isBlobLike(value);
        const normalizeProvider = (value) => {
            if ( ! value ) return 'aws-textract';
            const normalized = String(value).toLowerCase();
            if ( ['aws', 'textract', 'aws-textract'].includes(normalized) ) return 'aws-textract';
            if ( ['mistral', 'mistral-ocr'].includes(normalized) ) return 'mistral';
            return 'aws-textract';
        };

        let options = {};
        if ( isPlainObject(args[0]) ) {
            options = { ...args[0] };
        } else {
            options.source = args[0];
        }

        let testMode = false;
        for ( let i = 1; i < args.length; i++ ) {
            const value = args[i];
            if ( typeof value === 'boolean' ) {
                testMode = testMode || value;
            } else if ( isPlainObject(value) ) {
                options = { ...options, ...value };
            }
        }

        if ( typeof options.testMode === 'boolean' ) {
            testMode = options.testMode;
        }

        const provider = normalizeProvider(options.provider);
        delete options.provider;
        delete options.testMode;

        if ( ! options.source ) {
            throw { message: 'Source is required', code: 'source_required' };
        }

        if ( isBlobLike(options.source) ) {
            options.source = await utils.blobToDataUri(options.source);
        } else if ( options.source?.source && isBlobLike(options.source.source) ) {
            // Support shape { source: Blob }
            options.source = await utils.blobToDataUri(options.source.source);
        }

        if ( typeof options.source === 'string' &&
            options.source.startsWith('data:') &&
            options.source.length > MAX_INPUT_SIZE ) {
            throw { message: `Input size cannot be larger than ${ MAX_INPUT_SIZE}`, code: 'input_too_large' };
        }

        const toText = (result) => {
            if ( ! result ) return '';
            if ( Array.isArray(result.blocks) && result.blocks.length ) {
                let str = '';
                for ( const block of result.blocks ) {
                    if ( typeof block?.text !== 'string' ) continue;
                    if ( !block.type || block.type === 'text/textract:LINE' || block.type.startsWith('text/') ) {
                        str += `${block.text }\n`;
                    }
                }
                if ( str.trim() ) return str;
            }
            if ( Array.isArray(result.pages) && result.pages.length ) {
                const markdown = result.pages
                    .map(page => (page?.markdown || '').trim())
                    .filter(Boolean)
                    .join('\n\n');
                if ( markdown.trim() ) return markdown;
            }
            if ( typeof result.document_annotation === 'string' ) {
                return result.document_annotation;
            }
            if ( typeof result.text === 'string' ) {
                return result.text;
            }
            return '';
        };

        const driverCall = utils.make_driver_method(['source'], 'puter-ocr', provider, 'recognize', {
            test_mode: testMode ?? false,
            transform: async (result) => toText(result),
        });

        return await driverCall.call(this, options);
    };

    txt2speech = async (...args) => {
        let MAX_INPUT_SIZE = 3000;
        let options = {};
        let testMode = false;

        if ( ! args ) {
            throw ({ message: 'Arguments are required', code: 'arguments_required' });
        }

        // Accept arguments in the following formats:
        // 1. Shorthand API
        //      puter.ai.txt2speech("Hello world")
        // 2. Verbose API
        //      puter.ai.txt2speech("Hello world", {
        //           voice: "Joanna",
        //           engine: "neural",
        //           language: "en-US"
        //      })
        // 3. Positional arguments (Legacy)
        //      puter.ai.txt2speech(<text>, <language>, <voice>, <engine>)
        //      e.g:
        //      puter.ai.txt2speech("Hello world", "en-US")
        //      puter.ai.txt2speech("Hello world", "en-US", "Joanna")
        //      puter.ai.txt2speech("Hello world", "en-US", "Joanna", "neural")
        //
        // Undefined parameters will be set to default values:
        // - voice: "Joanna"
        // - engine: "standard"
        // - language: "en-US"

        if ( typeof args[0] === 'string' ) {
            options = { text: args[0] };
        }

        if ( args[1] && typeof args[1] === 'object' && !Array.isArray(args[1]) ) {
            // for verbose object API
            Object.assign(options, args[1]);
        } else if ( args[1] && typeof args[1] === 'string' ) {
            // for legacy positional-arguments API
            //
            // puter.ai.txt2speech(<text>, <language>, <voice>, <engine>)
            options.language = args[1];

            if ( args[2] && typeof args[2] === 'string' ) {
                options.voice = args[2];
            }

            if ( args[3] && typeof args[3] === 'string' ) {
                options.engine = args[3];
            }
        } else if ( args[1] && typeof args[1] !== 'boolean' ) {
            // If second argument is not an object, string, or boolean, throw an error
            throw { message: 'Second argument must be an options object or language string. Use: txt2speech("text", { voice: "name", engine: "type", language: "code" }) or txt2speech("text", "language", "voice", "engine")', code: 'invalid_arguments' };
        }

        // Validate required text parameter
        if ( ! options.text ) {
            throw { message: 'Text parameter is required', code: 'text_required' };
        }

        const validEngines = ['standard', 'neural', 'long-form', 'generative'];
        let provider = normalizeTTSProvider(options.provider);

        if ( options.engine && normalizeTTSProvider(options.engine) === 'openai' && !options.provider ) {
            provider = 'openai';
        }

        if ( options.engine && normalizeTTSProvider(options.engine) === 'elevenlabs' && !options.provider ) {
            provider = 'elevenlabs';
        }

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
        } else {
            provider = 'aws-polly';

            if ( options.engine && !validEngines.includes(options.engine) ) {
                throw { message: `Invalid engine. Must be one of: ${ validEngines.join(', ')}`, code: 'invalid_engine' };
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

        // check input size
        if ( options.text.length > MAX_INPUT_SIZE ) {
            throw { message: `Input size cannot be larger than ${ MAX_INPUT_SIZE}`, code: 'input_too_large' };
        }

        // determine if test mode is enabled (check all arguments for boolean true)
        for ( let i = 0; i < args.length; i++ ) {
            if ( typeof args[i] === 'boolean' && args[i] === true ) {
                testMode = true;
                break;
            }
        }

        const driverName = provider === 'openai'
            ? 'openai-tts'
            : (provider === 'elevenlabs' ? 'elevenlabs-tts' : 'aws-polly');

        return await utils.make_driver_method(['source'], 'puter-tts', driverName, 'synthesize', {
            responseType: 'blob',
            test_mode: testMode ?? false,
            transform: async (result) => {
                let url;
                if ( typeof result === 'string' ) {
                    url = result;
                } else if ( result instanceof Blob ) {
                    url = await utils.blob_to_url(result);
                } else if ( result instanceof ArrayBuffer ) {
                    const blob = new Blob([result]);
                    url = await utils.blob_to_url(blob);
                } else if ( result && typeof result === 'object' && typeof result.arrayBuffer === 'function' ) {
                    const arrayBuffer = await result.arrayBuffer();
                    const blob = new Blob([arrayBuffer], { type: result.type || undefined });
                    url = await utils.blob_to_url(blob);
                } else {
                    throw { message: 'Unexpected audio response format', code: 'invalid_audio_response' };
                }
                const audio = new (globalThis.Audio || Object)();
                audio.src = url;
                audio.toString = () => url;
                audio.valueOf = () => url;
                return audio;
            },
        }).call(this, options);
    };

    speech2speech = async (...args) => {
        const MAX_INPUT_SIZE = 25 * 1024 * 1024;
        if ( !args || !args.length ) {
            throw ({ message: 'Arguments are required', code: 'arguments_required' });
        }

        const normalizeSource = async (value) => {
            if ( value instanceof Blob ) {
                return await utils.blobToDataUri(value);
            }
            return value;
        };

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

        let options = {};
        let testMode = false;

        const primary = args[0];
        if ( primary && typeof primary === 'object' && !Array.isArray(primary) && !(primary instanceof Blob) ) {
            options = { ...primary };
        } else {
            options.audio = await normalizeSource(primary);
        }

        if ( args[1] && typeof args[1] === 'object' && !Array.isArray(args[1]) && !(args[1] instanceof Blob) ) {
            options = { ...options, ...args[1] };
        } else if ( typeof args[1] === 'boolean' ) {
            testMode = args[1];
        }

        if ( typeof args[2] === 'boolean' ) {
            testMode = args[2];
        }

        if ( options.file ) {
            options.audio = await normalizeSource(options.file);
            delete options.file;
        }

        if ( options.audio instanceof Blob ) {
            options.audio = await normalizeSource(options.audio);
        }

        if ( ! options.audio ) {
            throw { message: 'Audio input is required', code: 'audio_required' };
        }

        if ( typeof options.audio === 'string' && options.audio.startsWith('data:') ) {
            const base64 = options.audio.split(',')[1] || '';
            const padding = base64.endsWith('==') ? 2 : (base64.endsWith('=') ? 1 : 0);
            const byteLength = Math.floor((base64.length * 3) / 4) - padding;
            if ( byteLength > MAX_INPUT_SIZE ) {
                throw { message: 'Input size cannot be larger than 25 MB', code: 'input_too_large' };
            }
        }

        const driverArgs = normalizeOptions({ ...options });
        delete driverArgs.provider;

        return await utils.make_driver_method(['audio'], 'puter-speech2speech', 'elevenlabs-voice-changer', 'convert', {
            responseType: 'blob',
            test_mode: testMode,
            transform: async (result) => {
                let url;
                if ( typeof result === 'string' ) {
                    url = result;
                } else if ( result instanceof Blob ) {
                    url = await utils.blob_to_url(result);
                } else if ( result instanceof ArrayBuffer ) {
                    const blob = new Blob([result]);
                    url = await utils.blob_to_url(blob);
                } else if ( result && typeof result === 'object' && typeof result.arrayBuffer === 'function' ) {
                    const arrayBuffer = await result.arrayBuffer();
                    const blob = new Blob([arrayBuffer], { type: result.type || undefined });
                    url = await utils.blob_to_url(blob);
                } else {
                    throw { message: 'Unexpected audio response format', code: 'invalid_audio_response' };
                }
                const audio = new Audio(url);
                audio.toString = () => url;
                audio.valueOf = () => url;
                return audio;
            },
        }).call(this, driverArgs);
    };

    speech2txt = async (...args) => {
        const MAX_INPUT_SIZE = 25 * 1024 * 1024;
        if ( !args || !args.length ) {
            throw ({ message: 'Arguments are required', code: 'arguments_required' });
        }

        const normalizeSource = async (value) => {
            if ( value instanceof Blob ) {
                return await utils.blobToDataUri(value);
            }
            return value;
        };

        let options = {};
        let testMode = false;

        const primary = args[0];
        if ( primary && typeof primary === 'object' && !Array.isArray(primary) && !(primary instanceof Blob) ) {
            options = { ...primary };
        } else {
            options.file = await normalizeSource(primary);
        }

        if ( args[1] && typeof args[1] === 'object' && !Array.isArray(args[1]) && !(args[1] instanceof Blob) ) {
            options = { ...options, ...args[1] };
        } else if ( typeof args[1] === 'boolean' ) {
            testMode = args[1];
        }

        if ( typeof args[2] === 'boolean' ) {
            testMode = args[2];
        }

        if ( options.audio ) {
            options.file = await normalizeSource(options.audio);
            delete options.audio;
        }

        if ( options.file instanceof Blob ) {
            options.file = await normalizeSource(options.file);
        }

        if ( ! options.file ) {
            throw { message: 'Audio input is required', code: 'audio_required' };
        }

        if ( typeof options.file === 'string' && options.file.startsWith('data:') ) {
            const base64 = options.file.split(',')[1] || '';
            const padding = base64.endsWith('==') ? 2 : (base64.endsWith('=') ? 1 : 0);
            const byteLength = Math.floor((base64.length * 3) / 4) - padding;
            if ( byteLength > MAX_INPUT_SIZE ) {
                throw { message: 'Input size cannot be larger than 25 MB', code: 'input_too_large' };
            }
        }

        const driverMethod = options.translate ? 'translate' : 'transcribe';
        const driverArgs = { ...options };
        delete driverArgs.translate;

        const responseFormat = driverArgs.response_format;

        return await utils.make_driver_method([], 'puter-speech2txt', 'openai-speech2txt', driverMethod, {
            test_mode: testMode,
            transform: async (result) => {
                if ( responseFormat === 'text' && result && typeof result === 'object' && typeof result.text === 'string' ) {
                    return result.text;
                }
                return result;
            },
        }).call(this, driverArgs);
    };

    // Add new methods for TTS engine management
    txt2speech = Object.assign(this.txt2speech, {
        /**
         * List available TTS engines with pricing information
         * @returns {Promise<Array>} Array of available engines
         */
        listEngines: async (options = {}) => {
            let provider = 'aws-polly';
            let params = {};

            if ( typeof options === 'string' ) {
                provider = normalizeTTSProvider(options);
            } else if ( options && typeof options === 'object' ) {
                provider = normalizeTTSProvider(options.provider) || provider;
                params = { ...options };
                delete params.provider;
            }

            if ( provider === 'openai' ) {
                params.provider = 'openai';
            }

            if ( provider === 'elevenlabs' ) {
                params.provider = 'elevenlabs';
            }

            const driverName = provider === 'openai'
                ? 'openai-tts'
                : (provider === 'elevenlabs' ? 'elevenlabs-tts' : 'aws-polly');

            return await utils.make_driver_method(['source'], 'puter-tts', driverName, 'list_engines', {
                responseType: 'text',
            }).call(this, params);
        },

        /**
         * List all available voices, optionally filtered by engine
         * @param {string} [engine] - Optional engine filter
         * @returns {Promise<Array>} Array of available voices
         */
        listVoices: async (options) => {
            let provider = 'aws-polly';
            let params = {};

            if ( typeof options === 'string' ) {
                params.engine = options;
            } else if ( options && typeof options === 'object' ) {
                provider = normalizeTTSProvider(options.provider) || provider;
                params = { ...options };
                delete params.provider;
            }

            if ( provider === 'openai' ) {
                params.provider = 'openai';
                delete params.engine;
            }

            if ( provider === 'elevenlabs' ) {
                params.provider = 'elevenlabs';
            }

            const driverName = provider === 'openai'
                ? 'openai-tts'
                : (provider === 'elevenlabs' ? 'elevenlabs-tts' : 'aws-polly');

            return utils.make_driver_method(['source'], 'puter-tts', driverName, 'list_voices', {
                responseType: 'text',
            }).call(this, params);
        },
    });

    // accepts either a string or an array of message objects
    // if string, it's treated as the prompt which is a shorthand for { messages: [{ content: prompt }] }
    // if object, it's treated as the full argument object that the API expects
    chat = async (...args) => {
        // requestParams: parameters that will be sent to the backend driver
        let requestParams = {};
        // userParams: parameters provided by the user in the function call
        let userParams = {};
        let testMode = false;

        // default driver is openai-completion
        let driver = 'ai-chat';

        // Check that the argument is not undefined or null
        if ( ! args ) {
            throw ({ message: 'Arguments are required', code: 'arguments_required' });
        }

        // ai.chat(prompt)
        if ( typeof args[0] === 'string' ) {
            requestParams = { messages: [{ content: args[0] }] };
        }

        // ai.chat(prompt, testMode)
        if ( typeof args[0] === 'string' && (!args[1] || typeof args[1] === 'boolean') ) {
            requestParams = { messages: [{ content: args[0] }] };
        }

        // ai.chat(prompt, imageURL/File)
        // ai.chat(prompt, imageURL/File, testMode)
        else if ( typeof args[0] === 'string' && (typeof args[1] === 'string' || args[1] instanceof File) ) {
            // if imageURL is a File, transform it to a data URI
            if ( args[1] instanceof File ) {
                args[1] = await utils.blobToDataUri(args[1]);
            }

            // parse args[1] as an image_url object
            requestParams = {
                vision: true,
                messages: [
                    {
                        content: [
                            args[0],
                            {
                                image_url: {
                                    url: args[1],
                                },
                            },
                        ],
                    },
                ],
            };
        }
        // chat(prompt, [imageURLs])
        else if ( typeof args[0] === 'string' && Array.isArray(args[1]) ) {
            // parse args[1] as an array of image_url objects
            for ( let i = 0; i < args[1].length; i++ ) {
                args[1][i] = { image_url: { url: args[1][i] } };
            }
            requestParams = {
                vision: true,
                messages: [
                    {
                        content: [
                            args[0],
                            ...args[1],
                        ],
                    },
                ],
            };
        }
        // chat([messages])
        else if ( Array.isArray(args[0]) ) {
            requestParams = { messages: args[0] };
        }

        // determine if testMode is enabled
        if ( typeof args[1] === 'boolean' && args[1] === true ||
            typeof args[2] === 'boolean' && args[2] === true ||
            typeof args[3] === 'boolean' && args[3] === true ) {
            testMode = true;
        }

        // if any of the args is an object, assume it's the user parameters object
        const is_object = v => {
            return typeof v === 'object' &&
                !Array.isArray(v) &&
                v !== null;
        };
        for ( let i = 0; i < args.length; i++ ) {
            if ( is_object(args[i]) ) {
                userParams = args[i];
                break;
            }
        }

        // Copy relevant parameters from userParams to requestParams
        if ( userParams.model ) {
            requestParams.model = userParams.model;
        }
        if ( userParams.temperature ) {
            requestParams.temperature = userParams.temperature;
        }
        if ( userParams.max_tokens ) {
            requestParams.max_tokens = userParams.max_tokens;
        }

        if ( userParams.provider ) {
            requestParams.provider = userParams.provider;
        }

        // convert undefined to empty string so that .startsWith works
        requestParams.model = requestParams.model ?? '';

        // stream flag from userParams
        if ( userParams.stream !== undefined && typeof userParams.stream === 'boolean' ) {
            requestParams.stream = userParams.stream;
        }

        if ( userParams.driver ) {
            requestParams.provider = requestParams.provider || userParams.driver;
        }

        // Additional parameters to pass from userParams to requestParams
        const PARAMS_TO_PASS = ['tools', 'response', 'reasoning', 'reasoning_effort', 'text', 'verbosity', 'provider'];
        for ( const name of PARAMS_TO_PASS ) {
            if ( userParams[name] ) {
                requestParams[name] = userParams[name];
            }
        }

        if ( requestParams.model === '' ) {
            delete requestParams.model;
        }

        // Call the original chat.complete method
        return await utils.make_driver_method(['messages'], 'puter-chat-completion', driver, 'complete', {
            test_mode: testMode ?? false,
            transform: async (result) => {
                result.toString = () => {
                    return result.message?.content;
                };

                result.valueOf = () => {
                    return result.message?.content;
                };

                return result;
            },
        }).call(this, requestParams);
    };

    /**
     * Generate images from text prompts or perform image-to-image generation
     *
     * @param {string|object} prompt - Text prompt or options object
     * @param {object|boolean} [options] - Generation options or test mode flag
     * @param {string} [options.prompt] - Text description of the image to generate
     * @param {string} [options.model] - Model to use (e.g., "gemini-2.5-flash-image-preview")
     * @param {object} [options.ratio] - Image dimensions (e.g., {w: 1024, h: 1024})
     * @param {string} [options.input_image] - Base64 encoded input image for image-to-image generation
     * @param {string} [options.input_image_mime_type] - MIME type of input image (e.g., "image/png")
     * @returns {Promise<Image>} Generated image object with src property
     *
     * @example
     * // Text-to-image
     * const img = await puter.ai.txt2img("A beautiful sunset");
     *
     * @example
     * // Image-to-image
     * const img = await puter.ai.txt2img({
     *   prompt: "Transform this into a watercolor painting",
     *   input_image: base64ImageData,
     *   input_image_mime_type: "image/png",
     *   model: "gemini-2.5-flash-image-preview"
     * });
     */
    txt2img = async (...args) => {
        let options = {};
        let testMode = false;

        if ( ! args ) {
            throw ({ message: 'Arguments are required', code: 'arguments_required' });
        }

        // if argument is string transform it to the object that the API expects
        if ( typeof args[0] === 'string' ) {
            options = { prompt: args[0] };
        }

        // if second argument is string, it's the `testMode`
        if ( typeof args[1] === 'boolean' && args[1] === true ) {
            testMode = true;
        }

        if ( typeof args[0] === 'string' && typeof args[1] === 'object' ) {
            options = args[1];
            options.prompt = args[0];
        }

        if ( typeof args[0] === 'object' ) {
            options = args[0];
        }

        let AIService = 'openai-image-generation';
        if ( options.model === 'nano-banana' )
        {
            options.model = 'gemini-2.5-flash-image-preview';
        }

        if ( options.model === 'nano-banana-pro' ) {
            options.model = 'gemini-3-pro-image-preview';
        }

        const driverHint = typeof options.driver === 'string' ? options.driver : undefined;

        if ( driverHint ) {
            AIService = driverHint;
        } else {
            AIService = 'ai-image';
        }
        // Call the original chat.complete method
        return await utils.make_driver_method(['prompt'], 'puter-image-generation', AIService, 'generate', {
            responseType: 'blob',
            test_mode: testMode ?? false,
            transform: async result => {
                let url;
                if ( typeof result === 'string' ) {
                    url = result;
                } else if ( result instanceof Blob ) {
                    url = await utils.blob_to_url(result);
                } else if ( result instanceof ArrayBuffer ) {
                    const blob = new Blob([result]);
                    url = await utils.blob_to_url(blob);
                } else if ( result && typeof result === 'object' && typeof result.arrayBuffer === 'function' ) {
                    const arrayBuffer = await result.arrayBuffer();
                    const blob = new Blob([arrayBuffer], { type: result.type || undefined });
                    url = await utils.blob_to_url(blob);
                } else {
                    throw { message: 'Unexpected image response format', code: 'invalid_image_response' };
                }
                let img = new (globalThis.Image || Object)();
                img.src = url;
                img.toString = () => img.src;
                img.valueOf = () => img.src;
                return img;
            },
        }).call(this, options);
    };

    txt2vid = async (...args) => {
        let options = {};
        let testMode = false;

        if ( ! args ) {
            throw ({ message: 'Arguments are required', code: 'arguments_required' });
        }

        if ( typeof args[0] === 'string' ) {
            options = { prompt: args[0] };
        }

        if ( typeof args[1] === 'boolean' && args[1] === true ) {
            testMode = true;
        }

        if ( typeof args[0] === 'string' && typeof args[1] === 'object' ) {
            options = args[1];
            options.prompt = args[0];
        }

        if ( typeof args[0] === 'object' ) {
            options = args[0];
        }

        if ( ! options.prompt ) {
            throw ({ message: 'Prompt parameter is required', code: 'prompt_required' });
        }

        if ( ! options.model ) {
            options.model = 'sora-2';
        }

        if ( options.duration !== undefined && options.seconds === undefined ) {
            options.seconds = options.duration;
        }

        // This sucks, should be backend's job like we do for chat models now
        let videoService = 'openai-video-generation';
        const driverHint = typeof options.driver === 'string' ? options.driver : undefined;
        const driverHintLower = driverHint ? driverHint.toLowerCase() : undefined;
        const providerRaw = typeof options.provider === 'string'
            ? options.provider
            : (typeof options.service === 'string' ? options.service : undefined);
        const providerHint = typeof providerRaw === 'string' ? providerRaw.toLowerCase() : undefined;
        const modelLower = typeof options.model === 'string' ? options.model.toLowerCase() : '';

        const looksLikeTogetherVideoModel = typeof options.model === 'string' &&
            (TOGETHER_VIDEO_MODEL_PREFIXES.some(prefix => modelLower.startsWith(prefix)) || options.model.startsWith('togetherai:'));

        if ( driverHintLower === 'together' || driverHintLower === 'together-ai' ) {
            videoService = 'together-video-generation';
        } else if ( driverHintLower === 'together-video-generation' ) {
            videoService = 'together-video-generation';
        } else if ( driverHintLower === 'openai' ) {
            videoService = 'openai-video-generation';
        } else if ( driverHint ) {
            videoService = driverHint;
        } else if ( providerHint === 'together' || providerHint === 'together-ai' ) {
            videoService = 'together-video-generation';
        } else if ( looksLikeTogetherVideoModel ) {
            videoService = 'together-video-generation';
        }

        return await utils.make_driver_method(['prompt'], 'puter-video-generation', videoService, 'generate', {
            responseType: 'blob',
            test_mode: testMode ?? false,
            transform: async result => {
                let sourceUrl = null;
                let mimeType = null;
                if ( result instanceof Blob ) {
                    sourceUrl = await utils.blob_to_url(result);
                    mimeType = result.type || 'video/mp4';
                } else if ( typeof result === 'string' ) {
                    sourceUrl = result;
                } else if ( result && typeof result === 'object' ) {
                    sourceUrl = result.asset_url || result.url || result.href || null;
                    mimeType = result.mime_type || result.content_type || null;
                }

                if ( ! sourceUrl ) {
                    return result;
                }

                const video = (globalThis.document?.createElement('video') || { setAttribute: () => {
                } });
                video.src = sourceUrl;
                video.controls = true;
                video.preload = 'metadata';
                if ( mimeType ) {
                    video.setAttribute('data-mime-type', mimeType);
                }
                video.setAttribute('data-source', sourceUrl);
                video.toString = () => video.src;
                video.valueOf = () => video.src;
                return video;
            },
        }).call(this, options);
    };
}

export default AI;
