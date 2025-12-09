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

import dedent from 'dedent';
import { PassThrough } from 'stream';
import Streaming from '../../utils/Streaming.js';
import { IChatProvider, ICompleteArguments } from './types.js';

/**
* UsageLimitedChatService - A specialized chat service that returns resource exhaustion messages.
* Extends BaseService to provide responses indicating the user has exceeded their usage limits.
* Follows the same response format as real AI providers but with a custom message about upgrading.
* Can handle both streaming and non-streaming requests consistently.
*/
export class UsageLimitedChatProvider implements IChatProvider {

    models (): ReturnType<IChatProvider['models']> {
        return [{
            id: 'usage-limited',
            name: 'Usage Limited',
            context: 16384,
            costs_currency: 'usd-cents',
            input_cost_key: 'input',
            output_cost_key: 'output',
            max_tokens: 16384,
            costs: {
                tokens: 1_000_000,
                input: 0,
                output: 0,
            },
        }];
    }
    list () {
        return ['usage-limited'];
    }
    async complete ({ stream, customLimitMessage }: ICompleteArguments): ReturnType<IChatProvider['complete']> {
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
                finally_fn: async () => {
                    // No-op
                },
            };
        }

        // Non-streaming response
        return {
            message: {
                id: '00000000-0000-0000-0000-000000000000',
                type: 'message',
                role: 'assistant',
                model: 'usage-limited',
                content: [
                    {
                        'type': 'text',
                        'text': limitMessage,
                    },
                ],
                stop_reason: 'end_turn',
                stop_sequence: null,
                usage: {
                    'input_tokens': 0,
                    'output_tokens': 1,
                },
            },
            usage: {
                'input_tokens': 0,
                'output_tokens': 1,
            },
            finish_reason: 'stop',
        };
    }
    checkModeration (_text: string): ReturnType<IChatProvider['checkModeration']> {
        throw new Error('Method not implemented.');
    }

    getDefaultModel () {
        return 'usage-limited';
    }
}