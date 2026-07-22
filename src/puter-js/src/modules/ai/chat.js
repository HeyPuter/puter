import * as utils from '../../lib/utils.js';
import { hasTestModeFlag, isPlainObject } from './lib/args.js';

/** @typedef {import('../../../types/modules/ai').ChatMessage} ChatMessage */
/** @typedef {import('../../../types/modules/ai').ChatOptions} ChatOptions */
/** @typedef {import('../../../types/modules/ai').ChatResponse} ChatResponse */
/** @typedef {import('../../../types/modules/ai').ChatResponseChunk} ChatResponseChunk */
/** @typedef {import('../../../types/modules/ai').StreamingChatOptions} StreamingChatOptions */

// Parameters copied from the caller's options object onto the driver
// request. `compaction` (provider-neutral inline-compaction opt-in) and the
// raw `context_management` escape hatch flow straight through to the driver.
const PARAMS_TO_PASS = [
    'tools',
    'response',
    'reasoning',
    'reasoning_effort',
    'text',
    'verbosity',
    'provider',
    'image_config',
    'compaction',
    'context_management',
];

/**
 * @overload
 * @param {string} prompt
 * @param {boolean} [testMode]
 * @returns {Promise<ChatResponse>}
 */
/**
 * @overload
 * @param {string} prompt
 * @param {StreamingChatOptions} options
 * @param {boolean} [testMode]
 * @returns {Promise<AsyncIterable<ChatResponseChunk>>}
 */
/**
 * @overload
 * @param {string} prompt
 * @param {ChatOptions} options
 * @param {boolean} [testMode]
 * @returns {Promise<ChatResponse>}
 */
/**
 * @overload
 * @param {string} prompt
 * @param {string | File} imageURL
 * @param {boolean} [testMode]
 * @returns {Promise<ChatResponse>}
 */
/**
 * @overload
 * @param {string} prompt
 * @param {string[]} imageURLArray
 * @param {boolean} [testMode]
 * @returns {Promise<ChatResponse>}
 */
/**
 * @overload
 * @param {string} prompt
 * @param {string | File} imageURL
 * @param {StreamingChatOptions} options
 * @param {boolean} [testMode]
 * @returns {Promise<AsyncIterable<ChatResponseChunk>>}
 */
/**
 * @overload
 * @param {string} prompt
 * @param {string | File} imageURL
 * @param {ChatOptions} options
 * @param {boolean} [testMode]
 * @returns {Promise<ChatResponse>}
 */
/**
 * @overload
 * @param {string} prompt
 * @param {string[]} imageURLArray
 * @param {StreamingChatOptions} options
 * @param {boolean} [testMode]
 * @returns {Promise<AsyncIterable<ChatResponseChunk>>}
 */
/**
 * @overload
 * @param {string} prompt
 * @param {string[]} imageURLArray
 * @param {ChatOptions} options
 * @param {boolean} [testMode]
 * @returns {Promise<ChatResponse>}
 */
/**
 * @overload
 * @param {ChatMessage[]} messages
 * @param {boolean} [testMode]
 * @returns {Promise<ChatResponse>}
 */
/**
 * @overload
 * @param {ChatMessage[]} messages
 * @param {StreamingChatOptions} options
 * @param {boolean} [testMode]
 * @returns {Promise<AsyncIterable<ChatResponseChunk>>}
 */
/**
 * @overload
 * @param {ChatMessage[]} messages
 * @param {ChatOptions} options
 * @param {boolean} [testMode]
 * @returns {Promise<ChatResponse>}
 */
/**
 * Documented forms:
 *   chat(prompt)
 *   chat(prompt, options)
 *   chat(prompt, testMode, options)
 *   chat(prompt, media, [testMode], [options])
 *   chat(prompt, [mediaURLs], [testMode], [options])
 *   chat(messages, [testMode], [options])
 *
 * Media may only be the second argument; among the trailing arguments the
 * first object is the options and a boolean `true` anywhere enables test
 * mode, so `options` and `testMode` may arrive in either order.
 *
 * @this {import('./index.js').AIModule}
 * @param {string | ChatMessage[]} promptOrMessages
 * @param {string | File | string[] | ChatOptions | boolean | null} [mediaOrOptions]
 * @param {ChatOptions | boolean} [optionsOrTestMode]
 * @param {boolean | ChatOptions} [testModeOrOptions]
 * @returns {Promise<ChatResponse | AsyncIterable<ChatResponseChunk>>}
 */
export async function chat (
    promptOrMessages,
    mediaOrOptions,
    optionsOrTestMode,
    testModeOrOptions,
) {
    const { puter } = this;
    const extras = [mediaOrOptions, optionsOrTestMode, testModeOrOptions];

    // requestParams: parameters that will be sent to the backend driver
    /** @type {Record<string, unknown>} */
    let requestParams = {};

    // chat(prompt, mediaURL/File, ...)
    if (
        typeof promptOrMessages === 'string' &&
        mediaOrOptions &&
        (typeof mediaOrOptions === 'string' || mediaOrOptions instanceof File)
    ) {
        // if media is a File, transform it to a data URI
        const media =
            mediaOrOptions instanceof File
                ? await utils.blobToDataUri(mediaOrOptions)
                : mediaOrOptions;

        const mediaBlock = utils.isVideoInput(media)
            ? { video_url: { url: media } }
            : { image_url: { url: media } };

        requestParams = {
            vision: true,
            messages: [
                {
                    content: [promptOrMessages, mediaBlock],
                },
            ],
        };
    }
    // chat(prompt, [mediaURLs], ...)
    else if (
        typeof promptOrMessages === 'string' &&
        Array.isArray(mediaOrOptions)
    ) {
        const mediaBlocks = mediaOrOptions.map((url) =>
            utils.isVideoInput(url)
                ? { video_url: { url } }
                : { image_url: { url } },
        );
        requestParams = {
            vision: true,
            messages: [
                {
                    content: [promptOrMessages, ...mediaBlocks],
                },
            ],
        };
    }
    // chat([messages], ...)
    else if (Array.isArray(promptOrMessages)) {
        requestParams = { messages: promptOrMessages };
    }
    // chat(prompt, ...) — a string first argument always carries the prompt
    else if (typeof promptOrMessages === 'string') {
        requestParams = { messages: [{ content: promptOrMessages }] };
    }

    const testMode = hasTestModeFlag(extras);

    // the first object argument is the user parameters object
    /** @type {ChatOptions & { stream?: boolean }} */
    const userParams = extras.find(isPlainObject) ?? {};

    // Copy relevant parameters from userParams to requestParams
    if (userParams.model) {
        requestParams.model = userParams.model;
    }
    if (userParams.temperature) {
        requestParams.temperature = userParams.temperature;
    }
    if (userParams.max_tokens) {
        requestParams.max_tokens = userParams.max_tokens;
    }

    if (
        userParams.stream !== undefined &&
        typeof userParams.stream === 'boolean'
    ) {
        requestParams.stream = userParams.stream;
    }

    for (const name of PARAMS_TO_PASS) {
        if (userParams[name]) {
            requestParams[name] = userParams[name];
        }
    }

    // the legacy `driver` option is an alias for `provider`
    if (userParams.driver) {
        requestParams.provider = requestParams.provider || userParams.driver;
    }

    return await utils.make_driver_method(
        ['messages'],
        'puter-chat-completion',
        'ai-chat',
        'complete',
        {
            puter,
            test_mode: testMode ?? false,
            transform: async (result) => {
                // Both deliberately return the message content as-is, which may
                // be a content-part array rather than a string.
                result.toString = () => result.message?.content;
                result.valueOf = () => result.message?.content;
                return result;
            },
        },
    )(requestParams);
}
