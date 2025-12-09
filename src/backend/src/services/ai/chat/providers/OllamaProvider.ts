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
import axios from 'axios';
import { default as openai, default as OpenAI } from 'openai';
import { Context } from '../../../../util/context.js';
import { kv } from '../../../../util/kvSingleton.js';
import * as OpenAIUtil from '../../utils/OpenAIUtil.js';
import { IChatModel, IChatProvider, ICompleteArguments } from './types';
import { MeteringService } from '../../../MeteringService/MeteringService';
import { ChatCompletionCreateParams } from 'openai/resources/index.js';
/**
* OllamaService class - Provides integration with Ollama's API for chat completions
* Extends BaseService to implement the puter-chat-completion interface.
* Handles model management, message adaptation, streaming responses,
* and usage tracking for Ollama's language models.
* @extends BaseService
*/
export class OllamaChatProvider implements IChatProvider {

    #apiBaseUrl: string;

    #openai: OpenAI;

    #meteringService: MeteringService;

    constructor (config: { api_base_url?: string } | undefined, meteringService: MeteringService) {
        // Ollama typically runs on HTTP, not HTTPS
        this.#apiBaseUrl = config?.api_base_url || 'http://localhost:11434';

        // OpenAI SDK is used to interact with the Ollama API
        this.#openai = new openai.OpenAI({
            apiKey: 'ollama', // Ollama doesn't use an API key, it uses the "ollama" string
            baseURL: `${config?.api_base_url }/v1`,
        });

        this.#meteringService = meteringService;
    }

    async models () {
        let models = kv.get('ollamaChat:models');
        if ( ! models ) {
            try {
                const resp = await axios.request({
                    method: 'GET',
                    url: `${this.#apiBaseUrl}/api/tags`,
                });
                models = resp.data.models || [];
                if ( models.length > 0 ) {
                    kv.set('ollamaChat:models', models);
                }
            } catch ( error ) {
                console.error('Failed to fetch models from Ollama:', (error as Error).message);
                // Return empty array if Ollama is not available
                return [];
            }
        }

        if ( !models || models.length === 0 ) {
            return [];
        }

        const coerced_models: IChatModel[] = [];
        for ( const model of models ) {
            // Ollama API returns models with 'name' property, not 'model'
            const modelName = model.name || model.model || 'unknown';
            coerced_models.push({
                id: `ollama:${ modelName}`,
                name: `${modelName} (Ollama)`,
                max_tokens: model.size || model.max_context || 8192,
                costs_currency: 'usd-cents',
                costs: {
                    tokens: 1_000_000,
                    input_token: 0,
                    output_token: 0,
                },
            });
        }
        console.log('coerced_models', coerced_models);
        return coerced_models;
    }
    async list () {
        const models = await this.models();
        const model_names: string[] = [];
        for ( const model of models ) {
            model_names.push(model.id);
        }
        return model_names;
    }
    async complete ({ messages, stream, model, tools, max_tokens, temperature }: ICompleteArguments): ReturnType<IChatProvider['complete']> {

        if ( model.startsWith('ollama:') ) {
            model = model.slice('ollama:'.length);
        }

        const actor = Context.get('actor');

        messages = await OpenAIUtil.process_input_messages(messages);

        const completion = await this.#openai.chat.completions.create({
            messages,
            model: model ?? this.getDefaultModel(),
            ...(tools ? { tools } : {}),
            max_tokens,
            temperature: temperature, // default to 1.0
            stream: !!stream,
            ...(stream ? {
                stream_options: { include_usage: true },
            } : {}),
        } as ChatCompletionCreateParams) ;

        const modelDetails =  (await this.models()).find(m => m.id === `ollama:${model}`);
        return OpenAIUtil.handle_completion_output({
            usage_calculator: ({ usage }) => {

                const trackedUsage = {
                    prompt: (usage.prompt_tokens ?? 1 ) - (usage.prompt_tokens_details?.cached_tokens ?? 0),
                    completion: usage.completion_tokens ?? 1,
                    input_cache_read: usage.prompt_tokens_details?.cached_tokens ?? 0,
                };
                const costOverwrites = Object.fromEntries(Object.keys(trackedUsage).map((k) => {
                    return [k, 0]; // override to 0 since local is free
                }));
                this.#meteringService.utilRecordUsageObject(trackedUsage, actor, modelDetails!.id, costOverwrites);
                return trackedUsage;
            },
            stream,
            completion,
        });
    }
    checkModeration (_text: string): ReturnType<IChatProvider['checkModeration']> {
        throw new Error('Method not implemented.');
    }

    /**
    * Returns the default model identifier for the Ollama service
    * @returns {string} The default model ID 'gpt-oss:20b'
    */
    getDefaultModel () {
        return 'gpt-oss:20b';
    }
}