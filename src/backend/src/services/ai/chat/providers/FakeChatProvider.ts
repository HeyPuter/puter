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

import dedent from 'dedent';
import { LoremIpsum } from 'lorem-ipsum';
import { AIChatStream } from '../../utils/Streaming';
import { IChatProvider, ICompleteArguments, PuterMessage } from './types';

export class FakeChatProvider implements IChatProvider {
    checkModeration (_text: string): ReturnType<IChatProvider['checkModeration']> {
        throw new Error('Method not implemented.');
    }

    getDefaultModel () {
        return 'fake';
    }

    async models () {
        return [
            {
                id: 'fake',
                aliases: [],
                costs_currency: 'usd-cents',
                costs: {
                    'input-tokens': 0,
                    'output-tokens': 0,
                },
                max_tokens: 8192,

            },
            {
                id: 'costly',
                aliases: [],
                costs_currency: 'usd-cents',
                costs: {
                    'input-tokens': 1000, // 1000 microcents per million tokens (0.001 cents per 1000 tokens)
                    'output-tokens': 2000, // 2000 microcents per million tokens (0.002 cents per 1000 tokens)
                },
                max_tokens: 8192,
            },
            {
                id: 'abuse',
                aliases: [],
                costs_currency: 'usd-cents',
                costs: {
                    'input-tokens': 0,
                    'output-tokens': 0,
                },
                max_tokens: 8192,
            },
        ];
    }
    async list () {
        return ['fake', 'costly', 'abuse'];
    }
    async complete ({ messages, stream, model, max_tokens, custom }: ICompleteArguments): ReturnType<IChatProvider['complete']> {

        // Determine token counts based on messages and model
        const usedModel = model || this.getDefaultModel();

        // For the costly model, simulate actual token counting
        const resp = this.getFakeResponse(usedModel, custom, messages, max_tokens);

        if ( stream ) {
            return {
                init_chat_stream: async ({ chatStream }: { chatStream: AIChatStream }) => {
                    await new Promise(rslv => setTimeout(rslv, 500));
                    chatStream.stream.write(`${JSON.stringify({
                        type: 'text',
                        text: (await resp).message.content[0].text,
                    }) }\n`);
                    chatStream.end({});
                },
                stream: true,
                finally_fn: async () => {
                    // no op
                },
            };
        }

        return resp;
    }
    async getFakeResponse (modelId: string, custom: unknown, messages: PuterMessage[], maxTokens: number = 8192): ReturnType<IChatProvider['complete']> {
        let inputTokens = 0;
        let outputTokens = 0;

        if ( modelId === 'costly' ) {
            // Simple token estimation: roughly 4 chars per token for input
            if ( messages && messages.length > 0 ) {
                for ( const message of messages ) {
                    if ( typeof message.content === 'string' ) {
                        inputTokens += Math.ceil(message.content.length / 4);
                    } else if ( Array.isArray(message.content) ) {
                        for ( const content of message.content ) {
                            if ( content.type === 'text' ) {
                                inputTokens += Math.ceil(content.text.length / 4);
                            }
                        }
                    }
                }
            }

            // Generate random output token count between 50 and 200
            outputTokens = Math.floor(Math.min((Math.random() * 150) + 50, maxTokens));
            // outputTokens = Math.floor(Math.random() * 150) + 50;
        }

        // Generate the response text
        let responseText;
        if ( modelId === 'abuse' ) {
            responseText = dedent(`
                <h2>Free AI and Cloud for everyone!</h2><br />
                Come on down to <a href="https://puter.com">puter.com</a> and try it out!
                ${custom ?? ''}
            `);
        } else {
            // Generate 1-3 paragraphs for both fake and costly models
            responseText = new LoremIpsum({
                sentencesPerParagraph: {
                    max: 8,
                    min: 4,
                },
                wordsPerSentence: {
                    max: 20,
                    min: 12,
                },
            }).generateParagraphs(Math.floor(Math.random() * 3) + 1);
        }

        // Report usage based on model
        const usage = {
            'input_tokens': modelId === 'costly' ? inputTokens : 0,
            'output_tokens': modelId === 'costly' ? outputTokens : 1,
        };

        return {
            message: {
                'id': '00000000-0000-0000-0000-000000000000',
                'type': 'message',
                'role': 'assistant',
                'model': modelId,
                'content': [
                    {
                        'type': 'text',
                        'text': responseText,
                    },
                ],
                'stop_reason': 'end_turn',
                'stop_sequence': null,
                'usage': usage,
            },
            'usage': usage,
            'finish_reason': 'stop',
        };
    }
}
