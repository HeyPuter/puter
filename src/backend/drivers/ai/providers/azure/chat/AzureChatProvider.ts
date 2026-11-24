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
import type { CompletionUsage } from 'openai/resources/completions.mjs';
import { servedServiceSpeed } from '../../../interfaces/chat/utils/serviceSpeed.js';
import { Context } from '../../../../../core/context.js';
import type { MeteringService } from '../../../../../services/metering/MeteringService.js';
import type {
    IChatModel,
    IChatProvider,
    ICompleteArguments,
} from '../../../interfaces/chat/types.js';
import {
    messagesHaveCompaction,
    wantsCompaction,
} from '../../../interfaces/chat/utils/compaction.js';
import * as OpenAiUtil from '../../../protocols/openaiCompatible/OpenAIUtil.js';
import {
    clampReasoningEffort,
    openAICompatParams,
    toolsToWire,
} from '../../../protocols/openaiCompatible/openaiParams.js';
import { inlineHttpImageUrls } from '../../../protocols/openaiCompatible/inlineImages.js';
import { AZURE_MODELS } from './models.js';
import { modelLookupNames } from '../../../interfaces/chat/utils/modelRouting.js';
import { upstreamUserIdentifier } from '../../../shared/upstreamIdentifier.js';
import { sdkClientOptions } from '../../../interfaces/chat/utils/sdkClient.js';
import { meterChatUsage } from '../../../interfaces/chat/utils/meterChatUsage.js';

const isWebSearchTool = (tool: Record<string, unknown>): boolean =>
    tool.type === 'web_search' ||
    tool.type === 'web_search_preview' ||
    tool.type === 'web_search_20250305' ||
    (typeof tool.type === 'string' && /^web_search_2026/.test(tool.type));

const isCount = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value);

/**
 * The reasoning tokens Azure's own `total_tokens` proves sit outside
 * `completion_tokens`, or 0 when the total doesn't prove it, so a reply never
 * pays for its reasoning twice. Cached reads aren't part of Azure's Grok total;
 * when they equal the reasoning count, the total reads either way.
 */
const reasoningOutsideCompletion = (usage: CompletionUsage): number => {
    const reasoning = usage.completion_tokens_details?.reasoning_tokens;
    const { prompt_tokens, completion_tokens, total_tokens } = usage;
    if (
        !isCount(reasoning) ||
        !(reasoning > 0) ||
        !isCount(prompt_tokens) ||
        !isCount(completion_tokens) ||
        !isCount(total_tokens) ||
        usage.prompt_tokens_details?.cached_tokens === reasoning
    ) {
        return 0;
    }
    return total_tokens === prompt_tokens + completion_tokens + reasoning
        ? reasoning
        : 0;
};

/**
 * AzureChatProvider exposes the models we serve through Azure AI Foundry.
 * Despite the name, this is not OpenAI-only — Azure AI also fronts xAI's Grok
 * models — so it carries its own {@link AZURE_MODELS} list instead of reusing
 * the OpenAI one. It speaks the OpenAI-compatible Chat Completions API,
 * pointing the client at a configurable Azure endpoint authenticated with an
 * Azure-issued API key.
 *
 * Billing note: the model `costs` are the standard public OpenAI / xAI list
 * prices, NOT Azure's. Azure is subsidised for us, so routing through it is
 * cheaper while we still bill users at the normal model price.
 *
 * Implements the puter-chat-completion interface and handles usage tracking,
 * spending records, and content moderation.
 */
export class AzureChatProvider implements IChatProvider {
    /** @type {import('openai').OpenAI} */
    #openAi: OpenAI;

    #defaultModel = 'gpt-5.4-nano';

    #meteringService: MeteringService;

    // Sibling Responses-API provider (Azure or OpenAI) used to handle
    // Responses-only features like web_search, and moderation.
    #responsesProvider: IChatProvider | null = null;

    constructor(
        meteringService: MeteringService,
        config: { apiKey: string; apiURL: string },
    ) {
        this.#meteringService = meteringService;
        this.#openAi = new OpenAI({
            apiKey: config.apiKey,
            baseURL: config.apiURL,
            ...sdkClientOptions(),
        });
    }
    checkModeration(
        text: string,
    ): ReturnType<IChatProvider['checkModeration']> {
        if (!this.#responsesProvider) {
            throw new Error('moderation requires the Responses provider');
        }
        return this.#responsesProvider.checkModeration(text);
    }

    // Wired up by the driver after the OpenAI providers are built, so the
    // Chat Completions path can delegate `web_search` tool calls (Responses-only)
    // to the OpenAI Responses provider without a circular constructor dependency.
    setResponsesProvider(provider: IChatProvider): void {
        this.#responsesProvider = provider;
    }

    /**
     * Returns an array of available AI models with their pricing information.
     * Each model object includes an ID and cost details (currency, tokens,
     * input/output rates).
     */
    models() {
        return AZURE_MODELS.filter((e) => !e.responses_api_only);
    }

    list() {
        return modelLookupNames(this.models());
    }

    getDefaultModel() {
        return this.#defaultModel;
    }

    /** The model key this provider records usage under. */
    meteringModelKey(modelId: string | undefined): string {
        return `azure-openai:${modelId}`;
    }

    /**
     * A `web_search` call delegates to the sibling Responses provider (see
     * `setResponsesProvider`), so its credit hold has to come from there too —
     * this provider has no web-search pricing of its own.
     */
    requestPricing(
        args: ICompleteArguments,
        model: IChatModel,
        est: { promptTokenEstimate: number },
    ): { inputKey?: string; outputKey?: string; extraCost?: number } {
        return (
            this.#responsesProvider?.requestPricing?.(args, model, est) ?? {}
        );
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
        } = params;
        let { messages, model } = params;
        if (
            tools?.filter((e) => isWebSearchTool(e as Record<string, unknown>))
                .length
        ) {
            // web_search is a Responses-API-only tool — hand the whole call
            // off to the OpenAI Responses provider when the user requested it.
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
        // Delegate to the Responses provider when the caller opted in OR when
        // the messages carry a round-tripped compaction artifact.
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
        // Validate messages
        if (!Array.isArray(messages)) {
            throw new HttpError(400, '`messages` must be an array', {
                legacyCode: 'bad_request',
            });
        }
        const actor = Context.get('actor')!;

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

        // The Grok deployments behind Azure cannot fetch every public image
        // host (`image_fetch_failed`); hand them the bytes as data URLs.
        const isGrok = modelUsed.id.startsWith('grok');
        if (isGrok) {
            await inlineHttpImageUrls(messages);
        }

        // Strip Anthropic-only shape a fallback-replayed message can carry
        // before the existing in-place coercion mutates only this pass's copy.
        messages = OpenAiUtil.toOpenAIChatMessages(messages);
        // Here's something fun; the documentation shows `type: 'image_url'` in
        // objects that contain an image url, but everything still works if
        // that's missing. We normalise it here so the token count code works.
        messages = await OpenAiUtil.process_input_messages(messages);

        const mappedTools = tools ? toolsToWire(tools, 'chat') : undefined;

        const requestedReasoningEffort = reasoning_effort ?? reasoning?.effort;
        const requestedVerbosity = verbosity ?? text?.verbosity;
        const clampedEffort = clampReasoningEffort(
            modelUsed.id,
            requestedReasoningEffort,
        );
        // gpt-5/gpt-6 are the reasoning-capable families; every other model
        // (gpt-4o, Grok, …) 400s on an unsupported `verbosity` param (the
        // effort param is handled by the clamp above).
        const supportsReasoningFamily = /^gpt-(5|6)([.-]|$)/.test(modelUsed.id);
        const isCodexModel = /^gpt-5(\.\d+)?-codex/.test(modelUsed.id);
        const dropsSamplingParams =
            clampedEffort !== undefined && clampedEffort !== 'none';

        // `safety_identifier`/`prompt_cache_key` are OpenAI-specific params.
        // The Grok deployments behind Azure reject unknown args with a 400,
        // so only send them for the OpenAI models.

        const completionParams: ChatCompletionCreateParams = {
            user: userIdentifier,
            ...(isGrok
                ? {}
                : {
                      safety_identifier: userIdentifier,
                      ...(cacheKey !== undefined
                          ? { prompt_cache_key: cacheKey }
                          : {}),
                  }),
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
                service_tier,
                usage,
                setUsageCosts,
                setUsageDetails,
            }) => {
                const cachedTokens =
                    usage.prompt_tokens_details?.cached_tokens ?? 0;
                // Reasoning is billed at the output rate, as direct xAI bills it.
                const reasoningTokens = isGrok
                    ? reasoningOutsideCompletion(usage)
                    : 0;
                const trackedUsage = {
                    // OpenAI counts cached reads inside `prompt_tokens`. Azure's
                    // Grok deployment reports them beside it, unlike direct xAI,
                    // so subtracting there would bill a negative cost.
                    prompt_tokens: isGrok
                        ? (usage.prompt_tokens ?? 0)
                        : (usage.prompt_tokens ?? 0) - cachedTokens,
                    completion_tokens: reasoningTokens
                        ? usage.completion_tokens + reasoningTokens
                        : (usage.completion_tokens ?? 0),
                    cached_tokens: cachedTokens,
                };

                const serviceSpeed = servedServiceSpeed({ service_tier });
                const metered = meterChatUsage(
                    this.#meteringService,
                    actor,
                    this.meteringModelKey(modelUsed.id),
                    modelUsed,
                    trackedUsage,
                    { serviceSpeed },
                );

                setUsageCosts(metered.costs);
                if (params.serviceSpeed !== undefined)
                    setUsageDetails({
                        ...OpenAiUtil.usageDetailsFromTrackedUsage(
                            trackedUsage,
                        )!,
                        serviceSpeed,
                        ...(reasoningTokens ? { reasoningTokens } : {}),
                    });
                return metered.usage;
            },
            stream,
            completion,
            moderate: moderation ? this.checkModeration.bind(this) : undefined,
        });
    }
}
