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
import { toOpenAiContextManagement } from '../../utils/compaction.js';
import * as OpenAiUtil from '../../utils/OpenAIUtil.js';
import { processPuterPathUploads } from '../openai/fileUpload.js';
import { AZURE_MODELS } from './models.js';
import { HttpError } from '@heyputer/backend/src/core/http/HttpError.js';

/**
 * AzureResponsesProvider serves the Responses-API-only models we expose through
 * Azure AI Foundry (the Codex family and similar). It mirrors
 * {@link OpenAiResponsesChatProvider}, but points the OpenAI client at the
 * configurable Azure endpoint and draws from {@link AZURE_MODELS}.
 *
 * Codex / `responses_api_only` models reject the Chat Completions endpoint, so
 * the sibling {@link AzureChatProvider} (Chat Completions) filters them out and
 * the driver routes them here instead.
 *
 * Billing note: the model `costs` are the standard public OpenAI list prices,
 * NOT Azure's — Azure is subsidised for us.
 */
export class AzureResponsesProvider implements IChatProvider {
    /**
     * @type {import('openai').OpenAI}
     */
    #openAi: OpenAI;

    #defaultModel = 'gpt-5-codex';

    #meteringService: MeteringService;

    #stores: { fsEntry: FSEntryStore; s3Object: S3ObjectStore };

    #fsService: FSService;

    constructor(
        meteringService: MeteringService,
        stores: { fsEntry: FSEntryStore; s3Object: S3ObjectStore },
        fsService: FSService,
        config: { apiKey: string; apiURL: string },
    ) {
        this.#meteringService = meteringService;
        this.#stores = stores;
        this.#fsService = fsService;
        this.#openAi = new OpenAI({
            apiKey: config.apiKey,
            baseURL: config.apiURL,
        });
    }

    /**
     * Returns an array of available AI models with their pricing information.
     * Each model object includes an ID and cost details (currency, tokens, input/output rates).
     */
    models(extra_params?: { no_restrictions?: boolean }) {
        if (extra_params?.no_restrictions) {
            return AZURE_MODELS;
        }
        return AZURE_MODELS.filter((e) => e.responses_api_only === true);
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
        compaction,
        context_management,
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
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

        // Translate the neutral compaction opt-in (or pass a raw
        // `context_management` payload through) to OpenAI's Responses shape.
        const contextManagement = toOpenAiContextManagement({
            compaction,
            context_management,
        });

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
            ...(contextManagement !== undefined
                ? { context_management: contextManagement }
                : {}),
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

        const completion =
            await this.#openAi.responses.create(completionParams);
        return OpenAiUtil.handle_completion_output_responses_api({
            usage_calculator: ({ usage }) => {
                const trackedUsage = {
                    prompt_tokens:
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        ((usage as any).input_tokens ?? 0) -
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        ((usage as any).input_tokens_details?.cached_tokens ??
                            0),
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    completion_tokens: (usage as any).output_tokens ?? 0,
                    cached_tokens:
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
                    `azure-openai:${modelUsed?.id}`,
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
