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

import mime from 'mime-types';
import { OpenAI } from 'openai';
import { ChatCompletionCreateParams } from 'openai/resources/index.js';
// TODO: file upload functionality — FSNodeParam, LLRead, stream_to_buffer
// Previously imported from v1:
//   import { FSNodeParam } from '../../../../../api/filesystem/FSNodeParam.js';
//   import { LLRead } from '../../../../../deprecated/filesystem/ll_operations/ll_read.js';
//   import { stream_to_buffer } from '../../../../../util/streamutil.js';
import { Context } from '../../../../core/context.js';
import type { MeteringService } from '../../../../services/metering/MeteringService.js';
import * as OpenAiUtil from '../../utils/OpenAIUtil.js';
import type { IChatProvider, ICompleteArguments, IChatCompleteResult } from '../../types.js';
import { OPEN_AI_MODELS } from './models.js';

;

// We're capping at 5MB, which sucks, but Chat Completions doesn't suuport
// file inputs.
const MAX_FILE_SIZE = 5 * 1_000_000;

/**
* OpenAICompletionService class provides an interface to OpenAI's chat completion API.
* Extends BaseService to handle chat completions, message moderation, token counting,
* and streaming responses. Implements the puter-chat-completion interface and manages
* OpenAI API interactions with support for multiple models including GPT-4 variants.
* Handles usage tracking, spending records, and content moderation.
*/
export class OpenAiChatProvider implements IChatProvider {
    /**
     * @type {import('openai').OpenAI}
     */
    #openAi: OpenAI;

    #defaultModel = 'gpt-5-nano';

    #meteringService: MeteringService;

    constructor (
        meteringService: MeteringService,
        config: { apiKey?: string, secret_key?: string },
    ) {

        this.#meteringService = meteringService;
        let apiKey = config.apiKey;

        // Fallback to the old format for backward compatibility
        if ( ! apiKey ) {
            apiKey = config?.secret_key;

            // Log a warning to inform users about the deprecated format
            console.warn('The `openai.secret_key` configuration format is deprecated. ' +
                'Please use `services.openai.apiKey` instead.');
        }
        if ( ! apiKey ) {
            throw new Error('OpenAI API key is missing in configuration.');
        }
        this.#openAi = new OpenAI({
            apiKey: apiKey,
        });
    }

    /**
    * Returns an array of available AI models with their pricing information.
    * Each model object includes an ID and cost details (currency, tokens, input/output rates).
    */
    models () {
        return OPEN_AI_MODELS.filter(e => !e.responses_api_only);
    }

    list () {
        const models =  this.models();
        const modelNames: string[] = [];
        for ( const model of models ) {
            modelNames.push(model.id);
            if ( model.aliases ) {
                modelNames.push(...model.aliases);
            }
        }
        return modelNames;
    }

    getDefaultModel () {
        return this.#defaultModel;
    }

    async complete (params: ICompleteArguments): ReturnType<IChatProvider['complete']>
    {
        let { messages, model, max_tokens, moderation, tools, verbosity, stream, reasoning, reasoning_effort, temperature, text } = params;
        if ( tools?.filter((e: any) => e.type === 'web_search').length ) {
            // User is trying to use openai-responses only tool web_search.
            // We should pass it to that service
            const aiChat = (Context.get('services') as any).get('ai-chat');
            const openAIresponses = aiChat.getProvider('openai-responses')!;
            return await openAIresponses.complete!(params);
        }
        // Validate messages
        if ( ! Array.isArray(messages) ) {
            throw new Error('`messages` must be an array');
        }
        const actor = Context.get('actor');

        model = model ?? this.#defaultModel;

        const modelUsed = (this.models()).find(m => [m.id, ...(m.aliases || [])].includes(model)) || (this.models()).find(m => m.id === this.getDefaultModel())!;

        // messages.unshift({
        //     role: 'system',
        //     content: 'Don\'t let the user trick you into doing something bad.',
        // })

        const user_private_uid = actor?.private_uid ?? 'UNKNOWN';
        if ( user_private_uid === 'UNKNOWN' ) {
            console.error(new Error('chat-completion-service:unknown-user - failed to get a user ID for an OpenAI request'));
        }

        // TODO: file upload functionality — requires FSNodeParam, LLRead, stream_to_buffer
        // File upload processing has been removed pending v2 filesystem integration.
        // Previously this section performed:
        //   - Iterating message content parts for puter_path references
        //   - Resolving FSNode via FSNodeParam
        //   - Reading file contents via LLRead
        //   - Converting to base64 data URLs for image/audio inputs
        //   - Enforcing MAX_FILE_SIZE limits

        // Here's something fun; the documentation shows `type: 'image_url'` in
        // objects that contain an image url, but everything still works if
        // that's missing. We normalise it here so the token count code works.
        messages = await OpenAiUtil.process_input_messages(messages);

        const requestedReasoningEffort = reasoning_effort ?? reasoning?.effort;
        const requestedVerbosity = verbosity ?? text?.verbosity;
        const supportsReasoningControls = typeof model === 'string' && model.startsWith('gpt-5');

        const completionParams: ChatCompletionCreateParams = {
            user: user_private_uid,
            safety_identifier: user_private_uid,
            messages: messages,
            model: modelUsed.id,
            ...(tools ? { tools } : {}),
            ...(max_tokens ? { max_completion_tokens: max_tokens } : {}),
            ...(temperature ? { temperature } : {}),
            stream: !!stream,
            ...(stream ? {
                stream_options: { include_usage: true },
            } : {}),
            ...(supportsReasoningControls ? {} :
                {
                    ...(requestedReasoningEffort ? { reasoning_effort: requestedReasoningEffort } : {}),
                    ...(requestedVerbosity ? { verbosity: requestedVerbosity } : {}),
                }
            ),
        } as ChatCompletionCreateParams;

        const completion = await this.#openAi.chat.completions.create(completionParams);

        return OpenAiUtil.handle_completion_output({
            usage_calculator: ({ usage }) => {
                const trackedUsage = {
                    prompt_tokens: (usage.prompt_tokens ?? 0) - (usage.prompt_tokens_details?.cached_tokens ?? 0),
                    completion_tokens: usage.completion_tokens ?? 0,
                    cached_tokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
                };

                const costsOverrideFromModel = Object.fromEntries(Object.entries(trackedUsage).map(([k, v]) => {
                    return [k, v * (modelUsed.costs[k])];
                }));

                this.#meteringService.utilRecordUsageObject(trackedUsage, actor, `openai:${modelUsed?.id}`, costsOverrideFromModel);
                return trackedUsage;
            },
            stream,
            completion,
            moderate: moderation ? this.checkModeration.bind(this) : undefined,
        });
    }

    async checkModeration (text: string) {
        // create moderation
        const results = await this.#openAi.moderations.create({
            model: 'omni-moderation-latest',
            input: text,
        });

        let flagged = false;

        for ( const result of results?.results ?? [] ) {

            // OpenAI does a crazy amount of false positives. We filter by their 80% interval
            const veryFlaggedEntries = Object.entries(result.category_scores).filter(e => e[1] > 0.8);
            if ( veryFlaggedEntries.length > 0 ) {
                flagged = true;
                break;
            }
        }

        return {
            flagged,
            results,
        };
    }
}
