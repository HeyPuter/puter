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

import axios from 'axios';
import { OpenAI } from 'openai';
import { ChatCompletionCreateParams } from 'openai/resources';
import APIError from '../../../../../api/APIError.js';
import { Context } from '../../../../../util/context.js';
import { kv } from '../../../../../util/kvSingleton.js';
import { MeteringService } from '../../../../MeteringService/MeteringService.js';
import * as OpenAIUtil from '../../../utils/OpenAIUtil.js';
import { IChatModel, IChatProvider } from '../types.js';

export class OpenRouterProvider implements IChatProvider {

    #meteringService: MeteringService;

    #openai: OpenAI;

    #apiBaseUrl: string = 'https://openrouter.ai/api/v1';

    constructor (config: { apiBaseUrl?: string, apiKey: string }, meteringService: MeteringService) {
        this.#apiBaseUrl = config.apiBaseUrl || 'https://openrouter.ai/api/v1';
        this.#openai = new OpenAI({
            apiKey: config.apiKey,
            baseURL: this.#apiBaseUrl,
        });
        this.#meteringService = meteringService;
    }

    getDefaultModel () {
        return 'openrouter:openai/gpt-5-nano';
    }
    /**
            * Returns a list of available model names including their aliases
            * @returns {Promise<string[]>} Array of model identifiers and their aliases
            * @description Retrieves all available model IDs and their aliases,
            * flattening them into a single array of strings that can be used for model selection
            */
    async list () {
        const models = await this.models();
        const model_names: string[] = [];
        for ( const model of models ) {
            model_names.push(model.id);
        }
        return model_names;
    }

    /**
             * AI Chat completion method.
             * See AIChatService for more details.
             */
    async complete ({ messages, stream, model, tools, max_tokens, temperature }) {

        const modelUsed = (await this.models()).find(m => [m.id, ...(m.aliases || [])].includes(model)) || (await this.models()).find(m => m.id === this.getDefaultModel())!;

        const modelIdForParams = modelUsed.id.startsWith('openrouter:') ? modelUsed.id.slice('openrouter:'.length) : modelUsed.id;

        if ( model === 'openrouter/auto' ) {
            throw APIError.create('field_invalid', undefined, {
                key: 'model',
                expected: 'allowed model',
                got: 'disallowed model',
            });
        }

        const actor = Context.get('actor');

        messages = await OpenAIUtil.process_input_messages(messages);

        const completionParams = {
            messages,
            model: modelIdForParams,
            ...(tools ? { tools } : {}),
            max_tokens,
            temperature: temperature, // default to 1.0
            stream,
            ...(stream ? {
                stream_options: { include_usage: true },
            } : {}),
            usage: { include: true },
        } as ChatCompletionCreateParams;

        let completion;
        try {
            completion = await this.#openai.chat.completions.create(completionParams);
        } catch ( e: unknown ) {
            // If you overestimate allowed max_tokens on openrouter then it will throw an error.
            // Since we know the user has enough for the query anyways, we should reexecute the
            // request without max_tokens.
            const err = e as { error: Error };
            if ( err && err.error && err.error.message && err.error.message.startsWith("This endpoint's maximum context length is ") ) {
                delete completionParams.max_tokens;
                completion = await this.#openai.chat.completions.create(completionParams);
            } else {
                console.log('Openarouter error: ', err.error.message);
                throw e;
            }
        }

        return OpenAIUtil.handle_completion_output({
            usage_calculator: ({ usage }) => {
                // custom open router logic because they're pricing are weird
                const trackedUsage = {
                    prompt: (usage.prompt_tokens ?? 0 ) - (usage.prompt_tokens_details?.cached_tokens ?? 0),
                    completion: usage.completion_tokens ?? 0,
                    input_cache_read: usage.prompt_tokens_details?.cached_tokens ?? 0,
                    request: (usage as unknown as Record<string, number>).request || 1,
                };
                const costOverwrites = Object.fromEntries(Object.keys(trackedUsage).map((k) => {
                    return [k, (modelUsed.costs[k] || 0) * trackedUsage[k]];
                }));
                this.#meteringService.utilRecordUsageObject(trackedUsage, actor, modelUsed.id, costOverwrites);
                return trackedUsage;
            },
            stream,
            completion,
        });
    }

    async models () {
        let models = kv.get('openrouterChat:models');
        if ( ! models ) {
            try {
                const resp = await axios.request({
                    method: 'GET',
                    url: `${this.#apiBaseUrl}/models`,
                });

                models = resp.data.data;
                kv.set('openrouterChat:models', models);
            } catch (e) {
                console.log(e);
            }
        }
        const coerced_models: IChatModel[] = [];
        for ( const model of models ) {
            if ( (model.id as string).includes('openrouter/auto') ) {
                continue;
            }
            const microcentCosts = Object.fromEntries(Object.entries(model.pricing).map(([k, v]) => [k, Math.round((v as number < 0 ? 1 : v as number) * 1_000_000 * 100)])) ;
            coerced_models.push({
                id: `openrouter:${model.id}`,
                name: `${model.name} (OpenRouter)`,
                aliases: [model.id, model.name, `openrouter/${model.id}`, model.id.split('/').slice(1).join('/')],
                max_tokens: model.top_provider.max_completion_tokens,
                costs_currency: 'usd-cents',
                input_cost_key: 'prompt',
                output_cost_key: 'completion',
                costs: {
                    tokens: 1_000_000,
                    ...microcentCosts,
                },
            });
        }
        return coerced_models;
    }
    checkModeration (_text: string): ReturnType<IChatProvider['checkModeration']> {
        throw new Error('Method not implemented.');
    }
}