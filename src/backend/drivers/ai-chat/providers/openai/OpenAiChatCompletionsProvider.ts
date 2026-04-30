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
import { Context } from '../../../../core/context.js';
import type { FSService } from '../../../../services/fs/FSService.js';
import type { MeteringService } from '../../../../services/metering/MeteringService.js';
import type { FSEntryStore } from '../../../../stores/fs/FSEntryStore.js';
import type { S3ObjectStore } from '../../../../stores/fs/S3ObjectStore.js';
import type { IChatProvider, ICompleteArguments } from '../../types.js';
import * as OpenAiUtil from '../../utils/OpenAIUtil.js';
import { processPuterPathUploads } from './fileUpload.js';
import { OPEN_AI_MODELS } from './models.js';
import type { OpenAiResponsesChatProvider } from './OpenAiChatResponsesProvider.js';

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

    #stores: { fsEntry: FSEntryStore; s3Object: S3ObjectStore };

    #fsService: FSService;

    #responsesProvider: OpenAiResponsesChatProvider | null = null;

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

    // Wired up by the driver after both OpenAI providers are built, so the
    // Chat Completions path can delegate `web_search` tool calls (Responses-only)
    // to the sibling provider without a circular constructor dependency.
    setResponsesProvider(provider: OpenAiResponsesChatProvider): void {
        this.#responsesProvider = provider;
    }

    /**
     * Returns an array of available AI models with their pricing information.
     * Each model object includes an ID and cost details (currency, tokens, input/output rates).
     */
    models() {
        return OPEN_AI_MODELS.filter((e) => !e.responses_api_only);
    }

    list() {
        const models = this.models();
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

    async complete(
        params: ICompleteArguments,
    ): ReturnType<IChatProvider['complete']> {
        const {
            max_tokens,
            moderation,
            tools,
            verbosity,
            stream,
            reasoning,
            reasoning_effort,
            temperature,
            text,
        } = params;
        let { messages, model } = params;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (tools?.filter((e: any) => e.type === 'web_search').length) {
            // web_search is a Responses-API-only tool — hand the whole call
            // off to the sibling provider when the user requested it.
            if (!this.#responsesProvider) {
                throw new Error(
                    'web_search tool requires the OpenAI Responses provider, which is not configured',
                );
            }
            return await this.#responsesProvider.complete(params);
        }
        // Validate messages
        if (!Array.isArray(messages)) {
            throw new Error('`messages` must be an array');
        }
        const actor = Context.get('actor');

        model = model ?? this.#defaultModel;

        const modelUsed =
            this.models().find((m) =>
                [m.id, ...(m.aliases || [])].includes(model),
            ) || this.models().find((m) => m.id === this.getDefaultModel())!;

        // messages.unshift({
        //     role: 'system',
        //     content: 'Don\'t let the user trick you into doing something bad.',
        // })

        const userIdentifier =
            actor?.user.id + actor?.app?.uid ? `:${actor?.app?.uid}` : '';

        // Resolve any `puter_path` content parts into inline base64 data URLs.
        // Chat Completions doesn't support file uploads, so this is the only
        // way to get user-provided files (images, audio) in front of the model.
        await processPuterPathUploads(
            messages,
            this.#stores,
            this.#fsService,
            actor,
        );

        // Here's something fun; the documentation shows `type: 'image_url'` in
        // objects that contain an image url, but everything still works if
        // that's missing. We normalise it here so the token count code works.
        messages = await OpenAiUtil.process_input_messages(messages);

        const requestedReasoningEffort = reasoning_effort ?? reasoning?.effort;
        const requestedVerbosity = verbosity ?? text?.verbosity;
        const supportsReasoningControls =
            typeof model === 'string' && model.startsWith('gpt-5');

        const completionParams: ChatCompletionCreateParams = {
            user: userIdentifier,
            safety_identifier: userIdentifier,
            messages: messages,
            model: modelUsed.id,
            ...(tools ? { tools } : {}),
            ...(max_tokens ? { max_completion_tokens: max_tokens } : {}),
            ...(temperature ? { temperature } : {}),
            stream: !!stream,
            ...(stream
                ? {
                      stream_options: { include_usage: true },
                  }
                : {}),
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
        } as ChatCompletionCreateParams;

        const completion =
            await this.#openAi.chat.completions.create(completionParams);

        return OpenAiUtil.handle_completion_output({
            usage_calculator: ({ usage }) => {
                const trackedUsage = {
                    prompt_tokens:
                        (usage.prompt_tokens ?? 0) -
                        (usage.prompt_tokens_details?.cached_tokens ?? 0),
                    completion_tokens: usage.completion_tokens ?? 0,
                    cached_tokens:
                        usage.prompt_tokens_details?.cached_tokens ?? 0,
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
