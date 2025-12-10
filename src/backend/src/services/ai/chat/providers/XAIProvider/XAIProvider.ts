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

import { OpenAI } from 'openai';
import { ChatCompletionCreateParams } from 'openai/resources/index.js';
import { Context } from '../../../../../util/context.js';
import { MeteringService } from '../../../../MeteringService/MeteringService.js';
import * as OpenAIUtil from '../../../utils/OpenAIUtil.js';
import { IChatProvider, ICompleteArguments } from '../types.js';
import { XAI_MODELS } from './models.js';

export class XAIProvider implements IChatProvider {
    #openai: OpenAI;

    #meteringService: MeteringService;

    constructor (config: { apiKey: string }, meteringService: MeteringService) {
        this.#openai = new OpenAI({
            apiKey: config.apiKey,
            baseURL: 'https://api.x.ai/v1',
        });
        this.#meteringService = meteringService;
    }

    getDefaultModel () {
        return 'grok-beta';
    }

    models () {
        return XAI_MODELS;
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

    async complete ({ messages, stream, model, tools }: ICompleteArguments): ReturnType<IChatProvider['complete']> {
        const actor = Context.get('actor');
        const availableModels = this.models();
        const modelUsed = availableModels.find(m => [m.id, ...(m.aliases || [])].includes(model)) || availableModels.find(m => m.id === this.getDefaultModel())!;

        messages = await OpenAIUtil.process_input_messages(messages);

        const completion = await this.#openai.chat.completions.create({
            messages,
            model: modelUsed.id,
            ...(tools ? { tools } : {}),
            max_tokens: 1000,
            stream,
            ...(stream ? {
                stream_options: { include_usage: true },
            } : {}),
        } as ChatCompletionCreateParams);

        return OpenAIUtil.handle_completion_output({
            usage_calculator: ({ usage }) => {
                const trackedUsage = OpenAIUtil.extractMeteredUsage(usage);
                const costsOverride = Object.fromEntries(Object.entries(trackedUsage).map(([k, v]) => {
                    return [k, v * (modelUsed.costs[k] || 0)];
                }));
                this.#meteringService.utilRecordUsageObject(trackedUsage, actor, `xai:${modelUsed.id}`, costsOverride);
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
