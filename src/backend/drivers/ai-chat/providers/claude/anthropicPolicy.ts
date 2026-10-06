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
 * Anthropic request policy: everything that decides what reaches Claude's wire
 * versus what gets stripped, clamped or rejected. `/drivers/call` reaches
 * `ClaudeProvider.complete` directly with arbitrary args, so this policy has to
 * live on the provider rather than only in the (future) Anthropic route
 * controller — a caller that skips the HTTP route must still hit the same
 * rules.
 */

import { HttpError } from '../../../../core/http/HttpError.js';
import { AI_ADVISOR, AI_WEB_SEARCH_MAX_USES } from '../../../util/aiLimits.js';
import type { CacheControl, IChatModel } from '../../types.js';
import { FILES_API_BETA } from './fileUpload.js';

// -- cache_control ------------------------------------------------------

/**
 * Rebuild a `cache_control` object from only the fields we support. Drops
 * `scope` (needs its own beta) and `evict_on_complete` (ditto) rather than
 * forwarding them unexamined.
 */
export const sanitizeCacheControl = (cc: unknown): CacheControl | undefined => {
    if (!cc || typeof cc !== 'object') return undefined;
    const ttl = (cc as { ttl?: unknown }).ttl;
    return {
        type: 'ephemeral',
        ...(ttl === '5m' || ttl === '1h' ? { ttl } : {}),
    };
};

/**
 * Recursively rebuilds every `cache_control` field reachable from a message's
 * content array through `sanitizeCacheControl`, copy-on-write. Applies to every
 * block, every `tool_result.content[]` item, and nested arrays alike — one walk
 * covers the whole shape instead of each block type needing its own
 * cache_control handling.
 */
export const sanitizeCacheControlsIn = <T>(value: T): T => {
    if (Array.isArray(value)) {
        let changed = false;
        const mapped = value.map((v) => {
            const next = sanitizeCacheControlsIn(v);
            if (next !== v) changed = true;
            return next;
        });
        return (changed ? mapped : value) as T;
    }
    if (!value || typeof value !== 'object') return value;
    const obj = value as Record<string, unknown>;
    let changed = false;
    const next: Record<string, unknown> = { ...obj };
    if ('cache_control' in obj && obj.cache_control) {
        next.cache_control = sanitizeCacheControl(obj.cache_control);
        changed = true;
    }
    for (const [key, v] of Object.entries(obj)) {
        if (key === 'cache_control') continue;
        const mapped = sanitizeCacheControlsIn(v);
        if (mapped !== v) {
            next[key] = mapped;
            changed = true;
        }
    }
    return (changed ? next : value) as T;
};

/** `true` when any `cache_control` reachable from `value` requests a 1h TTL. */
export const hasExtendedCacheTtl = (value: unknown): boolean => {
    if (!value || typeof value !== 'object') return false;
    if (Array.isArray(value)) return value.some(hasExtendedCacheTtl);
    const obj = value as Record<string, unknown>;
    if (obj.type === 'ephemeral' && (obj as { ttl?: unknown }).ttl === '1h') {
        return true;
    }
    return Object.values(obj).some(hasExtendedCacheTtl);
};

// -- tool policy ----------------------------------------------------------

const clamp = (value: unknown, def: number, cap: number): number => {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return def;
    return Math.min(Math.floor(n), cap);
};

export const clampWebSearchMaxUses = (value: unknown): number =>
    clamp(value, AI_WEB_SEARCH_MAX_USES.default, AI_WEB_SEARCH_MAX_USES.cap);

export const clampAdvisorMaxUses = (value: unknown): number =>
    clamp(value, AI_ADVISOR.maxUsesDefault, AI_ADVISOR.maxUsesCap);

export const clampAdvisorMaxTokens = (value: unknown): number =>
    clamp(value, AI_ADVISOR.maxTokensDefault, AI_ADVISOR.maxTokensCap);

/** The model an `advisor_20260301` tool names, resolved by id or alias. */
export const resolveModelByIdOrAlias = (
    models: readonly IChatModel[],
    id: unknown,
): IChatModel | undefined => {
    if (typeof id !== 'string' || !id) return undefined;
    return models.find((m) => [m.id, ...(m.aliases ?? [])].includes(id));
};

/** The most expensive catalog entry — the safe rate for an unresolvable model. */
export const priciestModel = (models: readonly IChatModel[]): IChatModel =>
    models.reduce((max, m) =>
        Number(m.costs?.output_tokens ?? 0) >
        Number(max.costs?.output_tokens ?? 0)
            ? m
            : max,
    );

/** `advisor_20260301.model`, resolved — unknown is priced, never rejected. */
export const resolveAdvisorModel = (
    modelId: string | undefined,
    models: readonly IChatModel[],
): IChatModel =>
    resolveModelByIdOrAlias(models, modelId) ?? priciestModel(models);

const SERVER_TOOL_TYPE = /^[a-z_]+_\d{8}$/;
const WEB_SEARCH_2026 = /^web_search_2026/;
const WEB_FETCH_2026 = /^web_fetch_2026/;
const TOOL_SEARCH_TOOL = /^tool_search_tool_(regex|bm25)_\d{8}$/;
const CLIENT_EXECUTED_TOOL =
    /^(bash|text_editor|memory|computer|computer_toolset)_/;
const CODE_EXECUTION_TOOL = /^code_execution_/;

export interface ToolPolicyResult {
    tools: unknown[] | undefined;
    /**
     * Whether a web_search(_2026)/web_fetch(_2026) tool is present,
     * post-policy.
     */
    usesWebSearch: boolean;
    usesWebFetch: boolean;
    usesAdvisor: boolean;
    /** `defer_loading`/`tool_reference` usage — gates `advanced-tool-use`. */
    usesDeferredTools: boolean;
    /** A function tool declared `strict` — gates `structured-outputs`. */
    usesStrictTool: boolean;
}

/**
 * Map each already-normalized tool to its Anthropic wire shape, enforcing the
 * typed/server-tool allowlist. `tools` have already gone through the shared
 * `normalize_tools_object` (function tools wrapped, server tools passed through
 * verbatim by type).
 */
export const claudeToolPolicy = (
    tools: unknown[] | undefined,
    models: readonly IChatModel[],
): ToolPolicyResult => {
    if (!tools) {
        return {
            tools: undefined,
            usesWebSearch: false,
            usesWebFetch: false,
            usesAdvisor: false,
            usesDeferredTools: false,
            usesStrictTool: false,
        };
    }

    const out: unknown[] = [];
    let usesWebSearch = false;
    let usesWebFetch = false;
    let usesAdvisor = false;
    let usesDeferredTools = false;
    let usesStrictTool = false;

    for (const raw of tools) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
            throw new HttpError(400, 'each tool must be an object', {
                legacyCode: 'bad_request',
            });
        }
        const tool = raw as Record<string, unknown>;
        if (tool.type === 'function') {
            if (!tool.function) {
                throw new HttpError(
                    400,
                    "each tool must have a 'function' property",
                    { legacyCode: 'bad_request' },
                );
            }
            const fn = tool.function as Record<string, unknown>;
            const strict = tool.strict ?? fn.strict;
            if (strict !== undefined) usesStrictTool = true;
            if (tool.defer_loading !== undefined) usesDeferredTools = true;
            out.push({
                name: fn.name,
                description: fn.description,
                input_schema: fn.parameters,
                ...(strict !== undefined ? { strict } : {}),
                ...(tool.cache_control
                    ? {
                          cache_control: sanitizeCacheControl(
                              tool.cache_control,
                          ),
                      }
                    : {}),
                ...(tool.defer_loading !== undefined
                    ? { defer_loading: tool.defer_loading }
                    : {}),
                ...(tool.eager_input_streaming !== undefined
                    ? { eager_input_streaming: tool.eager_input_streaming }
                    : {}),
                ...(tool.input_examples !== undefined
                    ? { input_examples: tool.input_examples }
                    : {}),
            });
            continue;
        }

        const type = typeof tool?.type === 'string' ? tool.type : '';

        if (
            type === 'web_search' ||
            type === 'web_search_20250305' ||
            WEB_SEARCH_2026.test(type)
        ) {
            usesWebSearch = true;
            out.push({
                type: 'web_search_20250305',
                name: 'web_search',
                max_uses: clampWebSearchMaxUses(tool?.max_uses),
                ...(tool?.allowed_domains
                    ? { allowed_domains: tool.allowed_domains }
                    : {}),
                ...(tool?.blocked_domains
                    ? { blocked_domains: tool.blocked_domains }
                    : {}),
                ...(tool?.user_location
                    ? { user_location: tool.user_location }
                    : {}),
                ...(tool?.cache_control
                    ? {
                          cache_control: sanitizeCacheControl(
                              tool.cache_control,
                          ),
                      }
                    : {}),
            });
            continue;
        }

        if (type === 'web_fetch_20250910' || WEB_FETCH_2026.test(type)) {
            usesWebFetch = true;
            out.push({
                type: 'web_fetch_20250910',
                name: 'web_fetch',
                max_uses: clampWebSearchMaxUses(tool?.max_uses),
                ...(tool?.allowed_domains
                    ? { allowed_domains: tool.allowed_domains }
                    : {}),
                ...(tool?.blocked_domains
                    ? { blocked_domains: tool.blocked_domains }
                    : {}),
                ...(tool?.citations ? { citations: tool.citations } : {}),
                ...(tool?.max_content_tokens
                    ? { max_content_tokens: tool.max_content_tokens }
                    : {}),
                ...(tool?.cache_control
                    ? {
                          cache_control: sanitizeCacheControl(
                              tool.cache_control,
                          ),
                      }
                    : {}),
            });
            continue;
        }

        if (type === 'advisor_20260301') {
            const resolved = resolveModelByIdOrAlias(models, tool?.model);
            if (!resolved) {
                throw new HttpError(
                    400,
                    `tools: advisor model ${String(tool?.model)} is not available`,
                    { legacyCode: 'bad_request' },
                );
            }
            usesAdvisor = true;
            out.push({
                type: 'advisor_20260301',
                name: typeof tool.name === 'string' ? tool.name : 'advisor',
                model: resolved.id,
                max_uses: clampAdvisorMaxUses(tool?.max_uses),
                max_tokens: clampAdvisorMaxTokens(tool?.max_tokens),
                ...(tool?.caching !== undefined
                    ? { caching: tool.caching }
                    : {}),
            });
            continue;
        }

        if (type === 'tool_reference') {
            usesDeferredTools = true;
            out.push({ ...tool });
            continue;
        }

        if (TOOL_SEARCH_TOOL.test(type)) {
            usesDeferredTools = true;
            out.push({ ...tool });
            continue;
        }

        if (CLIENT_EXECUTED_TOOL.test(type)) {
            out.push({ ...tool });
            continue;
        }

        // `mcp_toolset` connects to a client-supplied MCP URL with a
        // client-supplied token under our org identity — never accepted.
        if (type === 'mcp_toolset') {
            throw new HttpError(400, 'mcp_servers: not supported', {
                legacyCode: 'bad_request',
            });
        }

        // code_execution_* (needs the sandbox beta we don't offer) and any
        // typed tool we don't recognize are dropped rather than forwarded.
        if (CODE_EXECUTION_TOOL.test(type)) continue;
        if (SERVER_TOOL_TYPE.test(type)) continue; // unknown typed tool

        // Not a `{type:'function'}` wrapper and not a recognized server-tool
        // id shape — drop it the same way rather than forwarding garbage.
    }

    return {
        tools: out,
        usesWebSearch,
        usesWebFetch,
        usesAdvisor,
        usesDeferredTools,
        usesStrictTool,
    };
};

// -- org-scoped content blocks ------------------------------------------------

const isOrgScopedBlock = (
    block: Record<string, unknown>,
): string | undefined => {
    if (block.type === 'container_upload') return 'container_upload';
    const source = block.source as { type?: unknown } | undefined;
    if (
        (block.type === 'image' || block.type === 'document') &&
        source?.type === 'file'
    ) {
        return `file-source ${block.type}`;
    }
    return undefined;
};

const walkContentBlocks = (value: unknown): void => {
    if (Array.isArray(value)) {
        for (const v of value) walkContentBlocks(v);
        return;
    }
    if (!value || typeof value !== 'object') return;
    const block = value as Record<string, unknown>;
    const rejected = isOrgScopedBlock(block);
    if (rejected) {
        throw new HttpError(400, `${rejected} blocks are not supported`, {
            legacyCode: 'bad_request',
        });
    }
    // Tool arguments are data, not content blocks.
    if (block.type === 'tool_use' || block.type === 'server_tool_use') return;
    walkContentBlocks(block.content);
    walkContentBlocks(block.source); // document `source: {type:'content'}`
};

/**
 * Rejects caller blocks that reference org-scoped Anthropic state: Files API
 * `file` sources (ours hold other users' uploads) and container uploads. Runs
 * on the caller's messages, before our own `puter_path` uploads add file
 * sources.
 */
export const rejectOrgScopedBlocks = (messages: unknown): void => {
    if (!Array.isArray(messages)) return;
    for (const m of messages) {
        walkContentBlocks((m as { content?: unknown } | null)?.content);
    }
};

// -- context_management ----------------------------------------------------

const CONTEXT_MANAGEMENT_EDIT_TYPES = new Set([
    'compact_20260112',
    'clear_tool_uses_20250919',
    'clear_thinking_20251015',
]);

/** Validates `context_management.edits[].type` against the allowlist. */
export const validateContextManagementEdits = (
    contextManagement: unknown,
): void => {
    if (!contextManagement || typeof contextManagement !== 'object') return;
    const edits = (contextManagement as { edits?: unknown }).edits;
    if (!Array.isArray(edits)) return;
    for (const edit of edits) {
        const type = (edit as { type?: unknown })?.type;
        if (
            typeof type !== 'string' ||
            !CONTEXT_MANAGEMENT_EDIT_TYPES.has(type)
        ) {
            throw new HttpError(
                400,
                `context_management.edits: unsupported edit type ${String(type)}`,
                { legacyCode: 'bad_request' },
            );
        }
    }
};

const usesClearEdit = (contextManagement: unknown): boolean => {
    if (!contextManagement || typeof contextManagement !== 'object')
        return false;
    const edits = (contextManagement as { edits?: unknown }).edits;
    if (!Array.isArray(edits)) return false;
    return edits.some((e) => {
        const type = (e as { type?: unknown })?.type;
        return (
            type === 'clear_tool_uses_20250919' ||
            type === 'clear_thinking_20251015'
        );
    });
};

const usesCompactEdit = (contextManagement: unknown): boolean => {
    if (!contextManagement || typeof contextManagement !== 'object')
        return false;
    const edits = (contextManagement as { edits?: unknown }).edits;
    if (!Array.isArray(edits)) return false;
    return edits.some(
        (e) => (e as { type?: unknown })?.type === 'compact_20260112',
    );
};

// -- safeguards -------------------------------------------------------------

export const DEFAULT_SAFEGUARDS_BETA = 'dangerous-tool-use-2026-09-03';
const SAFEGUARDS_BETA_PATTERN = /^dangerous-tool-use-\d{4}-\d{2}-\d{2}$/;
const MAX_SAFEGUARDS_BYTES = 512 * 1024;

export interface SafeguardsPolicyResult {
    safeguards:
        | Array<{
              type: 'dangerous_tool_use';
              classifier_context: Record<string, unknown>;
          }>
        | undefined;
    beta: string;
}

/**
 * Keeps `dangerous_tool_use` entries with an object `classifier_context`, drops
 * the rest, and caps the serialized size. The beta is the first header value
 * matching the dated pattern, defaulting to the pinned version.
 */
export const applySafeguardsPolicy = (
    safeguards: unknown,
    headerBetas: readonly string[] | undefined,
): SafeguardsPolicyResult | undefined => {
    if (!Array.isArray(safeguards) || safeguards.length === 0) return undefined;

    const kept = safeguards.filter(
        (
            s,
        ): s is {
            type: 'dangerous_tool_use';
            classifier_context: Record<string, unknown>;
        } =>
            !!s &&
            typeof s === 'object' &&
            (s as { type?: unknown }).type === 'dangerous_tool_use' &&
            !!(s as { classifier_context?: unknown }).classifier_context &&
            typeof (s as { classifier_context?: unknown })
                .classifier_context === 'object',
    );
    if (kept.length === 0) return undefined;

    const serializedSize = Buffer.byteLength(JSON.stringify(kept), 'utf8');
    if (serializedSize > MAX_SAFEGUARDS_BYTES) {
        throw new HttpError(400, 'safeguards: payload too large', {
            legacyCode: 'bad_request',
        });
    }

    const beta =
        headerBetas?.find((b) => SAFEGUARDS_BETA_PATTERN.test(b)) ??
        DEFAULT_SAFEGUARDS_BETA;

    return { safeguards: kept, beta };
};

// -- betas --------------------------------------------------------------

export const BETA = {
    compaction: 'compact-2026-01-12',
    contextManagement: 'context-management-2025-06-27',
    fastMode: 'fast-mode-2026-02-01',
    advisorTool: 'advisor-tool-2026-03-01',
    taskBudgets: 'task-budgets-2026-03-13',
    thinkingDisplayUpdates: 'thinking-display-updates-2026-08-18',
    thinkingBindingControls: 'thinking-binding-controls-2026-08-01',
    midConversationSystemClearAt: 'mid-conversation-system-clear-at-2026-08-21',
    advancedToolUse: 'advanced-tool-use-2025-11-20',
    extendedCacheTtl: 'extended-cache-ttl-2025-04-11',
    filesApi: FILES_API_BETA,
} as const;

export interface BetaFeatures {
    usesCompaction: boolean;
    usesContextManagement: unknown;
    fast: boolean;
    usesAdvisor: boolean;
    usesTaskBudget: boolean;
    thinkingDisplayUpdates: boolean;
    thinkingBlockBinding: boolean;
    usesClearAt: boolean;
    usesDeferredTools: boolean;
    uses1hTtl: boolean;
    usesFilesApi: boolean;
    usesThinking: boolean;
    usesTools: boolean;
    usesEffort: boolean;
    usesOutputFormat: boolean;
    usesStrictTool: boolean;
    usesWebSearch: boolean;
    usesMidConversationSystem: boolean;
    usesSafeguards: boolean;
}

/** Betas the request's own shape requires, independent of the header. */
export const deriveBetas = (f: BetaFeatures): string[] => {
    const betas: string[] = [];
    if (usesCompactEdit(f.usesContextManagement) || f.usesCompaction) {
        betas.push(BETA.compaction);
    }
    if (usesClearEdit(f.usesContextManagement))
        betas.push(BETA.contextManagement);
    if (f.fast) betas.push(BETA.fastMode);
    if (f.usesAdvisor) betas.push(BETA.advisorTool);
    if (f.usesTaskBudget) betas.push(BETA.taskBudgets);
    if (f.thinkingDisplayUpdates) betas.push(BETA.thinkingDisplayUpdates);
    if (f.thinkingBlockBinding) betas.push(BETA.thinkingBindingControls);
    if (f.usesClearAt) betas.push(BETA.midConversationSystemClearAt);
    if (f.usesDeferredTools) betas.push(BETA.advancedToolUse);
    if (f.uses1hTtl) betas.push(BETA.extendedCacheTtl);
    if (f.usesFilesApi) betas.push(BETA.filesApi);
    return betas;
};

interface HeaderBetaRule {
    match: RegExp;
    when: (f: BetaFeatures) => boolean;
}

const HEADER_BETAS: HeaderBetaRule[] = [
    { match: SAFEGUARDS_BETA_PATTERN, when: (f) => f.usesSafeguards },
    {
        match: /^interleaved-thinking-2025-05-14$/,
        when: (f) => f.usesThinking && f.usesTools,
    },
    { match: /^redact-thinking-2026-02-12$/, when: (f) => f.usesThinking },
    { match: /^thinking-token-count-2026-05-13$/, when: () => true },
    {
        match: /^mid-conversation-system-2026-04-07$/,
        when: (f) => f.usesMidConversationSystem,
    },
    { match: /^token-efficient-tools-2025-02-19$/, when: (f) => f.usesTools },
    { match: /^effort-2025-11-24$/, when: (f) => f.usesEffort },
    {
        match: /^structured-outputs-2025-1[12]-1[35]$/,
        when: (f) => f.usesOutputFormat || f.usesStrictTool,
    },
    { match: /^web-search-2025-03-05$/, when: (f) => f.usesWebSearch },
    {
        match: /^(tool-search-tool-2025-10-19|advanced-tool-use-2025-11-20)$/,
        when: (f) => f.usesDeferredTools,
    },
    { match: /^extended-cache-ttl-2025-04-11$/, when: (f) => f.uses1hTtl },
];

/**
 * Header betas allowlisted against the request's own features. Everything else
 * from the header — `claude-code-*`, `oauth-*`, `context-1m-*`, `mcp-*`,
 * `code-execution-*`, `message-threads-*`, and the rest the design names — is
 * dropped silently; their body fields were never forwarded either.
 */
export const allowlistedFromHeader = (
    headerBetas: readonly string[] | undefined,
    f: BetaFeatures,
): string[] => {
    if (!headerBetas?.length) return [];
    return headerBetas.filter((b) =>
        HEADER_BETAS.some((rule) => rule.match.test(b) && rule.when(f)),
    );
};

export const combineBetas = (
    ...groups: Array<string[] | undefined>
): string[] => [...new Set(groups.flatMap((g) => g ?? []))];

// -- system messages --------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMessage = Record<string, any>;

const toTextBlocks = (content: unknown): AnyMessage[] => {
    if (typeof content === 'string') {
        return content ? [{ type: 'text', text: content }] : [];
    }
    if (Array.isArray(content)) {
        return content.map((c) =>
            typeof c === 'string' ? { type: 'text', text: c } : c,
        );
    }
    return content ? [content as AnyMessage] : [];
};

export interface SystemPartition {
    /** Content blocks for the top-level `system` field. */
    systemBlocks: AnyMessage[];
    /**
     * The remaining, non-system messages, mid-conversation system kept or
     * folded.
     */
    messages: AnyMessage[];
    /** Whether a mid-conversation system message was kept in place. */
    usesMidConversationSystem: boolean;
    /** Whether a kept mid-conversation message carried `clear_at`. */
    usesClearAt: boolean;
}

/**
 * Splits `messages` into the leading run of system messages (→ top-level
 * `system`) and everything after. A system message appearing later is kept in
 * place (`{role:'system', ...}`) when the model accepts mid-conversation system
 * messages, or folded into `system` when it doesn't — today's silent drop was a
 * bug.
 */
export const partitionSystemMessages = (
    messages: AnyMessage[],
    { midConversationSystem }: { midConversationSystem: boolean },
): SystemPartition => {
    let i = 0;
    while (i < messages.length && messages[i]?.role === 'system') i++;

    let systemBlocks: AnyMessage[] = [];
    for (const m of messages.slice(0, i)) {
        const blocks = toTextBlocks(m.content);
        if (m.cache_control && blocks.length > 0) {
            // Goes on the *last* block of the combined system array, not
            // every block — spreading it across every leading system message
            // would blow the 4-breakpoint cache_control limit.
            blocks[blocks.length - 1] = {
                ...blocks[blocks.length - 1],
                cache_control: sanitizeCacheControl(m.cache_control),
            };
        }
        systemBlocks = systemBlocks.concat(blocks);
    }

    const out: AnyMessage[] = [];
    let usesMidConversationSystem = false;
    let usesClearAt = false;
    for (const m of messages.slice(i)) {
        if (m?.role !== 'system') {
            out.push(m);
            continue;
        }
        const blocks = toTextBlocks(m.content);
        if (blocks.length === 0) continue; // empty system message: nothing to carry
        if (midConversationSystem) {
            usesMidConversationSystem = true;
            const clearAt =
                m.clear_at === 'next_user_message' ? m.clear_at : undefined;
            if (clearAt) usesClearAt = true;
            out.push({
                role: 'system',
                content: blocks,
                ...(clearAt ? { clear_at: clearAt } : {}),
            });
        } else {
            systemBlocks = systemBlocks.concat(blocks);
        }
    }

    return {
        systemBlocks,
        messages: out,
        usesMidConversationSystem,
        usesClearAt,
    };
};

// -- tool_result ordering --------------------------------------------

/**
 * Concatenates the content of adjacent `role:'user'` messages, in order.
 * `normalize_messages` splits a tool-result turn into one message per result,
 * and the `role:'tool'` → `role:'user'` conversion does likewise — Anthropic is
 * fine with consecutive user turns, but merging keeps the wire shape closest to
 * what a caller would send by hand. Copy-on-write: the driver reuses `messages`
 * across fallback attempts.
 */
export const mergeConsecutiveUserTurns = (
    messages: AnyMessage[],
): AnyMessage[] => {
    const out: AnyMessage[] = [];
    for (const m of messages) {
        const prev = out[out.length - 1];
        if (
            m?.role === 'user' &&
            prev?.role === 'user' &&
            Array.isArray(prev.content) &&
            Array.isArray(m.content)
        ) {
            out[out.length - 1] = {
                ...prev,
                content: [...prev.content, ...m.content],
            };
        } else {
            out.push(m);
        }
    }
    return out;
};
