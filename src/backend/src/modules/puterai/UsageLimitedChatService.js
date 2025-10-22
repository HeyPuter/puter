/*
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

// METADATA // {"ai-commented":{"service":"claude"}}
const { default: dedent } = require('dedent');
const BaseService = require('../../services/BaseService');
const { PassThrough } = require('stream');
const Streaming = require('./lib/Streaming');

/**
* UsageLimitedChatService - A specialized chat service that returns resource exhaustion messages.
* Extends BaseService to provide responses indicating the user has exceeded their usage limits.
* Follows the same response format as real AI providers but with a custom message about upgrading.
* Can handle both streaming and non-streaming requests consistently.
*/
class UsageLimitedChatService extends BaseService {
    get_default_model() {
        return 'usage-limited';
    }

    static IMPLEMENTS = {
        ['puter-chat-completion']: {
            /**
            * Returns a list of available model names
            * @returns {Promise<string[]>} Array containing the single model identifier
            */
            async list() {
                return ['usage-limited'];
            },

            /**
            * Returns model details for the usage-limited model
            * @returns {Promise<Object[]>} Array containing the model details
            */
            async models() {
                return [{
                    id: 'usage-limited',
                    name: 'Usage Limited',
                    context: 16384,
                    cost: {
                        currency: 'usd-cents',
                        tokens: 1_000_000,
                        input: 0,
                        output: 0,
                    },
                }];
            },

            /**
            * Simulates a chat completion request with a usage limit message
            * @param {Object} params - The completion parameters
            * @param {Array} params.messages - Array of chat messages (unused)
            * @param {boolean} params.stream - Whether to stream the response
            * @param {string} params.model - The model to use (unused)
            * @returns {Object|TypedValue} A chat completion response or streamed response
            */
            async complete({ stream, customLimitMessage }) {
                const limitMessage = customLimitMessage || dedent(`
                    You have reached your AI usage limit for this account.
                `);

                // If streaming is requested, return a streaming response
                if ( stream ) {
                    const streamObj = new PassThrough();

                    const chatStream = new Streaming.AIChatStream({
                        stream: streamObj,
                    });

                    // Schedule the streaming response
                    setTimeout(() => {
                        chatStream.write({
                            type: 'content_block_start',
                            index: 0,
                        });

                        chatStream.write({
                            type: 'content_block_delta',
                            index: 0,
                            delta: {
                                type: 'text',
                                text: limitMessage,
                            },
                        });

                        chatStream.write({
                            type: 'content_block_stop',
                            index: 0,
                        });

                        chatStream.write({
                            type: 'message_stop',
                            stop_reason: 'end_turn',
                        });

                        chatStream.end();
                    }, 10);

                    return {
                        stream: true,
                        init_chat_stream: async ({ chatStream: cs }) => {
                            // Copy contents from our stream to the provided one
                            chatStream.stream.pipe(cs.stream);
                        },
                    };
                }

                // Non-streaming response
                return {
                    'index': 0,
                    message: {
                        'id': '00000000-0000-0000-0000-000000000000',
                        'type': 'message',
                        'role': 'assistant',
                        'model': 'usage-limited',
                        'content': [
                            {
                                'type': 'text',
                                'text': limitMessage,
                            },
                        ],
                        'stop_reason': 'end_turn',
                        'stop_sequence': null,
                        'usage': {
                            'input_tokens': 0,
                            'output_tokens': 1,
                        },
                    },
                    'usage': {
                        'input_tokens': 0,
                        'output_tokens': 1,
                    },
                    'logprobs': null,
                    'finish_reason': 'stop',
                };
            },
        },
    };
}

module.exports = {
    UsageLimitedChatService,
};