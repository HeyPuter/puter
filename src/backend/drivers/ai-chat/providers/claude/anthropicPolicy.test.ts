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

import { describe, expect, it } from 'vitest';
import type { IChatModel } from '../../types.js';
import {
    allowlistedFromHeader,
    applySafeguardsPolicy,
    claudeToolPolicy,
    clampAdvisorMaxTokens,
    clampAdvisorMaxUses,
    clampWebSearchMaxUses,
    combineBetas,
    DEFAULT_SAFEGUARDS_BETA,
    deriveBetas,
    hasExtendedCacheTtl,
    mergeConsecutiveUserTurns,
    partitionSystemMessages,
    priciestModel,
    rejectOrgScopedBlocks,
    resolveAdvisorModel,
    sanitizeCacheControl,
    sanitizeCacheControlsIn,
    validateContextManagementEdits,
    type BetaFeatures,
} from './anthropicPolicy.js';

const models: IChatModel[] = [
    {
        id: 'claude-haiku-4-5-20251001',
        aliases: ['claude-haiku'],
        costs_currency: 'usd-cents',
        costs: { input_tokens: 100, output_tokens: 500 },
        max_tokens: 64000,
    },
    {
        id: 'claude-opus-5-5',
        aliases: ['claude-opus'],
        costs_currency: 'usd-cents',
        costs: { input_tokens: 400, output_tokens: 2000 },
        max_tokens: 128000,
    },
];

const noFeatures: BetaFeatures = {
    usesCompaction: false,
    usesContextManagement: undefined,
    fast: false,
    usesAdvisor: false,
    usesTaskBudget: false,
    thinkingDisplayUpdates: false,
    thinkingBlockBinding: false,
    usesClearAt: false,
    usesDeferredTools: false,
    uses1hTtl: false,
    usesFilesApi: false,
    usesThinking: false,
    usesTools: false,
    usesEffort: false,
    usesOutputFormat: false,
    usesStrictTool: false,
    usesWebSearch: false,
    usesMidConversationSystem: false,
    usesSafeguards: false,
};

// -- cache_control -------------------------------------------------------

describe('sanitizeCacheControl', () => {
    it('rebuilds a plain ephemeral cache_control', () => {
        expect(sanitizeCacheControl({ type: 'ephemeral' })).toEqual({ type: 'ephemeral' });
    });

    it('keeps a 5m or 1h ttl', () => {
        expect(sanitizeCacheControl({ type: 'ephemeral', ttl: '1h' })).toEqual({
            type: 'ephemeral',
            ttl: '1h',
        });
        expect(sanitizeCacheControl({ type: 'ephemeral', ttl: '5m' })).toEqual({
            type: 'ephemeral',
            ttl: '5m',
        });
    });

    it('drops scope and evict_on_complete, and any other unlisted field', () => {
        expect(
            sanitizeCacheControl({
                type: 'ephemeral',
                scope: 'global',
                evict_on_complete: true,
            }),
        ).toEqual({ type: 'ephemeral' });
    });

    it('drops an unrecognized ttl value', () => {
        expect(sanitizeCacheControl({ type: 'ephemeral', ttl: '2h' })).toEqual({
            type: 'ephemeral',
        });
    });

    it('returns undefined for a non-object', () => {
        expect(sanitizeCacheControl(undefined)).toBeUndefined();
        expect(sanitizeCacheControl(null)).toBeUndefined();
    });
});

describe('sanitizeCacheControlsIn', () => {
    it('rebuilds cache_control reachable at any depth, copy-on-write', () => {
        const input = [
            {
                role: 'user',
                content: [
                    { type: 'text', text: 'hi', cache_control: { type: 'ephemeral', scope: 'global' } },
                    {
                        type: 'tool_result',
                        content: [{ type: 'text', text: 'x', cache_control: { type: 'ephemeral', ttl: '1h' } }],
                    },
                ],
            },
        ];
        const out = sanitizeCacheControlsIn(input);
        expect(out).not.toBe(input);
        expect((out[0].content[0] as Record<string, unknown>).cache_control).toEqual({
            type: 'ephemeral',
        });
        expect(
            (out[0].content[1].content[0] as Record<string, unknown>).cache_control,
        ).toEqual({ type: 'ephemeral', ttl: '1h' });
        // Original untouched.
        expect(input[0].content[0].cache_control).toEqual({ type: 'ephemeral', scope: 'global' });
    });

    it('returns the same reference when nothing needs rebuilding', () => {
        const input = [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }];
        expect(sanitizeCacheControlsIn(input)).toBe(input);
    });
});

describe('hasExtendedCacheTtl', () => {
    it('finds a 1h ttl nested anywhere', () => {
        expect(
            hasExtendedCacheTtl({ tools: [{ cache_control: { type: 'ephemeral', ttl: '1h' } }] }),
        ).toBe(true);
    });

    it('is false with no 1h ttl anywhere', () => {
        expect(
            hasExtendedCacheTtl({ tools: [{ cache_control: { type: 'ephemeral', ttl: '5m' } }] }),
        ).toBe(false);
        expect(hasExtendedCacheTtl(undefined)).toBe(false);
    });
});

// -- clamps / advisor resolution ------------------------------------------

describe('clamps', () => {
    it('defaults web search max_uses when absent or non-positive', () => {
        expect(clampWebSearchMaxUses(undefined)).toBe(10);
        expect(clampWebSearchMaxUses(0)).toBe(10);
        expect(clampWebSearchMaxUses(-1)).toBe(10);
    });

    it('caps web search max_uses at 20', () => {
        expect(clampWebSearchMaxUses(100)).toBe(20);
        expect(clampWebSearchMaxUses(5)).toBe(5);
    });

    it('clamps advisor max_uses and max_tokens within their own bounds', () => {
        expect(clampAdvisorMaxUses(undefined)).toBe(3);
        expect(clampAdvisorMaxUses(100)).toBe(10);
        expect(clampAdvisorMaxTokens(undefined)).toBe(16_384);
        expect(clampAdvisorMaxTokens(1_000_000)).toBe(32_768);
    });
});

describe('resolveAdvisorModel / priciestModel', () => {
    it('resolves by id or alias', () => {
        expect(resolveAdvisorModel('claude-haiku-4-5-20251001', models)?.id).toBe(
            'claude-haiku-4-5-20251001',
        );
        expect(resolveAdvisorModel('claude-opus', models)?.id).toBe('claude-opus-5-5');
    });

    it('falls back to the priciest catalog entry when unresolvable', () => {
        expect(resolveAdvisorModel('not-a-real-model', models).id).toBe('claude-opus-5-5');
        expect(resolveAdvisorModel(undefined, models).id).toBe('claude-opus-5-5');
    });

    it('priciestModel picks the highest output_tokens rate', () => {
        expect(priciestModel(models).id).toBe('claude-opus-5-5');
    });
});

describe('rejectOrgScopedBlocks', () => {
    it('throws 400 on a Files API source anywhere in content', () => {
        expect(() =>
            rejectOrgScopedBlocks([
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: 'hi' },
                        {
                            type: 'document',
                            source: { type: 'file', file_id: 'file_x' },
                        },
                    ],
                },
            ]),
        ).toThrowError(expect.objectContaining({ statusCode: 400 }));
    });

    it('passes inline media and plain string content', () => {
        expect(() =>
            rejectOrgScopedBlocks([
                { role: 'user', content: 'hi' },
                {
                    role: 'user',
                    content: [
                        {
                            type: 'image',
                            source: {
                                type: 'base64',
                                media_type: 'image/png',
                                data: 'AA==',
                            },
                        },
                    ],
                },
            ]),
        ).not.toThrow();
        expect(() => rejectOrgScopedBlocks(undefined)).not.toThrow();
    });
});

// -- tool policy -----------------------------------------------------------

describe('claudeToolPolicy', () => {
    it('returns an empty-ish result for undefined tools', () => {
        const r = claudeToolPolicy(undefined, models);
        expect(r.tools).toBeUndefined();
        expect(r.usesWebSearch).toBe(false);
    });

    it('maps a function tool verbatim, carrying Claude-only extras', () => {
        const r = claudeToolPolicy(
            [
                {
                    type: 'function',
                    function: { name: 'lookup', description: 'd', parameters: { type: 'object' } },
                    cache_control: { type: 'ephemeral', scope: 'global' },
                    defer_loading: true,
                },
            ],
            models,
        );
        expect(r.tools).toEqual([
            {
                name: 'lookup',
                description: 'd',
                input_schema: { type: 'object' },
                cache_control: { type: 'ephemeral' },
                defer_loading: true,
            },
        ]);
        expect(r.usesDeferredTools).toBe(true);
    });

    it('throws 400 for a function tool with no function property', () => {
        expect(() => claudeToolPolicy([{ type: 'function' }], models)).toThrowError(
            expect.objectContaining({ statusCode: 400 }),
        );
    });

    it('throws 400 for a non-object tool entry', () => {
        expect(() => claudeToolPolicy([null], models)).toThrowError(
            expect.objectContaining({ statusCode: 400 }),
        );
    });

    it('maps the OpenAI web_search form and clamps max_uses', () => {
        const r = claudeToolPolicy([{ type: 'web_search', max_uses: 999 }], models);
        expect(r.tools).toEqual([
            { type: 'web_search_20250305', name: 'web_search', max_uses: 20 },
        ]);
        expect(r.usesWebSearch).toBe(true);
    });

    it('keeps web_search_20250305 fields and strips search_profile', () => {
        const r = claudeToolPolicy(
            [
                {
                    type: 'web_search_20250305',
                    max_uses: 3,
                    allowed_domains: ['a.com'],
                    search_profile: 'x',
                },
            ],
            models,
        );
        expect(r.tools).toEqual([
            {
                type: 'web_search_20250305',
                name: 'web_search',
                max_uses: 3,
                allowed_domains: ['a.com'],
            },
        ]);
    });

    it('maps a 2026 web_search/web_fetch variant down to the 2025 tool', () => {
        const search = claudeToolPolicy([{ type: 'web_search_20260101', max_uses: 2 }], models);
        expect(search.tools?.[0]).toMatchObject({ type: 'web_search_20250305' });
        const fetch = claudeToolPolicy([{ type: 'web_fetch_20260101', max_uses: 2 }], models);
        expect(fetch.tools?.[0]).toMatchObject({ type: 'web_fetch_20250910' });
        expect(fetch.usesWebFetch).toBe(true);
    });

    it('validates an advisor tool model and clamps its limits', () => {
        const r = claudeToolPolicy(
            [{ type: 'advisor_20260301', model: 'claude-haiku', max_uses: 999, max_tokens: 999_999 }],
            models,
        );
        expect(r.tools).toEqual([
            {
                type: 'advisor_20260301',
                name: 'advisor',
                model: 'claude-haiku-4-5-20251001',
                max_uses: 10,
                max_tokens: 32_768,
            },
        ]);
        expect(r.usesAdvisor).toBe(true);
    });

    it('rejects an advisor tool naming a model outside the catalog', () => {
        expect(() =>
            claudeToolPolicy([{ type: 'advisor_20260301', model: 'not-a-model' }], models),
        ).toThrowError(expect.objectContaining({ statusCode: 400 }));
    });

    it('passes client-executed tools through verbatim', () => {
        const r = claudeToolPolicy([{ type: 'bash_20250124', name: 'bash' }], models);
        expect(r.tools).toEqual([{ type: 'bash_20250124', name: 'bash' }]);
    });

    it('passes tool_search_tool types through and flags deferred tools', () => {
        const r = claudeToolPolicy(
            [{ type: 'tool_search_tool_regex_20251119' }],
            models,
        );
        expect(r.tools).toEqual([{ type: 'tool_search_tool_regex_20251119' }]);
        expect(r.usesDeferredTools).toBe(true);
    });

    it('drops code_execution_* tools silently', () => {
        const r = claudeToolPolicy([{ type: 'code_execution_20250825' }], models);
        expect(r.tools).toEqual([]);
    });

    it('rejects an mcp_toolset tool', () => {
        expect(() => claudeToolPolicy([{ type: 'mcp_toolset' }], models)).toThrowError(
            expect.objectContaining({ statusCode: 400, legacyCode: 'bad_request' }),
        );
    });

    it('drops an unrecognized typed tool silently', () => {
        const r = claudeToolPolicy([{ type: 'made_up_20990101' }], models);
        expect(r.tools).toEqual([]);
    });
});

// -- context_management ------------------------------------------------

describe('validateContextManagementEdits', () => {
    it('accepts known edit types', () => {
        expect(() =>
            validateContextManagementEdits({ edits: [{ type: 'compact_20260112' }] }),
        ).not.toThrow();
        expect(() =>
            validateContextManagementEdits({
                edits: [{ type: 'clear_tool_uses_20250919' }, { type: 'clear_thinking_20251015' }],
            }),
        ).not.toThrow();
    });

    it('rejects an unknown edit type', () => {
        expect(() =>
            validateContextManagementEdits({ edits: [{ type: 'made_up_edit' }] }),
        ).toThrowError(expect.objectContaining({ statusCode: 400 }));
    });

    it('is a no-op for an absent or malformed payload', () => {
        expect(() => validateContextManagementEdits(undefined)).not.toThrow();
        expect(() => validateContextManagementEdits({})).not.toThrow();
    });
});

// -- safeguards -----------------------------------------------------------

describe('applySafeguardsPolicy', () => {
    it('returns undefined when no safeguards are given', () => {
        expect(applySafeguardsPolicy(undefined, [])).toBeUndefined();
        expect(applySafeguardsPolicy([], [])).toBeUndefined();
    });

    it('keeps only well-formed dangerous_tool_use entries', () => {
        const r = applySafeguardsPolicy(
            [
                { type: 'dangerous_tool_use', classifier_context: { a: 1 } },
                { type: 'something_else', classifier_context: {} },
                { type: 'dangerous_tool_use', classifier_context: null },
            ],
            [],
        );
        expect(r?.safeguards).toEqual([
            { type: 'dangerous_tool_use', classifier_context: { a: 1 } },
        ]);
    });

    it('defaults the beta to the pinned version absent a header match', () => {
        const r = applySafeguardsPolicy(
            [{ type: 'dangerous_tool_use', classifier_context: {} }],
            ['oauth-2026'],
        );
        expect(r?.beta).toBe(DEFAULT_SAFEGUARDS_BETA);
    });

    it('uses the header beta when it matches the dated pattern', () => {
        const r = applySafeguardsPolicy(
            [{ type: 'dangerous_tool_use', classifier_context: {} }],
            ['dangerous-tool-use-2025-01-01'],
        );
        expect(r?.beta).toBe('dangerous-tool-use-2025-01-01');
    });

    it('rejects an oversized safeguards payload', () => {
        const huge = 'x'.repeat(600 * 1024);
        expect(() =>
            applySafeguardsPolicy(
                [{ type: 'dangerous_tool_use', classifier_context: { huge } }],
                [],
            ),
        ).toThrowError(expect.objectContaining({ statusCode: 400 }));
    });
});

// -- betas ----------------------------------------------------------------

describe('deriveBetas', () => {
    it('derives nothing for a plain request', () => {
        expect(deriveBetas(noFeatures)).toEqual([]);
    });

    it('derives the compaction beta from either a new edit or history', () => {
        expect(
            deriveBetas({
                ...noFeatures,
                usesContextManagement: { edits: [{ type: 'compact_20260112' }] },
            }),
        ).toContain('compact-2026-01-12');
        expect(deriveBetas({ ...noFeatures, usesCompaction: true })).toContain(
            'compact-2026-01-12',
        );
    });

    it('derives the context-management beta only from a clear edit', () => {
        expect(
            deriveBetas({
                ...noFeatures,
                usesContextManagement: { edits: [{ type: 'clear_tool_uses_20250919' }] },
            }),
        ).toContain('context-management-2025-06-27');
    });

    it('derives one beta per active feature', () => {
        const betas = deriveBetas({
            ...noFeatures,
            fast: true,
            usesAdvisor: true,
            usesTaskBudget: true,
            thinkingDisplayUpdates: true,
            thinkingBlockBinding: true,
            usesClearAt: true,
            usesDeferredTools: true,
            uses1hTtl: true,
            usesFilesApi: true,
        });
        expect(betas).toEqual(
            expect.arrayContaining([
                'fast-mode-2026-02-01',
                'advisor-tool-2026-03-01',
                'task-budgets-2026-03-13',
                'thinking-display-updates-2026-08-18',
                'thinking-binding-controls-2026-08-01',
                'mid-conversation-system-clear-at-2026-08-21',
                'advanced-tool-use-2025-11-20',
                'extended-cache-ttl-2025-04-11',
                'files-api-2025-04-14',
            ]),
        );
    });
});

describe('allowlistedFromHeader', () => {
    it('keeps a gated beta only when its feature is active', () => {
        expect(
            allowlistedFromHeader(['web-search-2025-03-05'], { ...noFeatures, usesWebSearch: true }),
        ).toEqual(['web-search-2025-03-05']);
        expect(
            allowlistedFromHeader(['web-search-2025-03-05'], noFeatures),
        ).toEqual([]);
    });

    it('always keeps thinking-token-count regardless of other features', () => {
        expect(
            allowlistedFromHeader(['thinking-token-count-2026-05-13'], noFeatures),
        ).toEqual(['thinking-token-count-2026-05-13']);
    });

    it('drops unrecognized betas silently, including message-threads', () => {
        expect(
            allowlistedFromHeader(
                ['claude-code-20250219', 'message-threads-2026-08-12', 'oauth-2026'],
                noFeatures,
            ),
        ).toEqual([]);
    });

    it('returns [] for an absent header', () => {
        expect(allowlistedFromHeader(undefined, noFeatures)).toEqual([]);
    });
});

describe('combineBetas', () => {
    it('dedupes across groups while preserving first-seen order', () => {
        expect(combineBetas(['a', 'b'], ['b', 'c'], ['a'])).toEqual(['a', 'b', 'c']);
    });

    it('tolerates undefined groups', () => {
        expect(combineBetas(['a'], undefined)).toEqual(['a']);
    });
});

// -- system messages --------------------------------------------

describe('partitionSystemMessages', () => {
    it('pulls the leading system run into systemBlocks', () => {
        const r = partitionSystemMessages(
            [
                { role: 'system', content: 'be brief' },
                { role: 'user', content: 'hi' },
            ],
            { midConversationSystem: false },
        );
        expect(r.systemBlocks).toEqual([{ type: 'text', text: 'be brief' }]);
        expect(r.messages).toEqual([{ role: 'user', content: 'hi' }]);
    });

    it('concatenates multiple leading system messages in order', () => {
        const r = partitionSystemMessages(
            [
                { role: 'system', content: 'first' },
                { role: 'system', content: 'second' },
                { role: 'user', content: 'hi' },
            ],
            { midConversationSystem: false },
        );
        expect(r.systemBlocks).toEqual([
            { type: 'text', text: 'first' },
            { type: 'text', text: 'second' },
        ]);
    });

    it('puts a leading system message\'s own cache_control on the last combined block', () => {
        const r = partitionSystemMessages(
            [
                { role: 'system', content: 'first' },
                { role: 'system', content: 'second', cache_control: { type: 'ephemeral' } },
                { role: 'user', content: 'hi' },
            ],
            { midConversationSystem: false },
        );
        expect(r.systemBlocks).toEqual([
            { type: 'text', text: 'first' },
            { type: 'text', text: 'second', cache_control: { type: 'ephemeral' } },
        ]);
    });

    it('folds a mid-conversation system message into systemBlocks on an unsupported model', () => {
        const r = partitionSystemMessages(
            [
                { role: 'user', content: 'hi' },
                { role: 'assistant', content: 'hello' },
                { role: 'system', content: 'be careful now' },
                { role: 'user', content: 'continue' },
            ],
            { midConversationSystem: false },
        );
        expect(r.systemBlocks).toEqual([{ type: 'text', text: 'be careful now' }]);
        expect(r.messages).toEqual([
            { role: 'user', content: 'hi' },
            { role: 'assistant', content: 'hello' },
            { role: 'user', content: 'continue' },
        ]);
        expect(r.usesMidConversationSystem).toBe(false);
    });

    it('keeps a mid-conversation system message in place on a supported model', () => {
        const r = partitionSystemMessages(
            [
                { role: 'user', content: 'hi' },
                { role: 'assistant', content: 'hello' },
                { role: 'system', content: 'be careful now', clear_at: 'next_user_message' },
                { role: 'user', content: 'continue' },
            ],
            { midConversationSystem: true },
        );
        expect(r.systemBlocks).toEqual([]);
        expect(r.messages).toEqual([
            { role: 'user', content: 'hi' },
            { role: 'assistant', content: 'hello' },
            {
                role: 'system',
                content: [{ type: 'text', text: 'be careful now' }],
                clear_at: 'next_user_message',
            },
            { role: 'user', content: 'continue' },
        ]);
        expect(r.usesMidConversationSystem).toBe(true);
        expect(r.usesClearAt).toBe(true);
    });

    it('drops an empty mid-conversation system message entirely', () => {
        const r = partitionSystemMessages(
            [
                { role: 'user', content: 'hi' },
                { role: 'system', content: '' },
                { role: 'user', content: 'continue' },
            ],
            { midConversationSystem: true },
        );
        expect(r.messages).toEqual([
            { role: 'user', content: 'hi' },
            { role: 'user', content: 'continue' },
        ]);
    });

    it('does not mutate the input array', () => {
        const input = [
            { role: 'system', content: 'be brief' },
            { role: 'user', content: 'hi' },
        ];
        const before = JSON.parse(JSON.stringify(input));
        partitionSystemMessages(input, { midConversationSystem: false });
        expect(input).toEqual(before);
    });
});

// -- user-turn merging -----------------------------------------------

describe('mergeConsecutiveUserTurns', () => {
    it('merges adjacent user messages in order', () => {
        const out = mergeConsecutiveUserTurns([
            { role: 'user', content: [{ type: 'text', text: 'a' }] },
            { role: 'user', content: [{ type: 'tool_result', tool_use_id: '1', content: 'r' }] },
        ]);
        expect(out).toEqual([
            {
                role: 'user',
                content: [
                    { type: 'text', text: 'a' },
                    { type: 'tool_result', tool_use_id: '1', content: 'r' },
                ],
            },
        ]);
    });

    it('leaves non-adjacent user turns separate', () => {
        const out = mergeConsecutiveUserTurns([
            { role: 'user', content: [{ type: 'text', text: 'a' }] },
            { role: 'assistant', content: [{ type: 'text', text: 'b' }] },
            { role: 'user', content: [{ type: 'text', text: 'c' }] },
        ]);
        expect(out).toHaveLength(3);
    });

    it('does not mutate the input messages', () => {
        const a = { role: 'user', content: [{ type: 'text', text: 'a' }] };
        const b = { role: 'user', content: [{ type: 'text', text: 'b' }] };
        mergeConsecutiveUserTurns([a, b]);
        expect(a.content).toHaveLength(1);
        expect(b.content).toHaveLength(1);
    });
});
