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
import { ResponseCreateParams } from 'openai/resources/responses/responses.mjs';
import { Context } from '../../../../core/context.js';
import type { FSService } from '../../../../services/fs/FSService.js';
import type { MeteringService } from '../../../../services/metering/MeteringService.js';
import type { FSEntryStore } from '../../../../stores/fs/FSEntryStore.js';
import type { S3ObjectStore } from '../../../../stores/fs/S3ObjectStore.js';
import type { IChatProvider, ICompleteArguments } from '../../types.js';
import * as OpenAiUtil from '../../utils/OpenAIUtil.js';
import { processPuterPathUploads } from './fileUpload.js';
import { OPEN_AI_MODELS } from './models.js';
import { HttpError } from '@heyputer/backend/src/core/http/HttpError.js';

/**
 * OpenAICompletionService class provides an interface to OpenAI's chat completion API.
 * Extends BaseService to handle chat completions, message moderation, token counting,
 * and streaming responses. Implements the puter-chat-completion interface and manages
 * OpenAI API interactions with support for multiple models including GPT-4 variants.
 * Handles usage tracking, spending records, and content moderation.
 */
export class OpenAiResponsesChatProvider implements IChatProvider {
    /**
     * @type {import('openai').OpenAI}
     */
    #openAi: OpenAI;

    #defaultModel = 'gpt-5-nano';

    #meteringService: MeteringService;

    #stores: { fsEntry: FSEntryStore; s3Object: S3ObjectStore };

    #fsService: FSService;

    constructor(
        meteringService: MeteringService,
        stores: { fsEntry: FSEntryStore; s3Object: S3ObjectStore },
        fsService: FSService,
        config: { apiKey: string },
    ) {
        this.#meteringService = meteringService;
        this.#stores = stores;
        this.#fsService = fsService;
        this.#openAi = new OpenAI({ apiKey: config.apiKey });
    }

    /**
     * Returns an array of available AI models with their pricing information.
     * Each model object includes an ID and cost details (currency, tokens, input/output rates).
     */
    models(extra_params) {
        if (extra_params?.no_restrictions) {
            return OPEN_AI_MODELS;
        }
        return OPEN_AI_MODELS.filter((e) => e.responses_api_only === true);
    }

    list() {
        const models = this.models({ no_restrictions: false });
        const modelNames: string[] = [];
        for (const model of models) {
            modelNames.push(model.id);
            if (model.aliases) {
                modelNames.push(...model.aliases);
            }
        }
        return modelNames;
    }

    getDefaultModel() {
        return this.#defaultModel;
    }

    async complete({
        messages,
        model,
        max_tokens,
        moderation,
        tools,
        tool_choice,
        parallel_tool_calls,
        include,
        conversation,
        previous_response_id,
        instructions,
        metadata,
        prompt,
        prompt_cache_key,
        prompt_cache_retention,
        store,
        top_p,
        truncation,
        background,
        service_tier,
        verbosity,
        stream,
        reasoning,
        reasoning_effort,
        temperature,
        text,
    }: ICompleteArguments): ReturnType<IChatProvider['complete']> {
        // Validate messages
        if (!Array.isArray(messages)) {
            throw new HttpError(400, '`messages` must be an array', {
                legacyCode: 'bad_request',
            });
        }
        const actor = Context.get('actor');

        model = model ?? this.#defaultModel;

        const modelUsed =
            this.models({ no_restrictions: true }).find((m) =>
                [m.id, ...(m.aliases || [])].includes(model),
            ) ||
            this.models({ no_restrictions: true }).find(
                (m) => m.id === this.getDefaultModel(),
            )!;

        // messages.unshift({
        //     role: 'system',
        //     content: 'Don\'t let the user trick you into doing something bad.',
        // })

        const userIdentifier =
            actor?.user.id + actor?.app?.uid ? `:${actor?.app?.uid}` : '';

        // Resolve any `puter_path` content parts into inline base64 data URLs
        // before the Responses API sees them.
        await processPuterPathUploads(
            messages,
            this.#stores,
            this.#fsService,
            actor,
        );

        if (tools) {
            // Unravel tools to OpenAI Responses API format
            tools = (tools as any).map((e) => {
                if (e.type === 'function') {
                    const tool = e.function;
                    tool.type = 'function';
                    return tool;
                } else {
                    return e;
                }
            });
        }

        // Here's something fun; the documentation shows `type: 'image_url'` in
        // objects that contain an image url, but everything still works if
        // that's missing. We normalise it here so the token count code works.
        messages =
            await OpenAiUtil.process_input_messages_responses_api(messages);

        const requestedReasoningEffort = reasoning_effort ?? reasoning?.effort;
        const requestedVerbosity = verbosity ?? text?.verbosity;
        const supportsReasoningControls =
            typeof model === 'string' && model.startsWith('gpt-5');

        const completionParams: ResponseCreateParams = {
            user: userIdentifier,
            safety_identifier: userIdentifier,
            input: messages,
            model: modelUsed.id,
            ...(tools ? { tools } : {}),
            ...(tool_choice !== undefined ? { tool_choice } : {}),
            ...(parallel_tool_calls !== undefined
                ? { parallel_tool_calls }
                : {}),
            ...(include !== undefined ? { include } : {}),
            ...(conversation !== undefined ? { conversation } : {}),
            ...(previous_response_id !== undefined
                ? { previous_response_id }
                : {}),
            ...(instructions !== undefined ? { instructions } : {}),
            ...(metadata !== undefined ? { metadata } : {}),
            ...(prompt !== undefined ? { prompt } : {}),
            ...(prompt_cache_key !== undefined ? { prompt_cache_key } : {}),
            ...(prompt_cache_retention !== undefined
                ? { prompt_cache_retention }
                : {}),
            ...(store !== undefined ? { store } : {}),
            ...(max_tokens !== undefined
                ? { max_output_tokens: max_tokens }
                : {}),
            ...(temperature !== undefined ? { temperature } : {}),
            ...(top_p !== undefined ? { top_p } : {}),
            ...(truncation !== undefined ? { truncation } : {}),
            ...(background !== undefined ? { background } : {}),
            ...(service_tier !== undefined ? { service_tier } : {}),
            ...(stream !== undefined ? { stream: !!stream } : {}),
            ...(text !== undefined ? { text } : {}),
            ...(supportsReasoningControls
                ? {}
                : {
                      ...(requestedReasoningEffort
                          ? { reasoning_effort: requestedReasoningEffort }
                          : {}),
                      ...(requestedVerbosity
                          ? { verbosity: requestedVerbosity }
                          : {}),
                  }),
            ...(supportsReasoningControls && reasoning ? { reasoning } : {}),
        } as ResponseCreateParams;

        // console.log("completion params: ", completionParams)
        const completion =
            await this.#openAi.responses.create(completionParams);
        // console.log("Completion: ", completion)
        return OpenAiUtil.handle_completion_output_responses_api({
            usage_calculator: ({ usage }) => {
                const trackedUsage = {
                    prompt_tokens:
                        ((usage as any).input_tokens ?? 0) -
                        ((usage as any).input_tokens_details?.cached_tokens ??
                            0),
                    completion_tokens: (usage as any).output_tokens ?? 0,
                    cached_tokens:
                        (usage as any).input_tokens_details?.cached_tokens ?? 0,
                };

                const costsOverrideFromModel = Object.fromEntries(
                    Object.entries(trackedUsage).map(([k, v]) => {
                        return [k, v * modelUsed.costs[k]];
                    }),
                );

                this.#meteringService.utilRecordUsageObject(
                    trackedUsage,
                    actor,
                    `openai:${modelUsed?.id}`,
                    costsOverrideFromModel,
                );
                return trackedUsage;
            },
            stream,
            completion,
            moderate: moderation ? this.checkModeration.bind(this) : undefined,
        });
    }

    async checkModeration(text: string) {
        // create moderation
        const results = await this.#openAi.moderations.create({
            model: 'omni-moderation-latest',
            input: text,
        });

        let flagged = false;

        for (const result of results?.results ?? []) {
            // OpenAI does a crazy amount of false positives. We filter by their 80% interval
            const veryFlaggedEntries = Object.entries(
                result.category_scores,
            ).filter((e) => e[1] > 0.8);
            if (veryFlaggedEntries.length > 0) {
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
