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

/**
 * Types for the `puter-chat-completion` driver interface.
 *
 * No openai SDK type dependency. The PuterMessage type is intentionally loose;
 * each provider normalises internally.
 */

export type ModelCost = Record<string, number>;

export interface ModelModalities {
    input: string[];
    output: string[];
}

export interface IChatModel<T extends ModelCost = ModelCost> extends Record<
    string,
    unknown
> {
    id: string;
    provider?: string;
    puterId?: string;
    aliases?: string[];
    costs_currency: string;
    input_cost_key?: keyof T;
    output_cost_key?: keyof T;
    costs: T;
    /**
     * A request whose input exceeds `threshold` tokens is billed at raised
     * rates for the whole request, not only the tokens past the threshold:
     * every input-side rate (uncached, cached, cache writes) is multiplied by
     * `input_multiplier` and every output-side rate by `output_multiplier`.
     */
    long_context_pricing?: {
        threshold: number;
        input_multiplier: number;
        output_multiplier: number;
    };
    context?: number;
    max_tokens: number;
    subscriberOnly?: boolean;
    minimumCredits?: number;
    modalities?: ModelModalities;
    open_weights?: boolean;
    tool_call?: boolean;
    responses_api?: boolean;
    responses_api_only?: boolean;
    /**
     * Omitted preserves sampling; reasoningDisabled requires explicit effort
     * none.
     */
    responsesSampling?: 'never' | 'reasoningDisabled';
    knowledge?: string;
    release_date?: string;
    /**
     * Claude only: this model accepts `role:'system'` messages after the first
     * non-system message (live-verified per model). Unsupported models 400 on a
     * mid-conversation system message, so ClaudeProvider folds one into the
     * leading `system` blocks instead.
     */
    midConversationSystem?: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PuterMessage = any;

/**
 * `reasoning_effort` vocabulary, widened to cover Claude's
 * `output_config.effort`.
 */
export type ReasoningEffort =
    'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/** Normalized tool choice, Anthropic vocabulary. */
export type ToolChoice =
    | { type: 'auto' }
    | { type: 'any' }
    | { type: 'none' }
    | { type: 'tool'; name: string };

export interface ThinkingConfig {
    type: 'adaptive' | 'enabled' | 'disabled' | 'between_tools';
    /** `enabled` only; Claude clamps it below `max_tokens`. */
    budgetTokens?: number;
    display?: 'summarized' | 'omitted' | 'updates';
    /** Claude only (`thinking.block_binding`). */
    blockBinding?: { prefixMismatchBehavior: 'error' | 'drop_block' };
}

export interface OutputFormat {
    type: 'json_schema';
    schema: Record<string, unknown>;
    name?: string;
    strict?: boolean;
}

export interface CacheControl {
    type: 'ephemeral';
    ttl?: '5m' | '1h';
}

export interface SafeguardRequest {
    type: 'dangerous_tool_use';
    classifier_context: Record<string, unknown>;
}

export type StopReason =
    | 'end_turn'
    | 'max_tokens'
    | 'stop_sequence'
    | 'tool_use'
    | 'pause_turn'
    | 'refusal'
    | 'model_context_window_exceeded'
    | (string & {});

/** Provider-neutral usage breakdown. `inputTokens` excludes cache reads/writes. */
export interface UsageDetails {
    inputTokens: number;
    outputTokens: number; // includes reasoning
    cacheReadTokens?: number;
    cacheWrite5mTokens?: number;
    cacheWrite1hTokens?: number;
    reasoningTokens?: number;
    webSearchRequests?: number;
    webFetchRequests?: number;
    speed?: 'fast' | 'standard';
    serviceTier?: string;
    /**
     * Per-pass breakdown when the upstream ran several passes (compaction,
     * advisor).
     */
    iterations?: Array<{
        type: string;
        model?: string;
        inputTokens: number;
        outputTokens: number;
        cacheReadTokens?: number;
        cacheWrite5mTokens?: number;
        cacheWrite1hTokens?: number;
    }>;
}

export interface ICompleteArguments {
    messages: PuterMessage[];
    provider?: string;
    stream?: boolean;
    model: string;
    test_mode?: boolean;
    tools?: unknown[];
    /** Normalized tool choice; providers map it to their own wire shape. */
    tool_choice?: ToolChoice;
    parallel_tool_calls?: boolean;
    /**
     * `null` sends no `thinking` field at all (model default). `undefined`
     * falls back to the legacy derivation from `reasoning_effort`.
     */
    thinking?: ThinkingConfig | null;
    outputFormat?: OutputFormat;
    stopSequences?: string[];
    topK?: number;
    /** Claude only (`output_config.task_budget`). */
    taskBudget?: { total: number; remaining?: number };
    /** Claude only: top-level automatic `cache_control`. */
    cacheControl?: CacheControl;
    /**
     * Claude only; forwarded only when the model's catalog entry has
     * `fast_output_tokens`.
     */
    speed?: 'fast' | 'standard';
    /** Claude only. */
    safeguards?: SafeguardRequest[];
    /**
     * Claude only: the raw `anthropic-beta` header, intersected with an
     * allowlist.
     */
    anthropicBetas?: string[];
    /** Emit `tool_use_start` / `tool_input_delta` chunks while streaming. */
    streamToolInput?: boolean;
    include?: unknown[];
    conversation?: unknown;
    /**
     * Provider-neutral inline-compaction opt-in. `true` enables compaction with
     * provider defaults; `{ trigger_tokens }` sets the token threshold at which
     * the upstream summarizes earlier context. Each provider translates this to
     * its own SDK shape (OpenAI `context_management:[{type:'compaction',...}]`,
     * Anthropic `context_management:{edits:[{type:'compact_20260112'}]}`).
     */
    compaction?: boolean | { trigger_tokens?: number };
    /**
     * Escape hatch: provider-native `context_management` payload, passed
     * through untouched (used by `/responses` callers sending the OpenAI-native
     * array).
     */
    context_management?: unknown;
    previous_response_id?: string;
    instructions?: string | PuterMessage[];
    metadata?: Record<string, string>;
    prompt?: unknown;
    prompt_cache_key?: string;
    prompt_cache_retention?: 'in-memory' | '24h' | undefined;
    store?: boolean;
    top_p?: number;
    truncation?: 'auto' | 'disabled' | undefined;
    background?: boolean;
    service_tier?:
        'auto' | 'default' | 'flex' | 'scale' | 'priority' | undefined;
    max_tokens?: number;
    temperature?: number;
    reasoning?: { effort: 'low' | 'medium' | 'high' } | undefined;
    text?: { verbosity?: 'low' | 'medium' | 'high' | undefined } | undefined;
    reasoning_effort?: ReasoningEffort | undefined;
    verbosity?: 'low' | 'medium' | 'high' | undefined;
    moderation?: boolean;
    custom?: unknown;
    /**
     * Response-format control for non-streaming results. `true` coerces the
     * result to the OpenAI `choices[0]` shape (string `message.content`,
     * `message.tool_calls`, mapped `finish_reason`); `false` forces the
     * provider-native shape. Left undefined, the legacy `response.normalize`
     * flag applies if set; otherwise models released on or after
     * [[OPENAI_SHAPE_CUTOFF]] (2026-09-01) are coerced by default.
     */
    normalize?: boolean;
    response?: {
        normalize?: boolean;
    };
    customLimitMessage?: string;
}

export interface IChatStreamResult {
    init_chat_stream: (params: { chatStream: unknown }) => Promise<void>;
    stream: true;
    finally_fn: () => Promise<void>;
    message?: never;
    usage?: never;
    finish_reason?: never;
}

export interface IChatMessageResult {
    message: PuterMessage;
    usage: Record<string, number>;
    finish_reason: string;
    init_chat_stream?: never;
    stream?: never;
    finally_fn?: never;
    normalized?: boolean;
    via_ai_chat_service?: boolean;
    /**
     * Inline-compaction artifact, present when the upstream compacted earlier
     * context during this (non-streaming) response. Carries `type:'compaction'`
     * so it's a drop-in `messages` item — the caller resends it on the next
     * turn in place of the summarized history. See [[ICompleteArguments]].
     */
    compaction?: { type: 'compaction'; id?: string; encrypted_content: string };
    stopReason?: StopReason;
    stopSequence?: string | null;
    stopDetails?: Record<string, unknown> | null;
    usageDetails?: UsageDetails;
    /** Claude only. */
    safeguardResults?: unknown[];
    /** Claude only. */
    contextManagement?: Record<string, unknown>;
    /**
     * Internal: per-usage-key cost (µ¢) the provider already metered with, so
     * the driver's reported cost matches the ledger exactly. Stripped before
     * the result reaches the caller.
     */
    usageCosts?: Record<string, number>;
}

export type IChatCompleteResult = IChatStreamResult | IChatMessageResult;

export interface IChatProvider {
    models(extra_params?: unknown): IChatModel[] | Promise<IChatModel[]>;
    list(): string[] | Promise<string[]>;
    getDefaultModel(): string;
    complete(arg: ICompleteArguments): Promise<IChatCompleteResult>;
    checkModeration(
        text: string,
    ): Promise<{ flagged: boolean; categories?: string[] }> | void;
    /**
     * Set when the provider uploads `puter_path` parts itself (Anthropic's
     * Files API); otherwise the driver inlines them as data URLs before each
     * attempt.
     */
    readonly resolvesPuterPaths?: boolean;
    /**
     * The model key usage is recorded under, which is also what the AI cost
     * factor is looked up by. The driver assumes `<provider>:<model id>` when
     * absent.
     */
    meteringModelKey?(modelId: string): string;
    /**
     * Request-specific pricing the credit gate must reserve for (web search,
     * fast mode, the advisor tool), in µ¢, before the AI cost factor.
     */
    requestPricing?(
        args: ICompleteArguments,
        model: IChatModel,
        est: { promptTokenEstimate: number },
    ): { inputKey?: string; outputKey?: string; extraCost?: number };
    /**
     * Exact prompt token count, when the vendor offers one (e.g. Claude's
     * `count_tokens`).
     */
    countTokens?(args: ICompleteArguments): Promise<number>;
}
