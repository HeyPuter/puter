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

import { HttpError } from '@heyputer/backend/src/core/http/HttpError.js';
import { OpenAI } from 'openai';
import { ChatCompletionCreateParams } from 'openai/resources/index.js';
import { servedServiceSpeed } from '../../utils/serviceSpeed.js';
import { Context } from '../../../../core/context.js';
import type { MeteringService } from '../../../../services/metering/MeteringService.js';
import type {
    IChatModel,
    IChatProvider,
    ICompleteArguments,
} from '../../types.js';
import {
    messagesHaveCompaction,
    wantsCompaction,
} from '../../utils/compaction.js';
import { make_openai_tools } from '../../utils/FunctionCalling.js';
import * as OpenAiUtil from '../../utils/OpenAIUtil.js';
import {
    clampReasoningEffort,
    messagesHaveCacheBreakpointTtl,
    openAICompatParams,
    promptCacheOptionsToWire,
    promptCacheRetentionToWire,
} from '../../utils/openaiParams.js';
import { OPEN_AI_MODELS } from './models.js';
import type { OpenAiResponsesChatProvider } from './OpenAiChatResponsesProvider.js';
import { upstreamUserIdentifier } from '../../../util/upstreamIdentifier.js';
import { sdkClientOptions, sdkRetryOptions } from '../../utils/sdkClient.js';
import { meterChatUsage } from '../../utils/meterChatUsage.js';

const isWebSearchTool = (tool: Record<string, unknown>): boolean =>
    tool.type === 'web_search' ||
    tool.type === 'web_search_preview' ||
    tool.type === 'web_search_20250305' ||
    (typeof tool.type === 'string' && /^web_search_2026/.test(tool.type));

/**
 * OpenAICompletionService class provides an interface to OpenAI's chat
 * completion API. Extends BaseService to handle chat completions, message
 * moderation, token counting, and streaming responses. Implements the
 * puter-chat-completion interface and manages OpenAI API interactions with
 * support for multiple models including GPT-4 variants. Handles usage tracking,
 * spending records, and content moderation.
 */
export class OpenAiChatProvider implements IChatProvider {
    /** @type {import('openai').OpenAI} */
    #openAi: OpenAI;

    #defaultModel = 'gpt-6-luna';

    #meteringService: MeteringService;

    #responsesProvider: OpenAiResponsesChatProvider | null = null;

    constructor(config: { apiKey: string }, meteringService: MeteringService) {
        this.#meteringService = meteringService;
        this.#openAi = new OpenAI({
            apiKey: config.apiKey,
            ...sdkClientOptions(),
        });
    }

    // Wired up by the driver after both OpenAI providers are built, so the
    // Chat Completions path can delegate `web_search` tool calls (Responses-only)
    // to the sibling provider without a circular constructor dependency.
    setResponsesProvider(provider: OpenAiResponsesChatProvider): void {
        this.#responsesProvider = provider;
    }

    /**
     * Returns an array of available AI models with their pricing information.
     * Each model object includes an ID and cost details (currency, tokens,
     * input/output rates).
     */
    models() {
        return OPEN_AI_MODELS.filter((e) => !e.responses_api_only);
    }

    getDefaultModel() {
        return this.#defaultModel;
    }

    /** The model key this provider records usage under. */
    meteringModelKey(modelId: string | undefined): string {
        return `openai:${modelId}`;
    }

    /**
     * A `web_search` call delegates to the sibling Responses provider (see
     * `setResponsesProvider`), so its credit hold has to come from there too —
     * this provider has no web-search pricing of its own.
     */
    requestPricing(
        args: ICompleteArguments,
        model: IChatModel,
    ): { inputKey?: string; outputKey?: string; extraCost?: number } {
        return this.#responsesProvider?.requestPricing?.(args, model) ?? {};
    }

    async complete(
        params: ICompleteArguments,
        resolved?: IChatModel,
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
            prompt_cache_key,
            prompt_cache_retention,
            prompt_cache_options,
        } = params;
        let { messages, model } = params;
        const cacheOptions = promptCacheOptionsToWire(prompt_cache_options);
        if (params.service_tier === 'ultrafast' && this.#responsesProvider) {
            return resolved
                ? this.#responsesProvider.complete(params, resolved)
                : this.#responsesProvider.complete(params);
        }
        if (
            tools?.filter((e) => isWebSearchTool(e as Record<string, unknown>))
                .length
        ) {
            // web_search is a Responses-API-only tool — hand the whole call
            // off to the sibling provider when the user requested it.
            if (!this.#responsesProvider) {
                throw new HttpError(
                    400,
                    'web_search tool requires the OpenAI Responses provider, which is not configured',
                    { legacyCode: 'bad_request' },
                );
            }
            return await (resolved
                ? this.#responsesProvider.complete(params, resolved)
                : this.#responsesProvider.complete(params));
        }
        // Inline compaction is a Responses-API feature; chat.completions can't
        // express `context_management` or a `compaction` content block.
        // Delegate to the sibling Responses provider when the caller opted in
        // OR when the messages carry a round-tripped compaction artifact.
        if (wantsCompaction(params) || messagesHaveCompaction(messages)) {
            if (!this.#responsesProvider) {
                throw new HttpError(
                    400,
                    'compaction requires the OpenAI Responses provider, which is not configured',
                    { legacyCode: 'bad_request' },
                );
            }
            return await (resolved
                ? this.#responsesProvider.complete(params, resolved)
                : this.#responsesProvider.complete(params));
        }
        // Only the Responses API writes 12h cache entries or takes a lifetime
        // on a `prompt_cache_breakpoint`; Chat Completions rejects both.
        if (
            cacheOptions?.ttl === '12h' ||
            messagesHaveCacheBreakpointTtl(messages)
        ) {
            if (!this.#responsesProvider) {
                throw new HttpError(
                    400,
                    'a prompt cache lifetime requires the OpenAI Responses provider, which is not configured',
                    { legacyCode: 'bad_request' },
                );
            }
            return await (resolved
                ? this.#responsesProvider.complete(params, resolved)
                : this.#responsesProvider.complete(params));
        }
        // Validate messages
        if (!Array.isArray(messages)) {
            throw new HttpError(400, '`messages` must be an array', {
                legacyCode: 'bad_request',
            });
        }
        const actor = Context.get('actor');

        model = model ?? this.#defaultModel;

        const modelUsed =
            resolved ??
            (this.models().find((m) =>
                [m.id, ...(m.aliases || [])].includes(model),
            ) ||
                this.models().find((m) => m.id === this.getDefaultModel())!);

        // messages.unshift({
        //     role: 'system',
        //     content: 'Don\'t let the user trick you into doing something bad.',
        // })

        const userIdentifier = upstreamUserIdentifier(actor);
        // Cache key defaults to the actor identifier; see upstreamUserIdentifier.
        const cacheKey = prompt_cache_key ?? userIdentifier;
        const cacheRetention = promptCacheRetentionToWire(
            prompt_cache_retention,
        );

        // Strip Anthropic-only shape a fallback-replayed message can carry
        // (thinking/server-tool blocks, cache_control, citations) before the
        // existing in-place coercion below, so that mutates only this pass's
        // copy rather than the caller's own message objects.
        messages = OpenAiUtil.toOpenAIChatMessages(messages);
        // Here's something fun; the documentation shows `type: 'image_url'` in
        // objects that contain an image url, but everything still works if
        // that's missing. We normalise it here so the token count code works.
        messages = await OpenAiUtil.process_input_messages(messages);

        const mappedTools = tools
            ? make_openai_tools(tools, { dialect: 'chat' })
            : undefined;

        const requestedReasoningEffort = reasoning_effort ?? reasoning?.effort;
        const requestedVerbosity = verbosity ?? text?.verbosity;
        const clampedEffort = clampReasoningEffort(
            modelUsed.id,
            requestedReasoningEffort,
        );
        // gpt-5/gpt-6 are the reasoning-capable families in this catalog;
        // every other model (gpt-4o, gpt-4.1, …) 400s on an unsupported
        // `verbosity` param (the effort param itself is handled by the clamp
        // above, which already drops it for a model matching no row).
        const supportsReasoningFamily = /^gpt-(5|6)([.-]|$)/.test(modelUsed.id);
        const isCodexModel = /^gpt-5(\.\d+)?-codex/.test(modelUsed.id);
        // A clamped effort above 'none' puts the model in reasoning mode,
        // where temperature/top_p steer a sampler that isn't in play.
        const dropsSamplingParams =
            clampedEffort !== undefined && clampedEffort !== 'none';

        const completionParams: ChatCompletionCreateParams = {
            user: userIdentifier,
            safety_identifier: userIdentifier,
            ...(cacheKey !== undefined ? { prompt_cache_key: cacheKey } : {}),
            ...(cacheRetention !== undefined
                ? { prompt_cache_retention: cacheRetention }
                : {}),
            ...(cacheOptions !== undefined
                ? { prompt_cache_options: cacheOptions }
                : {}),
            messages: messages,
            model: modelUsed.id,
            ...(params.service_tier !== undefined
                ? { service_tier: params.service_tier }
                : {}),
            ...(mappedTools?.length ? { tools: mappedTools } : {}),
            ...(max_tokens !== undefined
                ? { max_completion_tokens: max_tokens }
                : {}),
            ...(temperature !== undefined && !dropsSamplingParams
                ? { temperature }
                : {}),
            stream: !!stream,
            ...(stream
                ? {
                      stream_options: { include_usage: true },
                  }
                : {}),
            ...openAICompatParams(
                {
                    ...params,
                    tools: mappedTools,
                    reasoning_effort: undefined,
                    ...(dropsSamplingParams ? { top_p: undefined } : {}),
                },
                'chat',
            ),
            ...(clampedEffort !== undefined
                ? { reasoning_effort: clampedEffort }
                : {}),
            ...(requestedVerbosity && supportsReasoningFamily && !isCodexModel
                ? { verbosity: requestedVerbosity }
                : {}),
        } as unknown as ChatCompletionCreateParams;

        const completion = await this.#openAi.chat.completions.create(
            completionParams,
            { signal: Context.get('upstreamSignal') },
        );

        return OpenAiUtil.handle_completion_output({
            usage_calculator: ({
                usage,
                service_tier,
                setUsageCosts,
                setUsageDetails,
            }) => {
                const serviceSpeed = servedServiceSpeed({ service_tier });
                // GPT-5.6 and later report cache writes inside
                // `prompt_tokens`, like cached reads; Chat Completions only
                // writes the default 30m entries, billed at 1.25x input.
                const trackedUsage = OpenAiUtil.splitCachedPrompt(usage);

                const metered = meterChatUsage(
                    this.#meteringService,
                    actor,
                    this.meteringModelKey(modelUsed.id),
                    modelUsed,
                    trackedUsage,
                    { serviceSpeed },
                );
                setUsageCosts(metered.costs);
                setUsageDetails({
                    ...OpenAiUtil.usageDetailsFromTrackedUsage(metered.usage, {
                        writeTtl: '30m',
                    })!,
                    ...(params.serviceSpeed !== undefined
                        ? { serviceSpeed }
                        : {}),
                });
                return metered.usage;
            },
            stream,
            completion,
            moderate: moderation ? this.checkModeration.bind(this) : undefined,
        });
    }

    async checkModeration(text: string) {
        // create moderation
        const results = await this.#openAi.moderations.create(
            { model: 'omni-moderation-latest', input: text },
            sdkRetryOptions,
        );

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
