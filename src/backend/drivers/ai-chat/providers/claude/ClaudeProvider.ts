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

import Anthropic from '@anthropic-ai/sdk';
import type { Message } from '@anthropic-ai/sdk/resources';
import { Context } from '../../../../core/context.js';
import type { FSService } from '../../../../services/fs/FSService.js';
import type { MeteringService } from '../../../../services/metering/MeteringService.js';
import type { FSEntryStore } from '../../../../stores/fs/FSEntryStore.js';
import type { S3ObjectStore } from '../../../../stores/fs/S3ObjectStore.js';
import { upstreamUserIdentifier } from '../../../util/upstreamIdentifier.js';
import type {
    IChatModel,
    IChatProvider,
    ICompleteArguments,
    IChatCompleteResult,
    UsageDetails,
} from '../../types.js';
import {
    messagesHaveCompaction,
    toAnthropicContextManagement,
} from '../../utils/compaction.js';
import {
    mediaUrlOf,
    parseDataUri,
    unsupportedMediaTextPart,
} from '../../utils/mediaParts.js';
import { isToolChoice, toolChoiceFromWire } from '../../utils/openaiParams.js';
import { buildCostsOverride } from '../../utils/pricing.js';
import type {
    AIChatStream,
    AIChatTextStream,
    AIChatToolUseStream,
} from '../../utils/Streaming.js';
import { modelLookupNames } from '../../utils/modelRouting.js';
import {
    allowlistedFromHeader,
    applySafeguardsPolicy,
    claudeToolPolicy,
    clampAdvisorMaxTokens,
    clampAdvisorMaxUses,
    clampWebSearchMaxUses,
    combineBetas,
    deriveBetas,
    hasExtendedCacheTtl,
    mergeConsecutiveUserTurns,
    partitionSystemMessages,
    rejectOrgScopedBlocks,
    resolveAdvisorModel,
    sanitizeCacheControl,
    sanitizeCacheControlsIn,
    validateContextManagementEdits,
    type BetaFeatures,
} from './anthropicPolicy.js';
import { FILES_API_BETA, processPuterPathUploads } from './fileUpload.js';
import { CLAUDE_MODELS } from './models.js';

/**
 * Canonical media part → Anthropic block: `url` source for links, `base64`
 * source for data URLs, `detail` dropped, video replaced by an inline note.
 * Non-media parts come back by identity.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toAnthropicMediaPart = (part: any): any => {
    if (!part || typeof part !== 'object') return part;
    if (part.type === 'image_url' || part.image_url !== undefined) {
        const url = mediaUrlOf(part.image_url);
        if (url === undefined) return part;
        const {
            type: _type,
            image_url: _imageUrl,
            detail: _detail,
            ...rest
        } = part;
        const dataUri = parseDataUri(url);
        const source =
            dataUri && dataUri.base64
                ? {
                      type: 'base64',
                      media_type: dataUri.mimeType,
                      data: dataUri.data,
                  }
                : { type: 'url', url };
        return { ...rest, type: 'image', source };
    }
    if (part.type === 'video_url' || part.video_url !== undefined) {
        return unsupportedMediaTextPart(
            'video input is not supported by Claude models',
        );
    }
    return part;
};

/** A 429 from fast mode's separate quota, not the model's normal limits. */
const isFastModeRateLimit = (e: unknown): boolean => {
    const err = e as { status?: unknown; message?: unknown };
    return (
        err?.status === 429 &&
        typeof err.message === 'string' &&
        /fast mode/i.test(err.message)
    );
};

// Models whose current turn rejects a non-default temperature/top_p/top_k
// outright. Fable 5/5.1, Sonnet 5/5.5, Haiku 5.5, and Opus 4.7+.
const OMITS_SAMPLING_PARAMS = new Set([
    'claude-haiku-5-5',
    'claude-fable-5-1',
    'claude-fable-5',
    'claude-sonnet-5-5',
    'claude-sonnet-5',
    'claude-opus-4-7',
    'claude-opus-4-8',
    'claude-opus-5',
    'claude-opus-5-5',
]);

const SUPPORTS_EFFORT = new Set([
    'claude-haiku-5-5',
    'claude-fable-5-1',
    'claude-fable-5',
    'claude-sonnet-5-5',
    'claude-sonnet-5',
    'claude-opus-5-5',
    'claude-opus-5',
    'claude-opus-4-8',
    'claude-opus-4-7',
    'claude-opus-4-6',
    'claude-sonnet-4-6',
]);

/** Blocks that are server-executed tool _results_, not calls — forwarded as-is. */
const SERVER_RESULT_BLOCKS = new Set([
    'web_search_tool_result',
    'web_fetch_tool_result',
    'advisor_tool_result',
    'tool_search_tool_result',
]);

/**
 * Merges one `message_delta` usage snapshot into the running one. Anthropic's
 * per-field counts are cumulative, so numeric leaves take the max (guards
 * against an out-of-order or partial delta reporting a smaller number);
 * `iterations`/`speed`/`service_tier` are whole-snapshot fields, so the latest
 * one wins outright. `finalMessage.usage`, when the stream reaches it, still
 * replaces this entirely — this merge only matters for a stream that errors
 * before `finalMessage` resolves.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mergeUsageMax = (acc: any, next: any): any => {
    if (!next) return acc;
    if (!acc) acc = {};
    const out = { ...acc };
    for (const key of [
        'input_tokens',
        'output_tokens',
        'cache_read_input_tokens',
        'cache_creation_input_tokens',
    ]) {
        if (typeof next[key] === 'number') {
            out[key] = Math.max(out[key] ?? 0, next[key]);
        }
    }
    if (next.cache_creation) {
        out.cache_creation = {
            ephemeral_5m_input_tokens: Math.max(
                out.cache_creation?.ephemeral_5m_input_tokens ?? 0,
                next.cache_creation.ephemeral_5m_input_tokens ?? 0,
            ),
            ephemeral_1h_input_tokens: Math.max(
                out.cache_creation?.ephemeral_1h_input_tokens ?? 0,
                next.cache_creation.ephemeral_1h_input_tokens ?? 0,
            ),
        };
    }
    if (next.server_tool_use) {
        out.server_tool_use = {
            web_search_requests: Math.max(
                out.server_tool_use?.web_search_requests ?? 0,
                next.server_tool_use.web_search_requests ?? 0,
            ),
            web_fetch_requests: Math.max(
                out.server_tool_use?.web_fetch_requests ?? 0,
                next.server_tool_use.web_fetch_requests ?? 0,
            ),
        };
    }
    if (next.iterations !== undefined) out.iterations = next.iterations;
    if (next.speed !== undefined) out.speed = next.speed;
    if (next.service_tier !== undefined) out.service_tier = next.service_tier;
    if (next.output_tokens_details !== undefined) {
        out.output_tokens_details = next.output_tokens_details;
    }
    if (next.thinking_tokens !== undefined)
        out.thinking_tokens = next.thinking_tokens;
    return out;
};

/** One raw Anthropic `usage.iterations[]` entry → `UsageDetails` shape. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const iterationDetails = (it: any) => ({
    type: String(it?.type ?? 'message'),
    ...(typeof it?.model === 'string' ? { model: it.model } : {}),
    inputTokens: it?.input_tokens ?? 0,
    outputTokens: it?.output_tokens ?? 0,
    cacheReadTokens: it?.cache_read_input_tokens ?? 0,
    cacheWrite5mTokens:
        it?.cache_creation?.ephemeral_5m_input_tokens ??
        it?.cache_creation_input_tokens ??
        0,
    cacheWrite1hTokens: it?.cache_creation?.ephemeral_1h_input_tokens ?? 0,
});

const COUNT_TOKENS_FIELDS = [
    'model',
    'messages',
    'system',
    'tools',
    'tool_choice',
    'thinking',
    'output_config',
    'context_management',
    'cache_control',
    'safeguards',
    'speed',
] as const;

type BlockState =
    | { kind: 'text'; s: AIChatTextStream }
    | {
          kind: 'thinking';
          s: AIChatTextStream;
          thinking: string;
          signature: string;
      }
    | { kind: 'tool'; s: AIChatToolUseStream }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    | { kind: 'serverToolUse'; block: Record<string, any>; json: string }
    | { kind: 'compaction'; id?: string; payload: string; buffer: string }
    | { kind: 'done' };

export class ClaudeProvider implements IChatProvider {
    anthropic: Anthropic;

    #meteringService: MeteringService;

    #stores: { fsEntry: FSEntryStore; s3Object: S3ObjectStore };

    #fsService: FSService;

    #warnedBlockTypes = new Set<string>();

    // `puter_path` parts go through Anthropic's Files API here (larger inputs,
    // native PDF reading) instead of the driver's inline data URLs.
    readonly resolvesPuterPaths = true;

    constructor(
        meteringService: MeteringService,
        stores: { fsEntry: FSEntryStore; s3Object: S3ObjectStore },
        fsService: FSService,
        config: { apiKey: string },
    ) {
        this.#meteringService = meteringService;
        this.#stores = stores;
        this.#fsService = fsService;
        this.anthropic = new Anthropic({
            apiKey: config.apiKey,
            timeout: 10 * 60 * 1001,
        });
    }

    getDefaultModel() {
        return 'claude-haiku-4-5-20251001';
    }

    models() {
        return CLAUDE_MODELS;
    }

    async list() {
        return modelLookupNames(this.models());
    }

    /** The model key this provider records usage under. */
    meteringModelKey(modelId: string): string {
        return `claude:${modelId}`;
    }

    /**
     * Sizes the credit hold for Claude-only extras the generic per-token math
     * can't see: fast mode's own rate card, and a web-search/advisor tool that
     * could run several times before the model answers.
     */
    requestPricing(
        args: ICompleteArguments,
        model: IChatModel,
        est: { promptTokenEstimate: number },
    ): { inputKey?: string; outputKey?: string; extraCost?: number } {
        const fast =
            args.speed === 'fast' &&
            model.costs?.fast_output_tokens !== undefined;

        let extraCost = 0;
        for (const raw of args.tools ?? []) {
            const tool = raw as Record<string, unknown>;
            const type = tool?.type;
            // Same set `claudeToolPolicy` forwards as a billed web search.
            if (
                type === 'web_search' ||
                type === 'web_search_20250305' ||
                (typeof type === 'string' && /^web_search_2026/.test(type))
            ) {
                const maxUses = clampWebSearchMaxUses(tool.max_uses);
                const requestCost = Number(
                    model.costs?.web_search_requests ?? 0,
                );
                const inputTokenCost = Number(model.costs?.input_tokens ?? 0);
                // ~7.4k tokens observed per search; 10k is a conservative margin.
                extraCost += maxUses * (requestCost + 10_000 * inputTokenCost);
            } else if (type === 'advisor_20260301') {
                const advisorModel = resolveAdvisorModel(
                    typeof tool.model === 'string' ? tool.model : undefined,
                    this.models(),
                );
                const maxUses = clampAdvisorMaxUses(tool.max_uses);
                const maxTokens = clampAdvisorMaxTokens(tool.max_tokens);
                const advisorInputCost = Number(
                    advisorModel.costs?.input_tokens ?? 0,
                );
                const advisorOutputCost = Number(
                    advisorModel.costs?.output_tokens ?? 0,
                );
                extraCost +=
                    maxUses *
                    (est.promptTokenEstimate * advisorInputCost +
                        maxTokens * advisorOutputCost);
            }
        }

        return {
            ...(fast
                ? {
                      inputKey: 'fast_input_tokens',
                      outputKey: 'fast_output_tokens',
                  }
                : {}),
            ...(extraCost > 0 ? { extraCost } : {}),
        };
    }

    async complete(args: ICompleteArguments): Promise<IChatCompleteResult> {
        try {
            return await this.#completeOnce(args);
        } catch (e) {
            // Fast mode has its own quota. Anthropic's advice on that 429 is to
            // drop `speed` and run at standard speed; doing it here keeps the
            // request on Claude instead of marking the route unhealthy and
            // replaying it on a reseller.
            if (args.speed === 'fast' && isFastModeRateLimit(e)) {
                return await this.#completeOnce({ ...args, speed: undefined });
            }
            throw e;
        }
    }

    async #completeOnce(
        args: ICompleteArguments,
    ): Promise<IChatCompleteResult> {
        const {
            sdkParams,
            usesBeta,
            modelUsed,
            cleanupUploads,
            restoreUploads,
        } = await this.#buildRequest(args);

        if (args.stream) {
            const completion = usesBeta
                ? this.anthropic.beta.messages.stream(sdkParams as never, {
                      signal: Context.get('abortSignal'),
                  })
                : this.anthropic.messages.stream(sdkParams as never, {
                      signal: Context.get('abortSignal'),
                  });
            // Subscribed before the request is awaited: the SDK only queues
            // events for iterators that already exist.
            const events = completion[Symbol.asyncIterator]();

            // The driver's fallback loop only sees what this method throws, so
            // the upstream has to accept the request before a populator exists.
            try {
                await completion.withResponse();
            } catch (e) {
                await cleanupUploads();
                restoreUploads();
                throw e;
            }

            const init_chat_stream = async ({
                chatStream,
            }: {
                chatStream: AIChatStream;
            }) => {
                await this.#pumpStream({
                    completion,
                    events,
                    chatStream,
                    modelUsed,
                });
            };

            return {
                init_chat_stream,
                stream: true,
                finally_fn: cleanupUploads,
            };
        }

        try {
            const msg = await (usesBeta
                ? this.anthropic.beta.messages.create(sdkParams as never, {
                      signal: Context.get('abortSignal'),
                  })
                : this.anthropic.messages.create(sdkParams as never, {
                      signal: Context.get('abortSignal'),
                  }));
            const { usage, costs, details, advisorModel } = this.#meter(
                (msg as Message).usage,
                modelUsed,
            );
            this.#meteringService.utilRecordUsageObject(
                usage.executor,
                Context.get('actor'),
                this.meteringModelKey(modelUsed.id),
                costs.executor,
            );
            if (usage.advisor) {
                this.#meteringService.utilRecordUsageObject(
                    usage.advisor,
                    Context.get('actor'),
                    this.meteringModelKey((advisorModel ?? modelUsed).id),
                    costs.advisor,
                );
            }

            // Surface any inline-compaction artifact for stateless round-trip.
            const compactionBlock = (
                ((msg as Message).content as unknown[]) ?? []
            ).find(
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (c: any) => c?.type === 'compaction',
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ) as any;

            const nativeMsg = msg as unknown as Message & {
                stop_sequence?: string | null;
                stop_details?: Record<string, unknown> | null;
                safeguard_results?: unknown[];
                context_management?: Record<string, unknown> | null;
            };

            return {
                message: msg,
                usage: { ...usage.executor, ...(usage.advisor ?? {}) },
                // Native Claude results report `stop` on the wire, like main —
                // read `stopReason` below for the real Anthropic value.
                finish_reason: 'stop',
                stopReason: nativeMsg.stop_reason ?? undefined,
                stopSequence: nativeMsg.stop_sequence ?? null,
                ...(nativeMsg.stop_details
                    ? { stopDetails: nativeMsg.stop_details }
                    : {}),
                usageDetails: details,
                usageCosts: { ...costs.executor, ...(costs.advisor ?? {}) },
                ...(nativeMsg.safeguard_results
                    ? { safeguardResults: nativeMsg.safeguard_results }
                    : {}),
                ...(nativeMsg.context_management
                    ? { contextManagement: nativeMsg.context_management }
                    : {}),
                ...(compactionBlock
                    ? {
                          compaction: {
                              // `type` makes the artifact a drop-in `messages`
                              // item for the round-trip (symmetric with the
                              // streaming compaction chunk).
                              type: 'compaction' as const,
                              ...(compactionBlock.id !== undefined
                                  ? { id: compactionBlock.id }
                                  : {}),
                              encrypted_content:
                                  compactionBlock.content ??
                                  compactionBlock.encrypted_content ??
                                  '',
                          },
                      }
                    : {}),
            };
        } catch (e) {
            restoreUploads();
            throw e;
        } finally {
            await cleanupUploads();
        }
    }

    /**
     * Exact prompt token count via Anthropic's `count_tokens`, which rejects
     * `max_tokens`/`temperature`/`metadata`/`stream`/`stop_sequences` — only
     * the fields it accepts are forwarded. `puter_path` parts aren't uploaded
     * for a token count; they're swapped for a placeholder instead.
     */
    async countTokens(args: ICompleteArguments): Promise<number> {
        const { sdkParams, betas } = await this.#buildRequest(args, {
            forCountTokens: true,
        });
        const picked: Record<string, unknown> = {};
        for (const key of COUNT_TOKENS_FIELDS) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const value = (sdkParams as any)[key];
            if (value !== undefined) picked[key] = value;
        }
        const result = await this.anthropic.beta.messages.countTokens({
            ...picked,
            ...(betas.length ? { betas } : {}),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
        return result.input_tokens;
    }

    // -- Request building --------------------------------------------

    async #buildRequest(
        args: ICompleteArguments,
        opts: { forCountTokens?: boolean } = {},
    ) {
        // `mcp_servers` is never forwarded: `sdkParams` below is an explicit
        // field list, so an `args.mcp_servers` a caller set is just dropped.
        rejectOrgScopedBlocks(args.messages);
        validateContextManagementEdits(args.context_management);

        const modelUsed =
            this.models().find((m) =>
                [m.id, ...(m.aliases || [])].includes(args.model),
            ) || this.models().find((m) => m.id === this.getDefaultModel())!;

        // -- messages: system partition + the transform pipeline ------
        let messages = Array.isArray(args.messages)
            ? args.messages.slice()
            : [];

        const systemPartition = partitionSystemMessages(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            messages as any[],
            { midConversationSystem: !!modelUsed.midConversationSystem },
        );
        messages = systemPartition.messages;
        let systemBlocks = systemPartition.systemBlocks;

        messages = this.#transformMessages(messages, opts.forCountTokens);

        // Recursively rebuild every cache_control reachable from the final
        // shape, copy-on-write.
        messages = sanitizeCacheControlsIn(messages);
        systemBlocks = sanitizeCacheControlsIn(systemBlocks);

        // -- tools --------------------------------------------------
        const toolPolicy = claudeToolPolicy(args.tools, this.models());
        const tools =
            toolPolicy.tools && toolPolicy.tools.length > 0
                ? toolPolicy.tools
                : undefined;

        // -- sampling -------------------------------------------------
        const requestedReasoningEffort =
            args.reasoning_effort ?? args.reasoning?.effort;
        const omitsSampling = OMITS_SAMPLING_PARAMS.has(modelUsed.id);
        const supportsEffort = SUPPORTS_EFFORT.has(modelUsed.id);

        const maxTokens = Math.floor(
            args.max_tokens ??
                (args.model === 'claude-3-5-sonnet-20241022' ||
                args.model === 'claude-3-5-sonnet-20240620'
                    ? 8192
                    : modelUsed.max_tokens || 4096),
        );

        const thinkingConfig = this.#buildThinking(
            args,
            modelUsed.id,
            maxTokens,
        );

        const resolvedTemperature = omitsSampling
            ? undefined
            : thinkingConfig
              ? 1
              : (args.temperature ?? 0);

        // -- output_config --------------------------------------------
        const outputConfig = this.#buildOutputConfig(
            args,
            supportsEffort ? requestedReasoningEffort : undefined,
        );

        // -- tool_choice ------------------------------------------------
        const toolChoice = this.#buildToolChoice(tools, args);

        // -- context_management -----------------------------------------
        const contextManagement = toAnthropicContextManagement({
            compaction: args.compaction,
            context_management: args.context_management,
        });
        const historyHasCompaction = messagesHaveCompaction(messages);

        // -- cache control / speed / safeguards ---------------------------
        const topCacheControl = args.cacheControl
            ? sanitizeCacheControl(args.cacheControl)
            : undefined;
        const fast =
            args.speed === 'fast' &&
            modelUsed.costs?.fast_output_tokens !== undefined;
        const safeguardsPolicy = applySafeguardsPolicy(
            args.safeguards,
            args.anthropicBetas,
        );

        // -- metadata -----------------------------------------------------
        const actor = Context.get('actor');
        const userId = upstreamUserIdentifier(actor);

        // -- puter_path uploads (skipped for a plain token count) -------
        let uploadedFileIds: string[] = [];
        let restoreUploads: () => void = () => {};
        if (!opts.forCountTokens) {
            const uploadResult = await processPuterPathUploads(
                this.anthropic,
                messages,
                this.#stores,
                this.#fsService,
                actor,
            );
            uploadedFileIds = uploadResult.fileIds;
            restoreUploads = uploadResult.restore;
        } else {
            // A puter_path part left in a count_tokens request isn't a valid
            // Anthropic field; swap it for a placeholder instead of uploading.
            for (const message of messages) {
                if (!Array.isArray(message.content)) continue;
                message.content = message.content.map(
                    (part: Record<string, unknown>) =>
                        part?.puter_path
                            ? unsupportedMediaTextPart(
                                  'attachment omitted for token counting',
                              )
                            : part,
                );
            }
        }
        const usesBetaFiles = uploadedFileIds.length > 0;

        const cleanupUploads = async () => {
            if (uploadedFileIds.length === 0) return;
            await Promise.all(
                uploadedFileIds.map(async (id) => {
                    try {
                        await this.anthropic.beta.files.delete(id, {
                            betas: [FILES_API_BETA],
                        });
                    } catch {
                        /* best-effort */
                    }
                }),
            );
        };

        // -- betas ----------------------------------------------------
        const features: BetaFeatures = {
            usesCompaction: historyHasCompaction,
            usesContextManagement: contextManagement,
            fast,
            usesAdvisor: toolPolicy.usesAdvisor,
            usesTaskBudget: !!args.taskBudget,
            thinkingDisplayUpdates:
                (thinkingConfig as { display?: string } | undefined)
                    ?.display === 'updates',
            thinkingBlockBinding: !!(
                thinkingConfig as { block_binding?: unknown } | undefined
            )?.block_binding,
            usesClearAt: systemPartition.usesClearAt,
            usesDeferredTools: toolPolicy.usesDeferredTools,
            uses1hTtl: hasExtendedCacheTtl({
                system: systemBlocks,
                tools,
                messages,
                cache_control: topCacheControl,
            }),
            usesFilesApi: usesBetaFiles,
            usesThinking: !!thinkingConfig,
            usesTools: !!(tools && tools.length > 0),
            usesEffort: !!outputConfig?.effort,
            usesOutputFormat: !!outputConfig?.format,
            usesStrictTool: toolPolicy.usesStrictTool,
            usesWebSearch: toolPolicy.usesWebSearch,
            usesMidConversationSystem:
                systemPartition.usesMidConversationSystem,
            usesSafeguards: !!safeguardsPolicy,
        };
        const betas = combineBetas(
            deriveBetas(features),
            allowlistedFromHeader(args.anthropicBetas, features),
            safeguardsPolicy ? [safeguardsPolicy.beta] : [],
        );
        const usesBeta = betas.length > 0;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sdkParams: Record<string, any> = {
            model: modelUsed.id,
            // The ceiling belongs to the entry actually being called, so it
            // comes off `modelUsed` — already matched by id or alias — rather
            // than a second lookup that repeats the matching and can disagree.
            max_tokens: maxTokens,
            ...(resolvedTemperature !== undefined
                ? { temperature: resolvedTemperature }
                : {}),
            ...(!omitsSampling && args.top_p !== undefined
                ? { top_p: args.top_p }
                : {}),
            ...(!omitsSampling && args.topK !== undefined
                ? { top_k: args.topK }
                : {}),
            ...(args.stopSequences && args.stopSequences.length > 0
                ? { stop_sequences: args.stopSequences }
                : {}),
            ...(systemBlocks.length > 0 ? { system: systemBlocks } : {}),
            ...(toolChoice ? { tool_choice: toolChoice } : {}),
            messages,
            ...(tools ? { tools } : {}),
            ...(thinkingConfig ? { thinking: thinkingConfig } : {}),
            ...(outputConfig ? { output_config: outputConfig } : {}),
            ...(contextManagement
                ? { context_management: contextManagement }
                : {}),
            ...(topCacheControl ? { cache_control: topCacheControl } : {}),
            ...(fast ? { speed: 'fast' } : {}),
            ...(safeguardsPolicy
                ? { safeguards: safeguardsPolicy.safeguards }
                : {}),
            ...(userId ? { metadata: { user_id: userId } } : {}),
            ...(usesBeta ? { betas } : {}),
        };

        return {
            sdkParams,
            betas,
            usesBeta,
            modelUsed,
            uploadedFileIds,
            restoreUploads,
            cleanupUploads,
        };
    }

    /**
     * Everything that was already applied to `messages` before this phase:
     * cache_control shorthand, round-tripped reasoning artifacts, OpenAI
     * tool_calls/tool-role conversion, tool_use.input coercion, compaction
     * block mapping, media-part canonicalization — plus the new
     * `mergeConsecutiveUserTurns` pass. Copy-on-write throughout: the driver
     * reuses `args.messages` across fallback attempts.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    #transformMessages(messages: any[], forCountTokens?: boolean): any[] {
        // Legacy message-level cache_control shorthand → first content block.
        messages = messages.map((message) => {
            if (message.cache_control && Array.isArray(message.content)) {
                const content = message.content.slice();
                content[0] = {
                    ...content[0],
                    cache_control: sanitizeCacheControl(message.cache_control),
                };
                const { cache_control, ...rest } = message;
                return { ...rest, content };
            }
            if (message.cache_control) {
                const { cache_control, ...rest } = message;
                return rest;
            }
            return message;
        });

        // Splice round-tripped reasoning artifacts back into the assistant
        // content. Anthropic rejects an extended-thinking tool-use
        // continuation whose thinking blocks lost their `signature`, and
        // requires those blocks to lead the content array — so they are
        // prepended here, before the tool_use blocks are appended below.
        // `reasoning`/`refusal` are output-only fields Anthropic rejects
        // outright, and a caller replaying a normalized message carries them.
        messages = messages.map((original) => {
            const details = original.reasoning_details;
            if (
                details === undefined &&
                original.reasoning === undefined &&
                original.refusal === undefined
            ) {
                return original;
            }
            const message = { ...original };
            delete message.reasoning_details;
            delete message.reasoning;
            delete message.refusal;
            if (!Array.isArray(details)) return message;
            const blocks = details.filter(
                (block: unknown) =>
                    (block as { type?: string })?.type === 'thinking' ||
                    (block as { type?: string })?.type === 'redacted_thinking',
            );
            if (blocks.length === 0) return message;
            if (typeof message.content === 'string') {
                message.content = message.content
                    ? [{ type: 'text', text: message.content }]
                    : [];
            } else if (!Array.isArray(message.content)) {
                message.content = message.content ? [message.content] : [];
            }
            message.content = [...blocks, ...message.content];
            return message;
        });

        // Convert OpenAI-style tool calls/results to Claude format
        messages = messages.map((message) => {
            if (message.tool_calls && Array.isArray(message.tool_calls)) {
                const content = Array.isArray(message.content)
                    ? message.content.slice()
                    : message.content
                      ? [message.content]
                      : [];
                for (const toolCall of message.tool_calls) {
                    content.push({
                        type: 'tool_use',
                        id: toolCall.id,
                        name: toolCall.function?.name,
                        input: toolCall.function?.arguments ?? {},
                    });
                }
                const { tool_calls, ...rest } = message;
                return { ...rest, content };
            }

            if (message.role !== 'tool') return message;

            const toolUseId = message.tool_call_id || message.tool_use_id;

            const contentValue = (() => {
                if (Array.isArray(message.content)) {
                    const toolResultBlock = message.content.find(
                        (part: Record<string, unknown>) =>
                            part?.type === 'tool_result',
                    );
                    if (toolResultBlock) {
                        return (
                            toolResultBlock.content ??
                            toolResultBlock.text ??
                            ''
                        );
                    }

                    return message.content
                        .map((part: unknown) => {
                            if (typeof part === 'string') return part;
                            if (
                                part &&
                                typeof (part as Record<string, unknown>)
                                    .text === 'string'
                            ) {
                                return (part as Record<string, unknown>).text;
                            }
                            if (
                                part &&
                                typeof (part as Record<string, unknown>)
                                    .content === 'string'
                            ) {
                                return (part as Record<string, unknown>)
                                    .content;
                            }
                            return '';
                        })
                        .join('');
                }
                if (typeof message.content === 'string') return message.content;
                if (
                    message.content &&
                    typeof message.content.text === 'string'
                ) {
                    return message.content.text;
                }
                if (
                    message.content &&
                    typeof message.content.content === 'string'
                ) {
                    return message.content.content;
                }
                return '';
            })();

            return {
                role: 'user',
                content: [
                    {
                        type: 'tool_result',
                        tool_use_id: toolUseId,
                        content: contentValue,
                    },
                ],
            };
        });

        // Claude requires tool_use.input to be a dictionary
        messages = messages.map((message) => {
            if (!Array.isArray(message.content)) return message;
            let changed = false;
            const content = message.content.map(
                (part: Record<string, unknown>) => {
                    if (part?.type !== 'tool_use') return part;
                    let input = part.input;
                    if (typeof input === 'string') {
                        try {
                            input = JSON.parse(input);
                        } catch {
                            input = {};
                        }
                        changed = true;
                    } else if (input === undefined || input === null) {
                        input = {};
                        changed = true;
                    } else {
                        return part;
                    }
                    return { ...part, input };
                },
            );
            return changed ? { ...message, content } : message;
        });

        // Map round-tripped compaction blocks back to Anthropic's native shape.
        // The internal/unified carrier field is `encrypted_content`; Anthropic's
        // compaction block uses `content` (a plaintext summary).
        messages = messages.map((message) => {
            if (!Array.isArray(message.content)) return message;
            let changed = false;
            const content = message.content.map(
                (part: Record<string, unknown>) => {
                    if (part?.type !== 'compaction') return part;
                    changed = true;
                    return {
                        type: 'compaction',
                        content: part.content ?? part.encrypted_content ?? '',
                    };
                },
            );
            return changed ? { ...message, content } : message;
        });

        // Canonical media parts → Anthropic blocks, copy-on-write: the driver
        // reuses these message objects on fallback to OpenAI-format routes.
        messages = messages.map((message) => {
            if (!Array.isArray(message.content)) return message;
            let changed = false;
            const content = message.content.map((part: unknown) => {
                const converted = toAnthropicMediaPart(part);
                if (converted !== part) changed = true;
                return converted;
            });
            return changed ? { ...message, content } : message;
        });

        if (!forCountTokens) {
            messages = mergeConsecutiveUserTurns(messages);
        }

        return messages;
    }

    #buildThinking(
        args: ICompleteArguments,
        modelId: string,
        maxTokens: number | undefined,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ): any {
        if (args.thinking === null) return undefined;
        if (args.thinking !== undefined) {
            const t = args.thinking;
            if (t.type === 'enabled') {
                let budget = t.budgetTokens ?? 1024;
                if (
                    typeof maxTokens === 'number' &&
                    Number.isFinite(maxTokens)
                ) {
                    budget = Math.min(budget, maxTokens - 1);
                }
                if (budget < 1024) return undefined; // the credit gate may have lowered max_tokens
                return {
                    type: 'enabled',
                    budget_tokens: Math.floor(budget),
                    ...(t.display ? { display: t.display } : {}),
                    ...(t.blockBinding
                        ? {
                              block_binding: {
                                  prefix_mismatch_behavior:
                                      t.blockBinding.prefixMismatchBehavior,
                              },
                          }
                        : {}),
                };
            }
            return {
                type: t.type,
                ...(t.display ? { display: t.display } : {}),
                ...(t.blockBinding
                    ? {
                          block_binding: {
                              prefix_mismatch_behavior:
                                  t.blockBinding.prefixMismatchBehavior,
                          },
                      }
                    : {}),
            };
        }

        // `undefined`: legacy derivation from `reasoning_effort`.
        const reasoningEffort = (args.reasoning_effort ??
            args.reasoning?.effort) as 'low' | 'medium' | 'high' | undefined;
        return this.#buildThinkingConfigLegacy({
            modelId,
            reasoningEffort,
            maxTokens,
        });
    }

    #buildThinkingConfigLegacy({
        modelId,
        reasoningEffort,
        maxTokens,
    }: {
        modelId?: string;
        reasoningEffort?: 'low' | 'medium' | 'high';
        maxTokens?: number;
    }) {
        if (!reasoningEffort) return undefined;

        // These models reject manual thinking budgets; summarized display
        // keeps reasoning visible in the stream.
        if (
            modelId === 'claude-haiku-5-5' ||
            modelId === 'claude-fable-5-1' ||
            modelId === 'claude-fable-5' ||
            modelId === 'claude-sonnet-5-5' ||
            modelId === 'claude-sonnet-5' ||
            modelId === 'claude-opus-5-5' ||
            modelId === 'claude-opus-5' ||
            modelId === 'claude-opus-4-8' ||
            modelId === 'claude-opus-4-7'
        ) {
            return {
                type: 'adaptive' as const,
                display: 'summarized' as const,
            };
        }
        if (modelId === 'claude-opus-4-6' || modelId === 'claude-sonnet-4-6') {
            return { type: 'adaptive' as const };
        }

        const requestedBudget = { low: 1024, medium: 4096, high: 8192 }[
            reasoningEffort
        ];

        if (typeof maxTokens === 'number' && Number.isFinite(maxTokens)) {
            if (Math.floor(maxTokens - 1) < 1024) return undefined;
        }

        const budget_tokens = Math.floor(
            Math.max(
                1024,
                Math.min(
                    requestedBudget,
                    maxTokens ? maxTokens - 1 : requestedBudget,
                ),
            ),
        );

        return { type: 'enabled' as const, budget_tokens };
    }

    #buildOutputConfig(
        args: ICompleteArguments,
        effort: ICompleteArguments['reasoning_effort'] | undefined,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ): any {
        const format = args.outputFormat
            ? {
                  type: 'json_schema',
                  schema: args.outputFormat.schema,
                  ...(args.outputFormat.name
                      ? { name: args.outputFormat.name }
                      : {}),
                  ...(args.outputFormat.strict !== undefined
                      ? { strict: args.outputFormat.strict }
                      : {}),
              }
            : undefined;
        const taskBudget = args.taskBudget
            ? {
                  type: 'tokens',
                  total: args.taskBudget.total,
                  ...(args.taskBudget.remaining !== undefined
                      ? { remaining: args.taskBudget.remaining }
                      : {}),
              }
            : undefined;

        const out = {
            ...(effort ? { effort } : {}),
            ...(format ? { format } : {}),
            ...(taskBudget ? { task_budget: taskBudget } : {}),
        };
        return Object.keys(out).length > 0 ? out : undefined;
    }

    #buildToolChoice(tools: unknown[] | undefined, args: ICompleteArguments) {
        if (!tools || tools.length === 0) return undefined;
        // A raw `/drivers/call` caller can still hand this a wire-form
        // tool_choice (a bare 'auto' string, say) rather than the normalized
        // shape — spreading that below would be malformed.
        const rawChoice = args.tool_choice;
        const tc =
            (isToolChoice(rawChoice)
                ? rawChoice
                : rawChoice !== undefined
                  ? toolChoiceFromWire(rawChoice, 'chat')
                  : undefined) ?? ({ type: 'auto' } as const);
        const disable =
            args.parallel_tool_calls === undefined
                ? true
                : !args.parallel_tool_calls;
        if (tc.type === 'auto' && !disable) return undefined; // the quiet default
        return {
            ...tc,
            ...(disable && tc.type !== 'none'
                ? { disable_parallel_tool_use: true }
                : {}),
        };
    }

    // -- Streaming -----------------------------------------------------

    async #pumpStream({
        completion,
        events,
        chatStream,
        modelUsed,
    }: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        completion: any;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        events: AsyncIterator<any>;
        chatStream: AIChatStream;
        modelUsed: IChatModel;
    }) {
        const actor = Context.get('actor');
        let message: ReturnType<AIChatStream['message']> | null = null;
        const blocks = new Map<number, BlockState>();
        let emittedCompaction = false;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let finalUsage: any = null;

        for await (const event of { [Symbol.asyncIterator]: () => events }) {
            switch (event.type) {
                case 'message_start': {
                    message = chatStream.message();
                    continue;
                }
                case 'message_stop': {
                    message?.end();
                    message = null;
                    continue;
                }
                case 'message_delta': {
                    chatStream.setStop({
                        reason: event.delta?.stop_reason ?? undefined,
                        sequence: event.delta?.stop_sequence ?? null,
                        details: event.delta?.stop_details ?? null,
                    });
                    if ('safeguard_results' in (event.delta ?? {})) {
                        chatStream.safeguardResults(
                            event.delta.safeguard_results,
                        );
                    }
                    if (event.context_management) {
                        chatStream.setContextManagement(
                            event.context_management,
                        );
                    }
                    finalUsage = mergeUsageMax(finalUsage, event.usage);
                    continue;
                }
                case 'content_block_start': {
                    const b = event.content_block;
                    const i = event.index;
                    switch (b.type) {
                        case 'text':
                            blocks.set(i, {
                                kind: 'text',
                                s: message!.contentBlock({
                                    type: 'text',
                                }) as AIChatTextStream,
                            });
                            break;
                        case 'thinking':
                            chatStream.reasoningStart('anthropic');
                            blocks.set(i, {
                                kind: 'thinking',
                                s: message!.contentBlock({
                                    type: 'text',
                                }) as AIChatTextStream,
                                thinking: '',
                                signature: b.signature ?? '',
                            });
                            break;
                        case 'redacted_thinking':
                            chatStream.reasoningDetail({
                                type: 'redacted_thinking',
                                data: b.data,
                            });
                            blocks.set(i, { kind: 'done' });
                            break;
                        case 'tool_use':
                            blocks.set(i, {
                                kind: 'tool',
                                s: message!.contentBlock({
                                    type: 'tool_use',
                                    id: b.id,
                                    name: b.name,
                                }) as AIChatToolUseStream,
                            });
                            break;
                        case 'server_tool_use':
                            blocks.set(i, {
                                kind: 'serverToolUse',
                                block: { type: b.type, id: b.id, name: b.name },
                                json: '',
                            });
                            break;
                        case 'compaction':
                            blocks.set(i, {
                                kind: 'compaction',
                                id: b.id,
                                payload: b.content ?? b.encrypted_content ?? '',
                                buffer: '',
                            });
                            break;
                        default:
                            if (SERVER_RESULT_BLOCKS.has(b.type)) {
                                chatStream.serverTool(b);
                            } else {
                                this.#warnUnknownBlockOnce(b.type);
                            }
                            blocks.set(i, { kind: 'done' });
                    }
                    continue;
                }
                case 'content_block_delta': {
                    const st = blocks.get(event.index);
                    if (!st) continue;
                    const d = event.delta;
                    if (st.kind === 'compaction') {
                        // `compaction_delta` carries the summary as `content`.
                        const chunk =
                            d.content ??
                            d.partial_json ??
                            d.text ??
                            d.data ??
                            '';
                        if (typeof chunk === 'string') st.buffer += chunk;
                        continue;
                    }
                    if (d.type === 'text_delta' && st.kind === 'text') {
                        st.s.addText(d.text);
                    } else if (
                        d.type === 'thinking_delta' &&
                        st.kind === 'thinking'
                    ) {
                        st.thinking += d.thinking;
                        st.s.addReasoning(d.thinking);
                    } else if (
                        d.type === 'signature_delta' &&
                        st.kind === 'thinking'
                    ) {
                        st.signature = d.signature;
                    } else if (d.type === 'input_json_delta') {
                        if (st.kind === 'tool') {
                            st.s.addPartialJSON(d.partial_json);
                        } else if (st.kind === 'serverToolUse') {
                            st.json += d.partial_json;
                            chatStream.countOutput(d.partial_json);
                        }
                    }
                    // citations_delta: dropped (streamed citations are not
                    // replayed; non-stream keeps them verbatim).
                    continue;
                }
                case 'content_block_stop': {
                    const st = blocks.get(event.index);
                    blocks.delete(event.index);
                    if (!st) continue;
                    if (st.kind === 'compaction') {
                        const encrypted_content = st.payload || st.buffer || '';
                        if (encrypted_content) {
                            chatStream.compaction({
                                id: st.id,
                                encrypted_content,
                            });
                            emittedCompaction = true;
                        }
                    } else if (st.kind === 'thinking') {
                        st.s.end();
                        chatStream.reasoningDetail({
                            type: 'thinking',
                            thinking: st.thinking,
                            signature: st.signature,
                        });
                    } else if (st.kind === 'serverToolUse') {
                        let input: unknown = {};
                        try {
                            input = st.json.trim() ? JSON.parse(st.json) : {};
                        } catch {
                            input = {};
                        }
                        chatStream.serverTool({ ...st.block, input });
                    } else if (st.kind === 'text' || st.kind === 'tool') {
                        st.s.end();
                    }
                    continue;
                }
                default:
                    continue;
            }
        }

        // The SDK only rejects event readers that were already waiting, so a
        // failure that landed before this loop started pulling ends it
        // silently rather than throwing.
        if (completion.errored) await completion.finalMessage();

        const finalMessage = await completion
            .finalMessage()
            .catch((): null => null);
        if (finalMessage) {
            finalUsage = finalMessage.usage ?? finalUsage;
            if (!emittedCompaction) {
                const block = ((finalMessage.content as unknown[]) ?? []).find(
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (c: any) => c?.type === 'compaction',
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ) as any;
                if (block) {
                    chatStream.compaction({
                        id: block.id,
                        encrypted_content:
                            block.content ?? block.encrypted_content ?? '',
                    });
                    emittedCompaction = true;
                }
            }
        }

        // Metered before `end`: handing usage to `end` is what tells the
        // driver this completion has been charged for, so anything that
        // throws between the two would leave it charged to nobody.
        const { usage, costs, details, advisorModel } = this.#meter(
            finalUsage ?? {},
            modelUsed,
        );
        this.#meteringService.utilRecordUsageObject(
            usage.executor,
            actor,
            this.meteringModelKey(modelUsed.id),
            costs.executor,
        );
        if (usage.advisor) {
            this.#meteringService.utilRecordUsageObject(
                usage.advisor,
                actor,
                this.meteringModelKey((advisorModel ?? modelUsed).id),
                costs.advisor,
            );
        }
        chatStream.setUsageDetails(details);
        chatStream.setUsageCosts({
            ...costs.executor,
            ...(costs.advisor ?? {}),
        });
        chatStream.end({ ...usage.executor, ...(usage.advisor ?? {}) });
    }

    #warnUnknownBlockOnce(type: string) {
        if (this.#warnedBlockTypes.has(type)) return;
        this.#warnedBlockTypes.add(type);
        console.warn(
            `[ai-chat] claude: unknown content block type '${type}', dropping`,
        );
    }

    // -- Metering --------------------------------------------------------

    /**
     * Turns raw Anthropic usage into the usage/cost pair the driver and ledger
     * expect, split into the executor's own numbers and (when an advisor tool
     * ran) the advisor's — the two are metered under separate model keys so
     * each pays its own cost factor.
     *
     * `output_tokens` already includes thinking tokens; unlike the previous
     * `thinking_tokens` usage key, nothing here bills them a second time.
     */
    #meter(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        raw: any,
        modelUsed: IChatModel,
    ): {
        usage: {
            executor: Record<string, number>;
            advisor?: Record<string, number>;
        };
        costs: {
            executor: Record<string, number>;
            advisor?: Record<string, number>;
        };
        details: UsageDetails;
        /**
         * The model actually used to price the advisor's usage (resolved or
         * priciest-fallback).
         */
        advisorModel?: IChatModel;
    } {
        raw = raw ?? {};
        // Reported as upstream sent it; the folded totals below are for billing.
        const topInputTokens = raw.input_tokens ?? 0;
        const topOutputTokens = raw.output_tokens ?? 0;
        const exec = {
            input_tokens: raw.input_tokens ?? 0,
            ephemeral_5m_input_tokens:
                raw.cache_creation?.ephemeral_5m_input_tokens ??
                raw.cache_creation_input_tokens ??
                0,
            ephemeral_1h_input_tokens:
                raw.cache_creation?.ephemeral_1h_input_tokens ?? 0,
            cache_read_input_tokens: raw.cache_read_input_tokens ?? 0,
            output_tokens: raw.output_tokens ?? 0,
        };

        let advisorInput = 0;
        let advisorW5m = 0;
        let advisorW1h = 0;
        let advisorRead = 0;
        let advisorOutput = 0;
        let advisorModelId: string | undefined;

        for (const it of raw.iterations ?? []) {
            if (it.type === 'message') continue; // already in the top level
            if (it.type === 'advisor_message') {
                advisorInput += it.input_tokens ?? 0;
                advisorW5m +=
                    it.cache_creation?.ephemeral_5m_input_tokens ??
                    it.cache_creation_input_tokens ??
                    0;
                advisorW1h += it.cache_creation?.ephemeral_1h_input_tokens ?? 0;
                advisorRead += it.cache_read_input_tokens ?? 0;
                advisorOutput += it.output_tokens ?? 0;
                advisorModelId ??= it.model;
                continue;
            }
            // compaction and any other iteration type: billed at executor rates.
            exec.input_tokens += it.input_tokens ?? 0;
            exec.output_tokens += it.output_tokens ?? 0;
        }

        const fast =
            raw.speed === 'fast' &&
            modelUsed.costs?.fast_output_tokens !== undefined;
        const executorUsage: Record<string, number> = fast
            ? Object.fromEntries(
                  Object.entries(exec).map(([k, v]) => [`fast_${k}`, v]),
              )
            : { ...exec };

        const searches = raw.server_tool_use?.web_search_requests ?? 0;
        if (searches) executorUsage.web_search_requests = searches;
        const fetches = raw.server_tool_use?.web_fetch_requests ?? 0;
        if (fetches) executorUsage.web_fetch_requests = fetches;

        const executorCosts = buildCostsOverride(executorUsage, modelUsed);

        let advisorUsage: Record<string, number> | undefined;
        let advisorCosts: Record<string, number> | undefined;
        let advisorModel: IChatModel | undefined;
        if (
            advisorModelId !== undefined ||
            advisorInput > 0 ||
            advisorOutput > 0
        ) {
            advisorModel = resolveAdvisorModel(advisorModelId, this.models());
            const rawAdvisorUsage = {
                input_tokens: advisorInput,
                ephemeral_5m_input_tokens: advisorW5m,
                ephemeral_1h_input_tokens: advisorW1h,
                cache_read_input_tokens: advisorRead,
                output_tokens: advisorOutput,
            };
            const rawAdvisorCosts = buildCostsOverride(
                rawAdvisorUsage,
                advisorModel,
            );
            advisorUsage = Object.fromEntries(
                Object.entries(rawAdvisorUsage).map(([k, v]) => [
                    `advisor_${k}`,
                    v,
                ]),
            );
            advisorCosts = Object.fromEntries(
                Object.entries(rawAdvisorCosts).map(([k, v]) => [
                    `advisor_${k}`,
                    v,
                ]),
            );
        }

        const details: UsageDetails = {
            inputTokens: topInputTokens,
            outputTokens: topOutputTokens,
            ...(exec.cache_read_input_tokens
                ? { cacheReadTokens: exec.cache_read_input_tokens }
                : {}),
            ...(exec.ephemeral_5m_input_tokens
                ? { cacheWrite5mTokens: exec.ephemeral_5m_input_tokens }
                : {}),
            ...(exec.ephemeral_1h_input_tokens
                ? { cacheWrite1hTokens: exec.ephemeral_1h_input_tokens }
                : {}),
            ...(searches ? { webSearchRequests: searches } : {}),
            ...(fetches ? { webFetchRequests: fetches } : {}),
            ...(fast
                ? { speed: 'fast' as const }
                : raw.speed
                  ? { speed: raw.speed }
                  : {}),
            ...(raw.service_tier ? { serviceTier: raw.service_tier } : {}),
            ...((raw.output_tokens_details?.thinking_tokens ??
            raw.thinking_tokens)
                ? {
                      reasoningTokens:
                          raw.output_tokens_details?.thinking_tokens ??
                          raw.thinking_tokens,
                  }
                : {}),
            // Every pass verbatim: Claude Code sizes its context off the last
            // `message` iteration, not the summed top-level counts.
            ...(Array.isArray(raw.iterations) && raw.iterations.length > 0
                ? { iterations: raw.iterations.map(iterationDetails) }
                : {}),
        };

        return {
            usage: {
                executor: executorUsage,
                ...(advisorUsage ? { advisor: advisorUsage } : {}),
            },
            costs: {
                executor: executorCosts,
                ...(advisorCosts ? { advisor: advisorCosts } : {}),
            },
            details,
            advisorModel,
        };
    }

    checkModeration(_text: string): never {
        throw new Error('CheckModeration not provided by Claude provider.');
    }
}
