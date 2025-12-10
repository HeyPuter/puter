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
import { OpenAI } from 'openai';
import { ChatCompletionCreateParams } from 'openai/resources/index.js';
import { Context } from '../../../../../util/context.js';
import { MeteringService } from '../../../../MeteringService/MeteringService.js';
import * as OpenAIUtil from '../../../utils/OpenAIUtil.js';
import { IChatProvider, ICompleteArguments } from '../types.js';
import { DEEPSEEK_MODELS } from './models.js';

export class DeepSeekProvider implements IChatProvider {
    #openai: OpenAI;

    #meteringService: MeteringService;

    constructor (config: { apiKey: string }, meteringService: MeteringService) {
        this.#openai = new OpenAI({
            apiKey: config.apiKey,
            baseURL: 'https://api.deepseek.com',
        });
        this.#meteringService = meteringService;
    }

    getDefaultModel () {
        return 'deepseek/deepseek-chat';
    }

    models () {
        return DEEPSEEK_MODELS;
    }

    async list () {
        const models = this.models();
        const modelNames: string[] = [];
        for ( const model of models ) {
            modelNames.push(model.id);
            if ( model.aliases ) {
                modelNames.push(...model.aliases);
            }
        }
        return modelNames;
    }

    async complete ({ messages, stream, model, tools, max_tokens, temperature }: ICompleteArguments): ReturnType<IChatProvider['complete']> {
        const actor = Context.get('actor');
        const availableModels = this.models();
        const modelUsed = availableModels.find(m => [m.id, ...(m.aliases || [])].includes(model)) || availableModels.find(m => m.id === this.getDefaultModel())!;

        messages = await OpenAIUtil.process_input_messages(messages);
        for ( const message of messages ) {
            // DeepSeek doesn't accept string arrays alongside tool calls
            if ( message.tool_calls && Array.isArray(message.content) ) {
                message.content = '';
            }
        }

        // Function calling currently loops unless we inject the tool result as a system message.
        const TOOL_TEXT = (message: { tool_call_id: string; content: string }) => dedent(`
            Hi DeepSeek V3, your tool calling is broken and you are not able to
            obtain tool results in the expected way. That's okay, we can work
            around this.

            Please do not repeat this tool call.

            We have provided the tool call results below:

            Tool call ${message.tool_call_id} returned: ${message.content}.
        `);
        for ( let i = messages.length - 1; i >= 0; i-- ) {
            const message = messages[i];
            if ( message.role === 'tool' ) {
                messages.splice(i + 1, 0, {
                    role: 'system',
                    content: [
                        {
                            type: 'text',
                            text: TOOL_TEXT(message),
                        },
                    ],
                });
            }
        }

        const completion = await this.#openai.chat.completions.create({
            messages,
            model: modelUsed.id,
            ...(tools ? { tools } : {}),
            max_tokens: max_tokens || 1000,
            temperature,
            stream,
            ...(stream ? {
                stream_options: { include_usage: true },
            } : {}),
        } as ChatCompletionCreateParams);

        return OpenAIUtil.handle_completion_output({
            usage_calculator: ({ usage }) => {
                const trackedUsage = OpenAIUtil.extractMeteredUsage(usage);
                const costsOverrideFromModel = Object.fromEntries(Object.entries(trackedUsage).map(([k, v]) => {
                    return [k, v * (modelUsed.costs[k] || 0)];
                }));
                this.#meteringService.utilRecordUsageObject(trackedUsage, actor, `deepseek:${modelUsed.id}`, costsOverrideFromModel);
                return trackedUsage;
            },
            stream,
            completion,
        });
    }

    checkModeration (_text: string): ReturnType<IChatProvider['checkModeration']> {
        throw new Error('Method not implemented.');
    }
}
