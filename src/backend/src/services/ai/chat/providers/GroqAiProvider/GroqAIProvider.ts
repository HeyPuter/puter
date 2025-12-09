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

import Groq from 'groq-sdk';
import { ChatCompletionCreateParams } from 'groq-sdk/resources/chat/completions.mjs';
import { CompletionUsage } from 'openai/resources';
import { Context } from '../../../../../util/context.js';
import { MeteringService } from '../../../../MeteringService/MeteringService.js';
import * as OpenAIUtil from '../../../utils/OpenAIUtil.js';
import { IChatProvider, ICompleteArguments } from '../types.js';
import { GROQ_MODELS } from './models.js';

export class GroqAIProvider implements IChatProvider {
    #client: Groq;

    #meteringService: MeteringService;

    constructor (config: { apiKey: string }, meteringService: MeteringService) {
        this.#client = new Groq({
            apiKey: config.apiKey,
        });
        this.#meteringService = meteringService;
    }

    getDefaultModel () {
        return 'llama-3.1-8b-instant';
    }

    models () {
        return GROQ_MODELS;
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

    async complete ({ messages, model, stream, tools, max_tokens, temperature }: ICompleteArguments): ReturnType<IChatProvider['complete']> {
        const actor = Context.get('actor');
        const availableModels = this.models();
        const modelUsed = availableModels.find(m => [m.id, ...(m.aliases || [])].includes(model)) || availableModels.find(m => m.id === this.getDefaultModel())!;

        messages = await OpenAIUtil.process_input_messages(messages);
        for ( const message of messages ) {
            if ( message.tool_calls && Array.isArray(message.content) ) {
                message.content = '';
            }
        }

        const completion = await this.#client.chat.completions.create({
            messages,
            model: modelUsed.id,
            stream,
            tools,
            max_completion_tokens: max_tokens,
            temperature,
        } as ChatCompletionCreateParams);

        return OpenAIUtil.handle_completion_output({
            deviations: {
                index_usage_from_stream_chunk: chunk =>
                    // x_groq contains usage details for streamed responses
                    (chunk as { x_groq?: { usage?: CompletionUsage } }).x_groq?.usage,
            },
            usage_calculator: ({ usage }) => {
                const trackedUsage = OpenAIUtil.extractMeteredUsage(usage);
                const costsOverride = Object.fromEntries(Object.entries(trackedUsage).map(([k, v]) => {
                    return [k, v * (modelUsed.costs[k] || 0)];
                }));
                this.#meteringService.utilRecordUsageObject(trackedUsage, actor, `groq:${modelUsed.id}`, costsOverride);
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
