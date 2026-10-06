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
 * Anthropic `/v1/messages` wire translation.
 *
 * `parseAnthropicRequest` maps the Anthropic request body (plus the
 * `anthropic-beta` header) to a normalized `ICompleteArguments`, doing only
 * shape-level validation and field renaming — tool/beta _policy_ (clamps,
 * allowlists, rejects) lives on `ClaudeProvider`/`anthropicPolicy.ts`, since
 * `/drivers/call` can reach the provider directly with arbitrary args and must
 * see the same rules. `toAnthropicMessage` is the inverse for a non-streaming
 * result, and `anthropicUsage` is the usage-shape builder both the
 * non-streaming path and the SSE writer (`sse.ts`) share.
 */

import type { IncomingHttpHeaders } from 'node:http';
import { HttpError } from '../../core/http/HttpError.js';
import { sanitizeCacheControl } from '../../drivers/ai-chat/providers/claude/anthropicPolicy.js';
import type {
    ICompleteArguments,
    IChatMessageResult,
    OutputFormat,
    ReasoningEffort,
    SafeguardRequest,
    ThinkingConfig,
    ToolChoice,
    UsageDetails,
} from '../../drivers/ai-chat/types.js';
import { needsOpenAICoercion } from '../../drivers/ai-chat/utils/normalizeToOpenAI.js';
import { fromFinishReason } from '../../drivers/ai-chat/utils/stopReason.js';

const toStringOrEmpty = (v: unknown): string =>
    typeof v === 'string' ? v : '';

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === 'object' && !Array.isArray(v);

const num = (key: string, v: unknown): Record<string, number> => {
    if (v === undefined) return {};
    const n = Number(v);
    return Number.isFinite(n) ? { [key]: n } : {};
};

const finiteMaxTokens = (v: unknown): { max_tokens: number } | undefined => {
    if (v === undefined) return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? { max_tokens: n } : undefined;
};

const badRequest = (message: string): HttpError =>
    new HttpError(400, message, { legacyCode: 'bad_request' });

// -- anthropic-beta header --------------------------------------------------

/** Comma-split, trimmed, deduped. A repeated header line is joined first. */
export const parseBetaHeader = (header: unknown): string[] => {
    const raw = Array.isArray(header) ? header.join(',') : header;
    if (typeof raw !== 'string' || !raw) return [];
    return [
        ...new Set(
            raw
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean),
        ),
    ];
};

const MESSAGE_THREADS_BETA = 'message-threads-2026-08-12';

/**
 * `thread`/the message-threads beta are server-held conversation state this
 * backend doesn't hold. Rejected up front, before any other work, with the
 * exact message Claude Code's own `AMe` regex recognizes — it then drops the
 * named beta for the session and retries once without threading.
 */
const rejectThreads = (
    body: Record<string, unknown>,
    betas: readonly string[],
): void => {
    const named = betas.find((b) => b.startsWith('message-threads-'));
    const beta =
        named ??
        (body.thread !== undefined && body.thread !== null
            ? MESSAGE_THREADS_BETA
            : undefined);
    if (beta === undefined) return;
    throw badRequest(
        `Unexpected value(s) \`${beta}\` for the \`anthropic-beta\` header. Please try again without the header.`,
    );
};

// -- system → messages -------------------------------------------------

const sanitizeSystemBlock = (
    block: unknown,
    index: number,
): Record<string, unknown> => {
    if (typeof block === 'string') return { type: 'text', text: block };
    if (
        !isPlainObject(block) ||
        block.type !== 'text' ||
        typeof block.text !== 'string'
    ) {
        throw badRequest(`system.${index}: unsupported block type`);
    }
    return {
        type: 'text',
        text: block.text,
        ...(block.cache_control
            ? { cache_control: sanitizeCacheControl(block.cache_control) }
            : {}),
        ...(block.citations !== undefined
            ? { citations: block.citations }
            : {}),
    };
};

/**
 * `body.system` → zero or one leading `{role:'system', content: blocks}`
 * message. A string becomes a single text block; an array keeps every block in
 * its original order and position — never merged, reordered, or split. That
 * matters beyond fidelity: Claude Code's first system block is its own
 * attribution header, recognized by Anthropic only when it is the sole content
 * of an isolated block. Concatenating it with anything else silently discards
 * the rest of that block (verified live; see the integration test).
 */
export const systemToMessages = (
    system: unknown,
): Record<string, unknown>[] => {
    if (typeof system === 'string') {
        return system
            ? [{ role: 'system', content: [{ type: 'text', text: system }] }]
            : [];
    }
    if (!Array.isArray(system) || system.length === 0) return [];
    return [{ role: 'system', content: system.map(sanitizeSystemBlock) }];
};

// -- messages ----------------------------------------------------

const ALLOWED_INPUT_BLOCK_TYPES = new Set([
    'text',
    'image',
    'document',
    'search_result',
    'tool_use',
    'tool_result',
    'tool_reference',
    'thinking',
    'redacted_thinking',
    'server_tool_use',
    'web_search_tool_result',
    'web_fetch_tool_result',
    'advisor_tool_result',
    'tool_search_tool_result',
    'compaction',
    // Internal, provider-resolved parts.
    'image_url',
]);

const FILE_SOURCED_BLOCK_TYPES = new Set(['image', 'document']);

const validateContentBlock = (block: unknown, path: string): void => {
    if (typeof block === 'string') return;
    if (isPlainObject(block) && block.puter_path !== undefined) return;
    if (!isPlainObject(block)) {
        throw badRequest(`${path}: unsupported block type`);
    }
    // The OpenAI Responses `input_image` type, and an `image_url`/`video_url`
    // part with no `type` at all (OpenAI Chat's untyped shape), are
    // rewritten downstream by `normalizeMediaParts` rather than validated
    // here — main's driver accepted both. A `video_url`-typed block is the
    // same part post-rewrite. Anything else with no `type` is still rejected.
    if (
        block.type === 'input_image' ||
        block.type === 'video_url' ||
        (block.type === undefined &&
            (block.image_url !== undefined || block.video_url !== undefined))
    ) {
        return;
    }
    if (
        typeof block.type !== 'string' ||
        !ALLOWED_INPUT_BLOCK_TYPES.has(block.type)
    ) {
        throw badRequest(`${path}: unsupported block type`);
    }
    if (block.type === 'text' && block.text === '') {
        throw badRequest('text content blocks must be non-empty');
    }
    if (FILE_SOURCED_BLOCK_TYPES.has(block.type)) {
        const source = block.source;
        if (isPlainObject(source) && source.type === 'file') {
            throw badRequest(
                `${path}: file-source ${block.type} blocks are not supported`,
            );
        }
    }
    if (block.type === 'tool_result' && Array.isArray(block.content)) {
        block.content.forEach((part, i) =>
            validateContentBlock(part, `${path}.content.${i}`),
        );
    }
};

/**
 * Shape-level validation only — tool_result ordering, `is_error`, caching and
 * every other block field pass through unchanged (no hoisting). Non-object
 * top-level entries are dropped defensively rather than rejected; a malformed
 * content block within a surviving message is a 400.
 */
export const validateMessages = (
    messages: readonly unknown[],
): Record<string, unknown>[] => {
    const out: Record<string, unknown>[] = [];
    messages.forEach((m, i) => {
        if (!isPlainObject(m)) return;
        if (Array.isArray(m.content)) {
            m.content.forEach((part, j) =>
                validateContentBlock(part, `messages.${i}.content.${j}`),
            );
        }
        out.push(m);
    });
    return out;
};

const validateTools = (tools: unknown): unknown[] => {
    if (!Array.isArray(tools))
        throw badRequest('tools: Input should be a valid list');
    return tools;
};

// -- tool_choice / parallel_tool_calls ----------------------------------

const toolChoiceFromAnthropic = (
    tc: unknown,
): { tool_choice?: ToolChoice; parallel_tool_calls: boolean } => {
    let toolChoice: ToolChoice | undefined;
    let disableParallel = false;
    if (isPlainObject(tc)) {
        if (tc.type === 'auto' || tc.type === 'any' || tc.type === 'none') {
            toolChoice = { type: tc.type };
        } else if (tc.type === 'tool' && typeof tc.name === 'string') {
            toolChoice = { type: 'tool', name: tc.name };
        }
        disableParallel = tc.disable_parallel_tool_use === true;
    }
    return {
        ...(toolChoice ? { tool_choice: toolChoice } : {}),
        parallel_tool_calls: !disableParallel,
    };
};

// -- thinking -----------------------------------------------------------

const THINKING_TYPES = new Set([
    'adaptive',
    'enabled',
    'disabled',
    'between_tools',
]);

const thinkingFromAnthropic = (t: unknown): ThinkingConfig | null => {
    if (
        !isPlainObject(t) ||
        typeof t.type !== 'string' ||
        !THINKING_TYPES.has(t.type)
    ) {
        return null;
    }
    const blockBinding = isPlainObject(t.block_binding)
        ? t.block_binding
        : undefined;
    const prefixMismatchBehavior = blockBinding?.prefix_mismatch_behavior;
    return {
        type: t.type as ThinkingConfig['type'],
        ...(t.type === 'enabled' && typeof t.budget_tokens === 'number'
            ? { budgetTokens: t.budget_tokens }
            : {}),
        ...(typeof t.display === 'string'
            ? { display: t.display as ThinkingConfig['display'] }
            : {}),
        ...(prefixMismatchBehavior === 'error' ||
        prefixMismatchBehavior === 'drop_block'
            ? { blockBinding: { prefixMismatchBehavior } }
            : {}),
    };
};

// -- output_config -------------------------------------------------------

interface OutputConfigFields {
    reasoning_effort?: ReasoningEffort;
    outputFormat?: OutputFormat;
    taskBudget?: { total: number; remaining?: number };
}

const outputConfigFromAnthropic = (oc: unknown): OutputConfigFields => {
    if (!isPlainObject(oc)) return {};
    const out: OutputConfigFields = {};
    if (typeof oc.effort === 'string') {
        out.reasoning_effort = oc.effort as ReasoningEffort;
    }
    const format = oc.format;
    if (
        isPlainObject(format) &&
        format.type === 'json_schema' &&
        isPlainObject(format.schema)
    ) {
        out.outputFormat = {
            type: 'json_schema',
            schema: format.schema,
            ...(typeof format.name === 'string' ? { name: format.name } : {}),
            ...(typeof format.strict === 'boolean'
                ? { strict: format.strict }
                : {}),
        };
    }
    const taskBudget = oc.task_budget;
    if (isPlainObject(taskBudget) && typeof taskBudget.total === 'number') {
        out.taskBudget = {
            total: taskBudget.total,
            ...(typeof taskBudget.remaining === 'number'
                ? { remaining: taskBudget.remaining }
                : {}),
        };
    }
    return out;
};

// -- compaction ---------------------------------------------------------------

const neutralCompaction = (
    c: unknown,
): { compaction?: boolean | { trigger_tokens?: number } } => {
    if (c === undefined) return {};
    if (typeof c === 'boolean') return { compaction: c };
    if (
        isPlainObject(c) &&
        (c.trigger_tokens === undefined || typeof c.trigger_tokens === 'number')
    ) {
        return {
            compaction:
                c.trigger_tokens !== undefined
                    ? { trigger_tokens: c.trigger_tokens as number }
                    : true,
        };
    }
    throw badRequest('compaction: must be a boolean or { trigger_tokens }');
};

// -- request parser (§2.R) ----------------------------------------------------

export interface ParseAnthropicRequestOptions {
    /**
     * `/v1/messages/count_tokens`: never streams, drops fields Anthropic's own
     * endpoint rejects.
     */
    countTokens?: boolean;
}

export const parseAnthropicRequest = (
    body: Record<string, unknown>,
    headers: IncomingHttpHeaders,
    opts: ParseAnthropicRequestOptions = {},
): ICompleteArguments => {
    if (!Array.isArray(body.messages))
        throw badRequest('messages: Field required');
    // `mcp_servers` is accepted but never forwarded: the result below picks
    // named fields rather than spreading `body`, so it's silently dropped.
    const betas = parseBetaHeader(headers['anthropic-beta']);
    rejectThreads(body, betas);

    const messages = [
        ...systemToMessages(body.system),
        ...validateMessages(body.messages),
    ];

    return {
        messages,
        model: toStringOrEmpty(body.model),
        stream: !opts.countTokens && !!body.stream,
        normalize: false,
        streamToolInput: true,
        ...(finiteMaxTokens(body.max_tokens) ?? {}),
        temperature:
            body.temperature === undefined ? 1 : Number(body.temperature),
        ...num('top_p', body.top_p),
        ...num('topK', body.top_k),
        ...(Array.isArray(body.stop_sequences)
            ? { stopSequences: body.stop_sequences.map(String) }
            : {}),
        ...(Array.isArray(body.tools)
            ? { tools: validateTools(body.tools) }
            : {}),
        ...toolChoiceFromAnthropic(body.tool_choice),
        thinking:
            body.thinking === undefined
                ? null
                : thinkingFromAnthropic(body.thinking),
        ...outputConfigFromAnthropic(body.output_config),
        ...(body.context_management !== undefined
            ? { context_management: body.context_management }
            : {}),
        ...neutralCompaction(body.compaction),
        ...(isPlainObject(body.cache_control)
            ? { cacheControl: sanitizeCacheControl(body.cache_control) }
            : {}),
        ...(body.speed === 'fast' ? { speed: 'fast' as const } : {}),
        ...(Array.isArray(body.safeguards)
            ? { safeguards: body.safeguards as SafeguardRequest[] }
            : {}),
        ...(betas.length ? { anthropicBetas: betas } : {}),
        provider: toStringOrEmpty(body.provider) || 'claude',
    };
    // Silently ignored: metadata, service_tier, inference_geo, container,
    // fallbacks, diagnostics.
};

// -- usage ---------------------------------------------------------------

// Every count is always present: Claude Code only trusts an iteration that
// carries all four token fields.
const toAnthropicIteration = (
    it: NonNullable<UsageDetails['iterations']>[number],
): Record<string, unknown> => ({
    type: it.type,
    ...(it.model ? { model: it.model } : {}),
    input_tokens: it.inputTokens,
    output_tokens: it.outputTokens,
    cache_read_input_tokens: it.cacheReadTokens ?? 0,
    cache_creation_input_tokens:
        (it.cacheWrite5mTokens ?? 0) + (it.cacheWrite1hTokens ?? 0),
    cache_creation: {
        ephemeral_5m_input_tokens: it.cacheWrite5mTokens ?? 0,
        ephemeral_1h_input_tokens: it.cacheWrite1hTokens ?? 0,
    },
});

export const anthropicUsage = (d: UsageDetails): Record<string, unknown> => ({
    input_tokens: d.inputTokens,
    cache_creation_input_tokens:
        (d.cacheWrite5mTokens ?? 0) + (d.cacheWrite1hTokens ?? 0),
    cache_read_input_tokens: d.cacheReadTokens ?? 0,
    cache_creation: {
        ephemeral_5m_input_tokens: d.cacheWrite5mTokens ?? 0,
        ephemeral_1h_input_tokens: d.cacheWrite1hTokens ?? 0,
    },
    output_tokens: d.outputTokens,
    ...(d.reasoningTokens !== undefined
        ? { output_tokens_details: { thinking_tokens: d.reasoningTokens } }
        : {}),
    ...(d.webSearchRequests || d.webFetchRequests
        ? {
              server_tool_use: {
                  web_search_requests: d.webSearchRequests ?? 0,
                  web_fetch_requests: d.webFetchRequests ?? 0,
              },
          }
        : {}),
    ...(d.speed ? { speed: d.speed } : {}),
    ...(d.serviceTier ? { service_tier: d.serviceTier } : {}),
    ...(d.iterations
        ? { iterations: d.iterations.map(toAnthropicIteration) }
        : {}),
});

/**
 * A crude `UsageDetails` from a raw numeric usage dict — only used when a
 * result carries no `usageDetails` of its own (test fixtures, hand-rolled
 * driver stubs). Production results always have `usageDetails` set by the
 * driver before the controller sees them.
 */
const usageDetailsFromRawUsage = (
    usage: Record<string, unknown> | undefined,
): UsageDetails => {
    const u = usage ?? {};
    const cacheRead = Number(u.cache_read_input_tokens ?? u.cached_tokens ?? 0);
    return {
        inputTokens: Number(u.input_tokens ?? u.prompt_tokens ?? 0),
        outputTokens: Number(u.output_tokens ?? u.completion_tokens ?? 0),
        ...(cacheRead ? { cacheReadTokens: cacheRead } : {}),
    };
};

// -- non-stream response --------------------------------------------------

/** Server-executed tool result blocks — forwarded as-is, never field-filtered. */
const SERVER_RESULT_BLOCKS = new Set([
    'web_search_tool_result',
    'web_fetch_tool_result',
    'advisor_tool_result',
    'tool_search_tool_result',
]);

const OUTPUT_ALLOWED_NATIVE_BLOCKS = new Set([
    'text',
    'thinking',
    'redacted_thinking',
    'tool_use',
    'server_tool_use',
    'compaction',
    ...SERVER_RESULT_BLOCKS,
]);

const warnedUnknownOutputBlocks = new Set<string>();
const warnUnknownOutputBlockOnce = (type: string): void => {
    if (warnedUnknownOutputBlocks.has(type)) return;
    warnedUnknownOutputBlocks.add(type);
    console.warn(
        `[ai-chat] anthropic route: unknown output block type '${type}', dropping`,
    );
};

const safeParseJson = (s: string): unknown => {
    try {
        return JSON.parse(s);
    } catch {
        return {};
    }
};

const nativeMessageContent = (content: unknown): Record<string, unknown>[] => {
    if (!Array.isArray(content)) return [];
    const out: Record<string, unknown>[] = [];
    for (const block of content) {
        if (!isPlainObject(block) || typeof block.type !== 'string') continue;
        const type = block.type;
        if (!OUTPUT_ALLOWED_NATIVE_BLOCKS.has(type)) {
            warnUnknownOutputBlockOnce(type);
            continue;
        }
        if (type === 'text' && block.text === '') continue; // never emit an empty text block
        if (type === 'compaction') {
            out.push({
                type: 'compaction',
                ...(block.id !== undefined ? { id: block.id } : {}),
                encrypted_content:
                    block.content ?? block.encrypted_content ?? '',
            });
            continue;
        }
        if (type === 'tool_use' && typeof block.input === 'string') {
            out.push({ ...block, input: safeParseJson(block.input) });
            continue;
        }
        out.push(block);
    }
    return out;
};

const extractTextContent = (content: unknown): string => {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';
    return content
        .filter(
            (p): p is Record<string, unknown> =>
                isPlainObject(p) && p.type === 'text',
        )
        .map((p) => String(p.text ?? ''))
        .join('');
};

const openAiShapedContent = (
    result: Record<string, unknown>,
    message: Record<string, unknown>,
): Record<string, unknown>[] => {
    const out: Record<string, unknown>[] = [];
    if (Array.isArray(message.reasoning_details)) {
        for (const detail of message.reasoning_details) {
            if (!isPlainObject(detail)) continue;
            if (detail.type === 'thinking') {
                out.push({
                    type: 'thinking',
                    thinking: detail.thinking ?? '',
                    signature: detail.signature ?? '',
                });
            } else if (detail.type === 'redacted_thinking') {
                out.push({ type: 'redacted_thinking', data: detail.data });
            }
        }
    }
    const text = extractTextContent(message.content);
    if (text) out.push({ type: 'text', text });
    if (Array.isArray(message.tool_calls)) {
        for (const tc of message.tool_calls) {
            if (!isPlainObject(tc)) continue;
            const fn = isPlainObject(tc.function) ? tc.function : {};
            out.push({
                type: 'tool_use',
                id: tc.id,
                name: fn.name ?? '',
                input:
                    typeof fn.arguments === 'string'
                        ? safeParseJson(fn.arguments)
                        : (fn.arguments ?? {}),
            });
        }
    }
    const compaction = result.compaction;
    if (isPlainObject(compaction)) {
        out.push({
            type: 'compaction',
            ...(compaction.id !== undefined ? { id: compaction.id } : {}),
            encrypted_content:
                compaction.encrypted_content ?? compaction.content ?? '',
        });
    }
    return out;
};

/**
 * Non-stream `IChatMessageResult` → the Anthropic message envelope.
 *
 * A native (Claude) result keeps its blocks verbatim, in order, filtered by the
 * output allowlist. A result shaped by an OpenAI-family fallback is rebuilt in
 * a fixed order: reasoning artifacts, then text, then tool calls, then a
 * round-tripped compaction block. Content is `[]`, never a single empty text
 * block, when the assistant produced nothing — a replayed empty text block 400s
 * on Anthropic's own API.
 */
export const toAnthropicMessage = (
    result: IChatMessageResult,
    ids: { id: string; model: string },
): Record<string, unknown> => {
    const message = (result.message ?? {}) as Record<string, unknown>;
    const resultRecord = result as unknown as Record<string, unknown>;
    const content = needsOpenAICoercion(message)
        ? nativeMessageContent(message.content)
        : openAiShapedContent(resultRecord, message);

    const sawToolUse = content.some((b) => b.type === 'tool_use');
    const stopReason =
        result.stopReason ??
        fromFinishReason(result.finish_reason) ??
        (sawToolUse ? 'tool_use' : 'end_turn');

    const usageDetails =
        result.usageDetails ??
        usageDetailsFromRawUsage(
            result.usage as Record<string, unknown> | undefined,
        );

    return {
        id: ids.id,
        type: 'message',
        role: 'assistant',
        content,
        model: ids.model,
        stop_reason: stopReason,
        stop_sequence: result.stopSequence ?? null,
        ...(result.stopDetails ? { stop_details: result.stopDetails } : {}),
        usage: anthropicUsage(usageDetails),
        ...(result.safeguardResults
            ? { safeguard_results: result.safeguardResults }
            : {}),
        ...(result.contextManagement
            ? { context_management: result.contextManagement }
            : {}),
    };
};
