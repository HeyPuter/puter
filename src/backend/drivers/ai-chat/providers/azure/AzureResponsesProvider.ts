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
import type {
    IChatModel,
    IChatProvider,
    ICompleteArguments,
} from '../../types.js';
import { toOpenAiContextManagement } from '../../utils/compaction.js';
import { make_openai_tools } from '../../utils/FunctionCalling.js';
import * as OpenAiUtil from '../../utils/OpenAIUtil.js';
import {
    openAICompatParams,
    rejectStatefulResponsesFields,
} from '../../utils/openaiParams.js';
import { buildCostsOverride } from '../../utils/pricing.js';
import { processPuterPathUploads } from '../openai/fileUpload.js';
import { AZURE_MODELS } from './models.js';
import { HttpError } from '@heyputer/backend/src/core/http/HttpError.js';
import { modelLookupNames } from '../../utils/modelRouting.js';
import { upstreamUserIdentifier } from '../../../util/upstreamIdentifier.js';
import { AI_WEB_SEARCH_MAX_USES } from '../../../util/aiLimits.js';

const ANTHROPIC_WEB_SEARCH_TYPE = (type: unknown): boolean =>
    type === 'web_search_20250305' ||
    (typeof type === 'string' && /^web_search_2026/.test(type));

// Same rates as the OpenAI Responses provider — Azure fronts the same
// upstream models at the same published prices (see that file's comment).
const WEB_SEARCH_CALL_RATE = 1_000_000;
const WEB_SEARCH_PREVIEW_NON_REASONING_RATE = 2_500_000;

const isReasoningModel = (modelId: string): boolean =>
    /^gpt-(5|6)([.-]|$)/.test(modelId);

const webSearchCallRate = (
    tools: unknown[] | undefined,
    modelId: string,
): number | undefined => {
    const list = (tools ?? []) as Array<Record<string, unknown>>;
    const hasPreview = list.some((t) => t?.type === 'web_search_preview');
    const hasOther = list.some(
        (t) => t?.type === 'web_search' || ANTHROPIC_WEB_SEARCH_TYPE(t?.type),
    );
    if (!hasPreview && !hasOther) return undefined;
    if (hasPreview && !isReasoningModel(modelId)) {
        return WEB_SEARCH_PREVIEW_NON_REASONING_RATE;
    }
    return WEB_SEARCH_CALL_RATE;
};

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
    /** @type {import('openai').OpenAI} */
    #openAi: OpenAI;

    #defaultModel = 'gpt-5.3-codex';

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
     * Each model object includes an ID and cost details (currency, tokens,
     * input/output rates).
     */
    models(extra_params?: { no_restrictions?: boolean }) {
        if (extra_params?.no_restrictions) {
            return AZURE_MODELS;
        }
        return AZURE_MODELS.filter((e) => e.responses_api_only === true);
    }

    list() {
        return modelLookupNames(this.models({ no_restrictions: false }));
    }

    getDefaultModel() {
        return this.#defaultModel;
    }

    /** The model key this provider records usage under. */
    meteringModelKey(modelId: string | undefined): string {
        return `azure-openai:${modelId}`;
    }

    /** See the sibling OpenAI Responses provider's note on web search metering. */
    requestPricing(
        args: ICompleteArguments,
        model: IChatModel,
    ): { inputKey?: string; outputKey?: string; extraCost?: number } {
        const rate = webSearchCallRate(args.tools, model.id);
        if (!rate) return {};
        return { extraCost: AI_WEB_SEARCH_MAX_USES.default * rate };
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
        outputFormat,
    }: ICompleteArguments): ReturnType<IChatProvider['complete']> {
        // Validate messages
        if (!Array.isArray(messages)) {
            throw new HttpError(400, '`messages` must be an array', {
                legacyCode: 'bad_request',
            });
        }
        rejectStatefulResponsesFields({
            previous_response_id,
            conversation,
            prompt,
            background,
        });
        const actor = Context.get('actor');

        model = model ?? this.#defaultModel;

        const modelUsed =
            this.models({ no_restrictions: true }).find((m) =>
                [m.id, ...(m.aliases || [])].includes(model),
            ) ||
            this.models({ no_restrictions: true }).find(
                (m) => m.id === this.getDefaultModel(),
            )!;

        const userIdentifier = upstreamUserIdentifier(actor);
        // Cache key defaults to the actor identifier; see upstreamUserIdentifier.
        const cacheKey = prompt_cache_key ?? userIdentifier;

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
            tools = (tools as any[]).map((e) => {
                if (e.type === 'function') {
                    const tool = e.function;
                    tool.type = 'function';
                    return tool;
                } else {
                    return e;
                }
            });
        }
        const mappedTools = tools
            ? make_openai_tools(tools, { dialect: 'responses' })
            : undefined;

        // Strip Anthropic-only shape a fallback-replayed message can carry
        // before the existing in-place coercion mutates only this pass's copy.
        messages = OpenAiUtil.toOpenAIChatMessages(messages);
        // Here's something fun; the documentation shows `type: 'image_url'` in
        // objects that contain an image url, but everything still works if
        // that's missing. We normalise it here so the token count code works.
        messages =
            await OpenAiUtil.process_input_messages_responses_api(messages);

        const requestedReasoningEffort = reasoning_effort ?? reasoning?.effort;
        const requestedVerbosity = verbosity ?? text?.verbosity;
        // gpt-5/gpt-6 are the reasoning-capable families; every other model
        // 400s on an unsupported `reasoning`/`verbosity` control.
        const supportsReasoningControls = /^gpt-(5|6)([.-]|$)/.test(
            modelUsed.id,
        );

        // Translate the neutral compaction opt-in (or pass a raw
        // `context_management` payload through) to OpenAI's Responses shape.
        const contextManagement = toOpenAiContextManagement({
            compaction,
            context_management,
        });

        const mapped = openAICompatParams(
            {
                tools: mappedTools,
                tool_choice,
                parallel_tool_calls,
                outputFormat,
                top_p,
            } as ICompleteArguments,
            'responses',
        );
        const mergedText = {
            ...(text ?? {}),
            ...((mapped.text as Record<string, unknown>) ?? {}),
            ...(supportsReasoningControls && requestedVerbosity !== undefined
                ? { verbosity: requestedVerbosity }
                : {}),
        };
        const mergedReasoning = {
            ...(supportsReasoningControls && reasoning ? reasoning : {}),
            ...(supportsReasoningControls &&
            requestedReasoningEffort !== undefined
                ? { effort: requestedReasoningEffort }
                : {}),
        };

        const completionParams: ResponseCreateParams = {
            user: userIdentifier,
            safety_identifier: userIdentifier,
            input: messages,
            model: modelUsed.id,
            ...(mappedTools?.length ? { tools: mappedTools } : {}),
            ...(include !== undefined ? { include } : {}),
            ...(contextManagement !== undefined
                ? { context_management: contextManagement }
                : {}),
            ...(instructions !== undefined ? { instructions } : {}),
            ...(metadata !== undefined ? { metadata } : {}),
            ...(cacheKey !== undefined ? { prompt_cache_key: cacheKey } : {}),
            ...(prompt_cache_retention !== undefined
                ? { prompt_cache_retention }
                : {}),
            ...(store !== undefined ? { store } : {}),
            ...(max_tokens !== undefined
                ? { max_output_tokens: max_tokens }
                : {}),
            ...(temperature !== undefined ? { temperature } : {}),
            ...(truncation !== undefined ? { truncation } : {}),
            ...(service_tier !== undefined ? { service_tier } : {}),
            ...(stream !== undefined ? { stream: !!stream } : {}),
            ...mapped,
            ...(Object.keys(mergedText).length ? { text: mergedText } : {}),
            ...(Object.keys(mergedReasoning).length
                ? { reasoning: mergedReasoning }
                : {}),
        } as unknown as ResponseCreateParams;

        const completion =
            await this.#openAi.responses.create(completionParams);
        return OpenAiUtil.handle_completion_output_responses_api({
            usage_calculator: ({ usage, webSearchCalls }) => {
                const trackedUsage: Record<string, number> = {
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
                    ...(webSearchCalls
                        ? { web_search_calls: webSearchCalls }
                        : {}),
                };

                const costsOverrideFromModel = buildCostsOverride(
                    trackedUsage,
                    modelUsed,
                );
                if (webSearchCalls) {
                    const rate = webSearchCallRate(tools, modelUsed.id) ?? 0;
                    costsOverrideFromModel.web_search_calls =
                        webSearchCalls * rate;
                }

                this.#meteringService.utilRecordUsageObject(
                    trackedUsage,
                    actor,
                    this.meteringModelKey(modelUsed?.id),
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
