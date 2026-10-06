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
    clampReasoningEffort,
    openAICompatParams,
    rejectStatefulResponsesFields,
} from '../../utils/openaiParams.js';
import { buildCostsOverride } from '../../utils/pricing.js';
import { responseSamplingParams } from '../../utils/responseSampling.js';
import { processPuterPathUploads } from './fileUpload.js';
import { OPEN_AI_MODELS } from './models.js';
import { HttpError } from '@heyputer/backend/src/core/http/HttpError.js';
import { modelLookupNames } from '../../utils/modelRouting.js';
import { upstreamUserIdentifier } from '../../../util/upstreamIdentifier.js';

const ANTHROPIC_WEB_SEARCH_TYPE = (type: unknown): boolean =>
    type === 'web_search_20250305' ||
    (typeof type === 'string' && /^web_search_2026/.test(type));

// $10/1k calls for `web_search` on every model, and for `web_search_preview`
// on a reasoning model; $25/1k for `web_search_preview` on a non-reasoning
// model (verified against platform.openai.com/docs/pricing, 2026-10).
const WEB_SEARCH_CALL_RATE = 1_000_000;
const WEB_SEARCH_PREVIEW_NON_REASONING_RATE = 2_500_000;

const isReasoningModel = (modelId: string): boolean =>
    /^gpt-(5|6)([.-]|$)/.test(modelId);

/** Μ¢ per call for whichever web-search-shaped tool a request carries. */
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
 * OpenAICompletionService class provides an interface to OpenAI's chat
 * completion API. Extends BaseService to handle chat completions, message
 * moderation, token counting, and streaming responses. Implements the
 * puter-chat-completion interface and manages OpenAI API interactions with
 * support for multiple models including GPT-4 variants. Handles usage tracking,
 * spending records, and content moderation.
 */
export class OpenAiResponsesChatProvider implements IChatProvider {
    /** @type {import('openai').OpenAI} */
    #openAi: OpenAI;

    #defaultModel = 'gpt-6-luna';

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
     * Each model object includes an ID and cost details (currency, tokens,
     * input/output rates).
     */
    models(extra_params?: { no_restrictions?: boolean }) {
        if (extra_params?.no_restrictions) {
            return OPEN_AI_MODELS;
        }
        return OPEN_AI_MODELS.filter(
            (e) => e.responses_api_only === true || e.responses_api === true,
        );
    }

    list() {
        return modelLookupNames(this.models({ no_restrictions: false }));
    }

    getDefaultModel() {
        return this.#defaultModel;
    }

    /** The model key this provider records usage under. */
    meteringModelKey(modelId: string | undefined): string {
        return `openai:${modelId}`;
    }

    /**
     * Sizes the credit hold for a web-search tool: one call's worth, at
     * whichever rate the tool variant and model imply. OpenAI doesn't bound how
     * many searches a single request can run — every call is metered at
     * settlement, so the hold only needs to cover the model actually trying.
     */
    requestPricing(
        args: ICompleteArguments,
        model: IChatModel,
    ): { inputKey?: string; outputKey?: string; extraCost?: number } {
        const rate = webSearchCallRate(args.tools, model.id);
        return rate ? { extraCost: rate } : {};
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

        // messages.unshift({
        //     role: 'system',
        //     content: 'Don\'t let the user trick you into doing something bad.',
        // })

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
        const clampedEffort = clampReasoningEffort(
            modelUsed.id,
            requestedReasoningEffort,
        );
        // gpt-5/gpt-6 are the reasoning-capable families in this catalog;
        // every other model 400s on an unsupported `verbosity` (the effort
        // param is handled by the clamp above).
        const supportsReasoningFamily = /^gpt-(5|6)([.-]|$)/.test(modelUsed.id);
        const isCodexModel = /^gpt-5(\.\d+)?-codex/.test(modelUsed.id);

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
            } as ICompleteArguments,
            'responses',
        );
        // `text`/`reasoning` have several sources (the client's raw object,
        // the legacy `verbosity`/`reasoning_effort` fields, and now
        // `outputFormat`'s `text.format`) — merged here rather than spread
        // separately, since a later spread of the same top-level key would
        // silently replace the earlier one instead of merging into it.
        const mergedText = {
            ...(text ?? {}),
            ...((mapped.text as Record<string, unknown>) ?? {}),
            ...(supportsReasoningFamily &&
            !isCodexModel &&
            requestedVerbosity !== undefined
                ? { verbosity: requestedVerbosity }
                : {}),
        };
        // The raw `reasoning` object's own `effort` is never trusted
        // verbatim — only the clamped value below is.
        const { effort: _rawEffort, ...reasoningRest } = reasoning ?? {};
        const mergedReasoning = {
            ...(supportsReasoningFamily ? reasoningRest : {}),
            ...(clampedEffort !== undefined ? { effort: clampedEffort } : {}),
        };

        const completionParams: ResponseCreateParams = {
            user: userIdentifier,
            safety_identifier: userIdentifier,
            input: messages,
            model: modelUsed.id,
            ...(mappedTools?.length ? { tools: mappedTools } : {}),
            ...responseSamplingParams(
                modelUsed,
                { temperature, top_p, include },
                clampedEffort,
            ),
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
            ...(truncation !== undefined ? { truncation } : {}),
            ...(service_tier !== undefined ? { service_tier } : {}),
            ...(stream !== undefined ? { stream: !!stream } : {}),
            ...mapped,
            ...(Object.keys(mergedText).length ? { text: mergedText } : {}),
            ...(Object.keys(mergedReasoning).length
                ? { reasoning: mergedReasoning }
                : {}),
        } as unknown as ResponseCreateParams;

        const completion = await this.#openAi.responses.create(
            completionParams,
            { signal: Context.get('abortSignal') },
        );
        return OpenAiUtil.handle_completion_output_responses_api({
            usage_calculator: ({ usage, webSearchCalls, setUsageCosts }) => {
                const cachedTokens =
                    (usage as any).input_tokens_details?.cached_tokens ?? 0;
                // GPT-5.6 and later bill cache writes at 1.25x input. They're
                // reported inside `input_tokens`, like cached reads.
                const cacheWriteTokens =
                    (usage as any).input_tokens_details?.cache_write_tokens ??
                    0;
                const trackedUsage: Record<string, number> = {
                    prompt_tokens:
                        ((usage as any).input_tokens ?? 0) -
                        cachedTokens -
                        cacheWriteTokens,
                    completion_tokens: (usage as any).output_tokens ?? 0,
                    cached_tokens: cachedTokens,
                    ...(cacheWriteTokens
                        ? { cache_write_tokens: cacheWriteTokens }
                        : {}),
                    ...(webSearchCalls
                        ? { web_search_calls: webSearchCalls }
                        : {}),
                };

                const costsOverrideFromModel = buildCostsOverride(
                    trackedUsage,
                    modelUsed,
                );
                // Priced dynamically: the rate depends on which
                // web-search tool variant was requested and whether the model
                // is a reasoning model, not a static per-model cost-table
                // entry — `buildCostsOverride`'s fallback would otherwise
                // price it (wrongly) at the input/output token rate.
                if (webSearchCalls) {
                    const rate = webSearchCallRate(tools, modelUsed.id) ?? 0;
                    costsOverrideFromModel.web_search_calls =
                        webSearchCalls * rate;
                    setUsageCosts?.({
                        web_search_calls:
                            costsOverrideFromModel.web_search_calls,
                    });
                }

                this.#meteringService.utilRecordUsageObject(
                    trackedUsage,
                    actor!,
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
