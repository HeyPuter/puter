import * as utils from '../lib/utils.js'

class AI{
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

    img2txt = async (...args) => {
        let MAX_INPUT_SIZE = 10 * 1024 * 1024;
        let options = {};
        let testMode = false;

        // Check that the argument is not undefined or null
        if(!args){
            throw({message: 'Arguments are required', code: 'arguments_required'});
        }

        // if argument is string transform it to the object that the API expects
        if (typeof args[0] === 'string' || args[0] instanceof Blob) {
            options.source = args[0];
        }

        // if input is a blob, transform it to a data URI
        if (args[0].source instanceof Blob) {
            options.source = await utils.blobToDataUri(args[0].source);
        }

        // check input size
        if (options.source.length > this.MAX_INPUT_SIZE) {
            throw { message: 'Input size cannot be larger than ' + MAX_INPUT_SIZE, code: 'input_too_large' };
        }

        // determine if test mode is enabled
        if (typeof args[1] === 'boolean' && args[1] === true ||
            typeof args[2] === 'boolean' && args[2] === true ||
            typeof args[3] === 'boolean' && args[3] === true) {
            testMode = true;
        }
    
        return await utils.make_driver_method(['source'], 'puter-ocr', 'aws-textract', 'recognize', {
            test_mode: testMode ?? false,
            transform: async (result) => {
                let str = '';
                for (let i = 0; i < result?.blocks?.length; i++) {
                    if("text/textract:LINE" === result.blocks[i].type)
                        str += result.blocks[i].text + "\n";
                }
                return str;
            }
        }).call(this, options);
    }

    txt2speech = async (...args) => {
        let MAX_INPUT_SIZE = 3000;
        let options = {};
        let testMode = false;

        if(!args){
            throw({message: 'Arguments are required', code: 'arguments_required'});
        }

        // if argument is string transform it to the object that the API expects
        if (typeof args[0] === 'string') {
            options = { text: args[0] };
        }

        // if second argument is string, it's the language
        if (args[1] && typeof args[1] === 'string') {
            options.language = args[1];
        }

        // check input size
        if (options.text.length > this.MAX_INPUT_SIZE) {
            throw { message: 'Input size cannot be larger than ' + MAX_INPUT_SIZE, code: 'input_too_large' };
        }

        // determine if test mode is enabled
        if (typeof args[1] === 'boolean' && args[1] === true ||
            typeof args[2] === 'boolean' && args[2] === true ||
            typeof args[3] === 'boolean' && args[3] === true) {
            testMode = true;
        }
    
        return await utils.make_driver_method(['source'], 'puter-tts', 'aws-polly', 'synthesize', {
            responseType: 'blob',
            test_mode: testMode ?? false,
            transform: async (result) => {
                const url = await utils.blob_to_url(result);
                const audio = new Audio(url);
                audio.toString = () => url;
                audio.valueOf = () => url;
                return audio;
            }
        }).call(this, options);
    }


    // accepts either a string or an array of message objects
    // if string, it's treated as the prompt which is a shorthand for { messages: [{ content: prompt }] }
    // if object, it's treated as the full argument object that the API expects
    chat = async (...args) => {
        let options = {};
        let settings = {};
        let testMode = false;

        // default driver is openai-completion
        let driver = 'openai-completion';

        // Check that the argument is not undefined or null
        if(!args){ 
            throw({message: 'Arguments are required', code: 'arguments_required'});
        }

        // ai.chat(prompt)
        if(typeof args[0] === 'string'){
            options = { messages: [{ content: args[0] }] };
        }

        // ai.chat(prompt, testMode)
        if (typeof args[0] === 'string' && (!args[1] || typeof args[1] === 'boolean')) {
            options = { messages: [{ content: args[0] }] };
        }

        // ai.chat(prompt, imageURL/File)
        // ai.chat(prompt, imageURL/File, testMode)
        else if (typeof args[0] === 'string' && (typeof args[1] === 'string' || args[1] instanceof File)) {
            // if imageURL is a File, transform it to a data URI
            if(args[1] instanceof File){
                args[1] = await utils.blobToDataUri(args[1]);
            }

            // parse args[1] as an image_url object
            options = { 
                vision: true,
                messages: [
                    { 
                        content: [
                            args[0],
                            {
                                image_url: {
                                    url: args[1]
                                }
                            }
                        ], 
                    }
                ]
            };
        }
        // chat(prompt, [imageURLs])
        else if (typeof args[0] === 'string' && Array.isArray(args[1])) {
            // parse args[1] as an array of image_url objects
            for (let i = 0; i < args[1].length; i++) {
                args[1][i] = { image_url: { url: args[1][i] } };
            }
            options = { 
                vision: true,
                messages: [
                    { 
                        content: [
                            args[0],
                            ...args[1]
                        ], 
                    }
                ]
            };
        }
        // chat([messages])
        else if (Array.isArray(args[0])) {
            options = { messages: args[0] };
        }

        // determine if testMode is enabled
        if (typeof args[1] === 'boolean' && args[1] === true ||
            typeof args[2] === 'boolean' && args[2] === true ||
            typeof args[3] === 'boolean' && args[3] === true) {
            testMode = true;
        }
    
        // if any of the args is an object, assume it's the settings object
        const is_object = v => {
            return typeof v === 'object' &&
                !Array.isArray(v) &&
                v !== null;
        };
        for (let i = 0; i < args.length; i++) {
            if (is_object(args[i])) {
                settings = args[i];
                break;
            }
        }


        // does settings contain `model`? add it to options
        if (settings.model) {
            options.model = settings.model;
        }

        // convert to the correct model name if necessary
        if( options.model === 'claude-3-5-sonnet' || options.model === 'claude'){
            options.model = 'claude-3-5-sonnet-latest';
        }
        if ( options.model === 'mistral' ) {
            options.model = 'mistral-large-latest';
        }
        if ( options.model === 'groq' ) {
            options.model = 'llama3-8b-8192';
        }

        // map model to the appropriate driver
        if (!options.model || options.model === 'gpt-4o' || options.model === 'gpt-4o-mini') {
            driver = 'openai-completion';
        }else if(
            options.model === 'claude-3-haiku-20240307' ||
            options.model === 'claude-3-5-sonnet-20240620' ||
            options.model === 'claude-3-5-sonnet-20241022' ||
            options.model === 'claude-3-5-sonnet-latest'
        ){
            driver = 'claude';
        }else if(options.model === 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo' || options.model === 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo' || options.model === 'meta-llama/Meta-Llama-3.1-405B-Instruct-Turbo' || options.model === `google/gemma-2-27b-it`){
            driver = 'together-ai';
        }else if(options.model === 'mistral-large-latest' || options.model === 'codestral-latest'){
            driver = 'mistral';
        }else if([
            "distil-whisper-large-v3-en",
            "gemma2-9b-it",
            "gemma-7b-it",
            "llama-3.1-70b-versatile",
            "llama-3.1-8b-instant",
            "llama3-70b-8192",
            "llama3-8b-8192",
            "llama3-groq-70b-8192-tool-use-preview",
            "llama3-groq-8b-8192-tool-use-preview",
            "llama-guard-3-8b",
            "mixtral-8x7b-32768",
            "whisper-large-v3"
        ].includes(options.model)) {
            driver = 'groq';
        }else if(options.model === 'grok-beta') {
            driver = 'xai';
        }

        // stream flag from settings
        if(settings.stream !== undefined && typeof settings.stream === 'boolean'){
            options.stream = settings.stream;
        }

        if ( settings.tools ) {
            options.tools = settings.tools;
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
                }

                return result;
            }
        }).call(this, options);
    }

    txt2img = async (...args) => {
        let options = {};
        let testMode = false;

        if(!args){
            throw({message: 'Arguments are required', code: 'arguments_required'});
        }

        // if argument is string transform it to the object that the API expects
        if (typeof args[0] === 'string') {
            options = { prompt: args[0] };
        }

        // if second argument is string, it's the `testMode`
        if (typeof args[1] === 'boolean' && args[1] === true) {
            testMode = true;
        }
    
        // Call the original chat.complete method
        return await utils.make_driver_method(['prompt'], 'puter-image-generation', undefined, 'generate', {
            responseType: 'blob',
            test_mode: testMode ?? false,
            transform: async blob => {
                let img = new Image();
                img.src = await utils.blob_to_url(blob);
                img.toString = () => img.src;
                img.valueOf = () => img.src;
                return img;
            }
        }).call(this, options);
    }
}

export default AI;