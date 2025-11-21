import * as utils from '../lib/utils.js';

const normalizeTTSProvider = (value) => {
    if ( typeof value !== 'string' ) {
        return 'aws-polly';
    }
    const lower = value.toLowerCase();
    if ( lower === 'openai' ) return 'openai';
    if ( lower === 'aws' || lower === 'polly' || lower === 'aws-polly' ) return 'aws-polly';
    return value;
};

const TOGETHER_IMAGE_MODEL_PREFIXES = [
    'black-forest-labs/',
    'stabilityai/',
    'togethercomputer/',
    'playgroundai/',
    'runwayml/',
    'lightricks/',
    'sg161222/',
    'wavymulder/',
    'prompthero/',
];

const TOGETHER_IMAGE_MODEL_KEYWORDS = [
    'flux',
    'kling',
    'sd3',
    'stable-diffusion',
    'kolors',
];

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
    constructor (context) {
        this.authToken = context.authToken;
        this.APIOrigin = context.APIOrigin;
        this.appID = context.appID;
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
     * @returns {Object} Object containing lists of available models by provider
     */
    async listModels (provider) {
        const modelsByProvider = {};

        const models = await puter.drivers.call('puter-chat-completion', 'ai-chat', 'models');

        if ( !models || !models.result || !Array.isArray(models.result) ) {
            return modelsByProvider;
        }
        models.result.forEach(item => {
            if ( !item.provider || !item.id ) return;
            if ( provider && item.provider !== provider ) return;
            if ( ! modelsByProvider[item.provider] ) modelsByProvider[item.provider] = [];
            modelsByProvider[item.provider].push(item.id);
        });

        return modelsByProvider;
    }

    /**
     * Returns a list of all available AI providers
     * @returns {Array} Array containing providers
     */
    async listModelProviders () {
        let providers = [];
        const models = await puter.drivers.call('puter-chat-completion', 'ai-chat', 'models');

        if ( !models || !models.result || !Array.isArray(models.result) ) return providers; // if models is invalid then return empty array
        providers = new Set(); // Use a Set to store unique providers
        models.result.forEach(item => {
            if ( item.provider ) providers.add(item.provider);
        });
        providers = Array.from(providers); // Convert Set to an array
        return providers;
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

        const driverName = provider === 'openai' ? 'openai-tts' : 'aws-polly';

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
                const audio = new Audio(url);
                audio.toString = () => url;
                audio.valueOf = () => url;
                return audio;
            },
        }).call(this, options);
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

            const driverName = provider === 'openai' ? 'openai-tts' : 'aws-polly';

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

            const driverName = provider === 'openai' ? 'openai-tts' : 'aws-polly';

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
        let driver = 'openai-completion';

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

        // convert undefined to empty string so that .startsWith works
        requestParams.model = requestParams.model ?? '';

        // If model starts with "anthropic/", remove it
        // later on we should standardize the model names to [vendor]/[model]
        // for example: "claude-3-5-sonnet" should become "anthropic/claude-3-5-sonnet"
        // but for now, we want to keep the old behavior
        // so we remove the "anthropic/" prefix if it exists
        if ( requestParams.model && requestParams.model.startsWith('anthropic/') ) {
            requestParams.model = requestParams.model.replace('anthropic/', '');
        }

        // convert to the correct model name if necessary
        if ( requestParams.model === 'claude-3-5-sonnet' ) {
            requestParams.model = 'claude-3-5-sonnet-latest';
        }
        if ( requestParams.model === 'claude-3-7-sonnet' || requestParams.model === 'claude' ) {
            requestParams.model = 'claude-3-7-sonnet-latest';
        }
        if ( requestParams.model === 'claude-sonnet-4' || requestParams.model === 'claude-sonnet-4-latest' ) {
            requestParams.model = 'claude-sonnet-4-20250514';
        }
        if ( requestParams.model === 'claude-opus-4' || requestParams.model === 'claude-opus-4-latest' ) {
            requestParams.model = 'claude-opus-4-20250514';
        }
        if ( requestParams.model === 'mistral' ) {
            requestParams.model = 'mistral-large-latest';
        }
        if ( requestParams.model === 'groq' ) {
            requestParams.model = 'llama3-8b-8192';
        }
        if ( requestParams.model === 'deepseek' ) {
            requestParams.model = 'deepseek-chat';
        }

        // o1-mini to openrouter:openai/o1-mini
        if ( requestParams.model === 'o1-mini' ) {
            requestParams.model = 'openrouter:openai/o1-mini';
        }

        // if a model is prepended with "openai/", remove it
        if ( requestParams.model && requestParams.model.startsWith('openai/') ) {
            requestParams.model = requestParams.model.replace('openai/', '');
            driver = 'openai-completion';
        }

        // if model starts with:
        //      agentica-org/
        //      ai21/
        //      aion-labs/
        //      alfredpros/
        //      alpindale/
        //      amazon/
        //      anthracite-org/
        //      arcee-ai/
        //      arliai/
        //      baidu/
        //      bytedance/
        //      cognitivecomputations/
        //      cohere/
        //      deepseek/
        //      eleutherai/
        //      google/
        //      gryphe/
        //      inception/
        //      infermatic/
        //      liquid/
        //      mancer/
        //      meta-llama/
        //      microsoft/
        //      minimax/
        //      mistralai/
        //      moonshotai/
        //      morph/
        //      neversleep/
        //      nousresearch/
        //      nvidia/
        //      openrouter/
        //      perplexity/
        //      pygmalionai/
        //      qwen/
        //      raifle/
        //      rekaai/
        //      sao10k/
        //      sarvamai/
        //      scb10x/
        //      shisa-ai/
        //      sophosympatheia/
        //      switchpoint/
        //      tencent/
        //      thedrummer/
        //      thudm/
        //      tngtech/
        //      undi95/
        //      x-ai/
        //      z-ai/

        // prepend it with openrouter:
        if (
            requestParams.model.startsWith('agentica-org/') ||
            requestParams.model.startsWith('ai21/') ||
            requestParams.model.startsWith('aion-labs/') ||
            requestParams.model.startsWith('alfredpros/') ||
            requestParams.model.startsWith('alpindale/') ||
            requestParams.model.startsWith('amazon/') ||
            requestParams.model.startsWith('anthracite-org/') ||
            requestParams.model.startsWith('arcee-ai/') ||
            requestParams.model.startsWith('arliai/') ||
            requestParams.model.startsWith('baidu/') ||
            requestParams.model.startsWith('bytedance/') ||
            requestParams.model.startsWith('cognitivecomputations/') ||
            requestParams.model.startsWith('cohere/') ||
            requestParams.model.startsWith('deepseek/') ||
            requestParams.model.startsWith('eleutherai/') ||
            requestParams.model.startsWith('google/') ||
            requestParams.model.startsWith('gryphe/') ||
            requestParams.model.startsWith('inception/') ||
            requestParams.model.startsWith('infermatic/') ||
            requestParams.model.startsWith('liquid/') ||
            requestParams.model.startsWith('mancer/') ||
            requestParams.model.startsWith('meta-llama/') ||
            requestParams.model.startsWith('microsoft/') ||
            requestParams.model.startsWith('minimax/') ||
            requestParams.model.startsWith('mistralai/') ||
            requestParams.model.startsWith('moonshotai/') ||
            requestParams.model.startsWith('morph/') ||
            requestParams.model.startsWith('neversleep/') ||
            requestParams.model.startsWith('nousresearch/') ||
            requestParams.model.startsWith('nvidia/') ||
            requestParams.model.startsWith('openrouter/') ||
            requestParams.model.startsWith('perplexity/') ||
            requestParams.model.startsWith('pygmalionai/') ||
            requestParams.model.startsWith('qwen/') ||
            requestParams.model.startsWith('raifle/') ||
            requestParams.model.startsWith('rekaai/') ||
            requestParams.model.startsWith('sao10k/') ||
            requestParams.model.startsWith('sarvamai/') ||
            requestParams.model.startsWith('scb10x/') ||
            requestParams.model.startsWith('shisa-ai/') ||
            requestParams.model.startsWith('sophosympatheia/') ||
            requestParams.model.startsWith('switchpoint/') ||
            requestParams.model.startsWith('tencent/') ||
            requestParams.model.startsWith('thedrummer/') ||
            requestParams.model.startsWith('thudm/') ||
            requestParams.model.startsWith('tngtech/') ||
            requestParams.model.startsWith('undi95/') ||
            requestParams.model.startsWith('x-ai/') ||
            requestParams.model.startsWith('z-ai/')
        ) {
            requestParams.model = `openrouter:${ requestParams.model}`;
        }

        // map model to the appropriate driver
        if ( !requestParams.model || requestParams.model.startsWith('gpt-') ) {
            driver = 'openai-completion';
        } else if (
            requestParams.model.startsWith('claude-')
        ) {
            driver = 'claude';
        } else if ( requestParams.model === 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo' || requestParams.model === 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo' || requestParams.model === 'meta-llama/Meta-Llama-3.1-405B-Instruct-Turbo' || requestParams.model === 'google/gemma-2-27b-it' ) {
            driver = 'together-ai';
        } else if ( requestParams.model.startsWith('mistral-') || requestParams.model.startsWith('codestral-') || requestParams.model.startsWith('pixtral-') || requestParams.model.startsWith('magistral-') || requestParams.model.startsWith('devstral-') || requestParams.model.startsWith('mistral-ocr-') || requestParams.model.startsWith('open-mistral-') ) {
            driver = 'mistral';
        } else if ( [
            'distil-whisper-large-v3-en',
            'gemma2-9b-it',
            'gemma-7b-it',
            'llama-3.1-70b-versatile',
            'llama-3.1-8b-instant',
            'llama3-70b-8192',
            'llama3-8b-8192',
            'llama3-groq-70b-8192-tool-use-preview',
            'llama3-groq-8b-8192-tool-use-preview',
            'llama-guard-3-8b',
            'mixtral-8x7b-32768',
            'whisper-large-v3',
        ].includes(requestParams.model) ) {
            driver = 'groq';
        } else if ( requestParams.model === 'grok-beta' ) {
            driver = 'xai';
        }
        else if ( requestParams.model.startsWith('grok-') ) {
            driver = 'openrouter';
        }
        else if (
            requestParams.model === 'deepseek-chat' ||
            requestParams.model === 'deepseek-reasoner'
        ) {
            driver = 'deepseek';
        }
        else if (
            requestParams.model === 'gemini-1.5-flash' ||
            requestParams.model === 'gemini-2.0-flash' ||
            requestParams.model === 'gemini-2.5-flash' ||
            requestParams.model === 'gemini-2.5-flash-lite' ||
            requestParams.model === 'gemini-2.0-flash-lite' ||
            requestParams.model === 'gemini-3-pro-preview' ||
            requestParams.model === 'gemini-2.5-pro'
        ) {
            driver = 'gemini';
        }
        else if ( requestParams.model.startsWith('openrouter:') ) {
            driver = 'openrouter';
        }
        else if ( requestParams.model.startsWith('ollama:') ) {
            driver = 'ollama';
        }

        // stream flag from userParams
        if ( userParams.stream !== undefined && typeof userParams.stream === 'boolean' ) {
            requestParams.stream = userParams.stream;
        }

        if ( userParams.driver ) {
            driver = userParams.driver;
        }

        // Additional parameters to pass from userParams to requestParams
        const PARAMS_TO_PASS = ['tools', 'response', 'reasoning', 'reasoning_effort', 'text', 'verbosity'];
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

        const driverHint = typeof options.driver === 'string' ? options.driver : undefined;
        const providerRaw = typeof options.provider === 'string'
            ? options.provider
            : (typeof options.service === 'string' ? options.service : undefined);
        const providerHint = typeof providerRaw === 'string' ? providerRaw.toLowerCase() : undefined;
        const modelLower = typeof options.model === 'string' ? options.model.toLowerCase() : '';

        const looksLikeTogetherModel =
            typeof options.model === 'string' &&
            (TOGETHER_IMAGE_MODEL_PREFIXES.some(prefix => modelLower.startsWith(prefix)) ||
                TOGETHER_IMAGE_MODEL_KEYWORDS.some(keyword => modelLower.includes(keyword)));

        if ( driverHint ) {
            AIService = driverHint;
        } else if ( providerHint === 'gemini' ) {
            AIService = 'gemini-image-generation';
        } else if ( providerHint === 'together' || providerHint === 'together-ai' ) {
            AIService = 'together-image-generation';
        } else if ( options.model === 'gemini-2.5-flash-image-preview' ) {
            AIService = 'gemini-image-generation';
        } else if ( looksLikeTogetherModel ) {
            AIService = 'together-image-generation';
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
                let img = new Image();
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

        let videoService = 'openai-video-generation';
        const driverHint = typeof options.driver === 'string' ? options.driver : undefined;
        const driverHintLower = driverHint ? driverHint.toLowerCase() : undefined;
        const providerRaw = typeof options.provider === 'string'
            ? options.provider
            : (typeof options.service === 'string' ? options.service : undefined);
        const providerHint = typeof providerRaw === 'string' ? providerRaw.toLowerCase() : undefined;
        const modelLower = typeof options.model === 'string' ? options.model.toLowerCase() : '';

        const looksLikeTogetherVideoModel = typeof options.model === 'string' &&
            TOGETHER_VIDEO_MODEL_PREFIXES.some(prefix => modelLower.startsWith(prefix));

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

                const video = document.createElement('video');
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
