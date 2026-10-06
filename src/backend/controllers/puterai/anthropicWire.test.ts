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
import type { IChatMessageResult } from '../../drivers/ai-chat/types.js';
import {
    anthropicUsage,
    parseAnthropicRequest,
    parseBetaHeader,
    systemToMessages,
    toAnthropicMessage,
    validateMessages,
} from './anthropicWire.js';

describe('systemToMessages', () => {
    it('wraps a string system prompt as a single text block', () => {
        expect(systemToMessages('be helpful')).toEqual([
            { role: 'system', content: [{ type: 'text', text: 'be helpful' }] },
        ]);
    });

    it('returns nothing for an empty string', () => {
        expect(systemToMessages('')).toEqual([]);
    });

    it('keeps every array block in order on one leading system message', () => {
        expect(
            systemToMessages([
                { type: 'text', text: 'first' },
                { type: 'text', text: 'second' },
            ]),
        ).toEqual([
            {
                role: 'system',
                content: [
                    { type: 'text', text: 'first' },
                    { type: 'text', text: 'second' },
                ],
            },
        ]);
    });

    it('sanitizes cache_control and keeps citations on a system block', () => {
        const out = systemToMessages([
            {
                type: 'text',
                text: 'cached',
                cache_control: { type: 'ephemeral', ttl: '1h', scope: 'global' },
                citations: [{ type: 'char_location' }],
            },
        ]);
        expect(out[0]!.content).toEqual([
            {
                type: 'text',
                text: 'cached',
                cache_control: { type: 'ephemeral', ttl: '1h' },
                citations: [{ type: 'char_location' }],
            },
        ]);
    });

    it('never merges the first block with later ones — an isolated attribution header stays isolated', () => {
        const header =
            'x-anthropic-billing-header: cc_version=2.1.289; cc_entrypoint=cli;';
        const out = systemToMessages([
            { type: 'text', text: header },
            { type: 'text', text: 'You are a coding agent.' },
        ]);
        expect(out).toEqual([
            {
                role: 'system',
                content: [
                    { type: 'text', text: header },
                    { type: 'text', text: 'You are a coding agent.' },
                ],
            },
        ]);
    });

    it('rejects a non-text block with the exact message, including its index', () => {
        expect(() =>
            systemToMessages([{ type: 'text', text: 'ok' }, { type: 'image' }]),
        ).toThrowError('system.1: unsupported block type');
    });

    it('ignores a non-string, non-array system value', () => {
        expect(systemToMessages({ unexpected: 'shape' })).toEqual([]);
    });

    it('returns nothing for an empty array', () => {
        expect(systemToMessages([])).toEqual([]);
    });
});

describe('validateMessages', () => {
    it('drops non-object top-level entries, keeps the rest', () => {
        expect(
            validateMessages([null, 'nope', { role: 'user', content: 'hi' }]),
        ).toEqual([{ role: 'user', content: 'hi' }]);
    });

    it('passes tool_result blocks through unchanged — no hoisting', () => {
        const message = {
            role: 'user',
            content: [
                {
                    type: 'tool_result',
                    tool_use_id: 'tu_1',
                    content: [{ type: 'text', text: 'ok' }],
                },
            ],
        };
        expect(validateMessages([message])).toEqual([message]);
    });

    it('rejects an unknown block type', () => {
        expect(() =>
            validateMessages([
                { role: 'user', content: [{ type: 'bogus' }] },
            ]),
        ).toThrowError('messages.0.content.0: unsupported block type');
    });

    it('rejects an empty text block', () => {
        expect(() =>
            validateMessages([
                { role: 'user', content: [{ type: 'text', text: '' }] },
            ]),
        ).toThrowError('text content blocks must be non-empty');
    });

    it('rejects a file-source image block', () => {
        expect(() =>
            validateMessages([
                {
                    role: 'user',
                    content: [
                        { type: 'image', source: { type: 'file', file_id: 'f1' } },
                    ],
                },
            ]),
        ).toThrowError('file-source image blocks are not supported');
    });

    it('rejects a file-source document block', () => {
        expect(() =>
            validateMessages([
                {
                    role: 'user',
                    content: [
                        {
                            type: 'document',
                            source: { type: 'file', file_id: 'f1' },
                        },
                    ],
                },
            ]),
        ).toThrowError('file-source document blocks are not supported');
    });

    it('rejects a container_upload block', () => {
        expect(() =>
            validateMessages([
                { role: 'user', content: [{ type: 'container_upload' }] },
            ]),
        ).toThrowError('unsupported block type');
    });

    it('allows a base64/url-sourced image block', () => {
        const message = {
            role: 'user',
            content: [
                {
                    type: 'image',
                    source: { type: 'base64', media_type: 'image/png', data: 'AA' },
                },
            ],
        };
        expect(validateMessages([message])).toEqual([message]);
    });

    it('validates nested blocks inside a tool_result content array', () => {
        expect(() =>
            validateMessages([
                {
                    role: 'user',
                    content: [
                        {
                            type: 'tool_result',
                            tool_use_id: 'tu_1',
                            content: [{ bogus: true }],
                        },
                    ],
                },
            ]),
        ).toThrowError(
            'messages.0.content.0.content.0: unsupported block type',
        );
    });

    it('allows an OpenAI Responses input_image block — rewritten downstream', () => {
        const message = {
            role: 'user',
            content: [
                { type: 'input_image', image_url: 'https://x/img.png' },
            ],
        };
        expect(validateMessages([message])).toEqual([message]);
    });

    it('allows a video_url block, typed or untyped — rewritten downstream', () => {
        const typed = {
            role: 'user',
            content: [
                { type: 'video_url', video_url: { url: 'https://x/v.mp4' } },
            ],
        };
        const untyped = {
            role: 'user',
            content: [{ video_url: 'https://x/v.mp4' }],
        };
        expect(validateMessages([typed])).toEqual([typed]);
        expect(validateMessages([untyped])).toEqual([untyped]);
    });

    it('allows an untyped image_url block — OpenAI Chat\'s untyped shape', () => {
        const message = {
            role: 'user',
            content: [{ image_url: 'https://x/img.png' }],
        };
        expect(validateMessages([message])).toEqual([message]);
    });

    it('still rejects a block with no type and no recognized media shape', () => {
        expect(() =>
            validateMessages([
                { role: 'user', content: [{ bogus: true }] },
            ]),
        ).toThrowError('messages.0.content.0: unsupported block type');
    });

    it('allows an internal puter_path part with no type', () => {
        const message = {
            role: 'user',
            content: [{ puter_path: '/a/b.png' }],
        };
        expect(validateMessages([message])).toEqual([message]);
    });
});

describe('parseBetaHeader', () => {
    it('comma-splits, trims and dedupes', () => {
        expect(parseBetaHeader(' a , b,a ,c')).toEqual(['a', 'b', 'c']);
    });

    it('joins a repeated header value before splitting', () => {
        expect(parseBetaHeader(['a', 'b'])).toEqual(['a', 'b']);
    });

    it('returns [] for an absent or empty header', () => {
        expect(parseBetaHeader(undefined)).toEqual([]);
        expect(parseBetaHeader('')).toEqual([]);
    });
});

describe('parseAnthropicRequest', () => {
    const headers = {};

    it('rejects a body with no messages array', () => {
        expect(() => parseAnthropicRequest({}, headers)).toThrowError(
            'messages: Field required',
        );
    });

    it('parses successfully with mcp_servers present, and drops it from the result', () => {
        const result = parseAnthropicRequest(
            { messages: [], mcp_servers: [{ type: 'url', url: 'x' }] },
            headers,
        );
        expect('mcp_servers' in result).toBe(false);
    });

    it('rejects a body.thread with the exact Unexpected-value(s) message', () => {
        expect(() =>
            parseAnthropicRequest(
                { messages: [], thread: { type: 'create' } },
                headers,
            ),
        ).toThrowError(
            'Unexpected value(s) `message-threads-2026-08-12` for the `anthropic-beta` header. Please try again without the header.',
        );
    });

    it('rejects a message-threads anthropic-beta header, naming the header value', () => {
        expect(() =>
            parseAnthropicRequest(
                { messages: [] },
                { 'anthropic-beta': 'message-threads-2099-01-01' },
            ),
        ).toThrowError(
            'Unexpected value(s) `message-threads-2099-01-01` for the `anthropic-beta` header',
        );
    });

    it('defaults temperature to 1 and provider to claude', () => {
        const args = parseAnthropicRequest({ messages: [] }, headers);
        expect(args.temperature).toBe(1);
        expect(args.provider).toBe('claude');
        expect(args.normalize).toBe(false);
        expect(args.streamToolInput).toBe(true);
    });

    it('maps thinking, tool_choice, stop_sequences, top_p/top_k', () => {
        const args = parseAnthropicRequest(
            {
                messages: [],
                thinking: { type: 'enabled', budget_tokens: 2048 },
                tool_choice: { type: 'tool', name: 'Bash', disable_parallel_tool_use: true },
                stop_sequences: ['STOP'],
                top_p: 0.5,
                top_k: 10,
            },
            headers,
        );
        expect(args.thinking).toEqual({ type: 'enabled', budgetTokens: 2048 });
        expect(args.tool_choice).toEqual({ type: 'tool', name: 'Bash' });
        expect(args.parallel_tool_calls).toBe(false);
        expect(args.stopSequences).toEqual(['STOP']);
        expect(args.top_p).toBe(0.5);
        expect(args.topK).toBe(10);
    });

    it('defaults parallel_tool_calls to true when disable_parallel_tool_use is absent', () => {
        const args = parseAnthropicRequest(
            { messages: [], tool_choice: { type: 'auto' } },
            headers,
        );
        expect(args.parallel_tool_calls).toBe(true);
    });

    it('thinking:null → no thinking field is sent (absent thinking stays null, not legacy-derived)', () => {
        const args = parseAnthropicRequest({ messages: [] }, headers);
        expect(args.thinking).toBeNull();
    });

    it('maps output_config to reasoning_effort/outputFormat/taskBudget', () => {
        const args = parseAnthropicRequest(
            {
                messages: [],
                output_config: {
                    effort: 'high',
                    format: { type: 'json_schema', schema: { type: 'object' } },
                    task_budget: { total: 100, remaining: 40 },
                },
            },
            headers,
        );
        expect(args.reasoning_effort).toBe('high');
        expect(args.outputFormat).toEqual({
            type: 'json_schema',
            schema: { type: 'object' },
        });
        expect(args.taskBudget).toEqual({ total: 100, remaining: 40 });
    });

    it('rejects a malformed compaction shape', () => {
        expect(() =>
            parseAnthropicRequest({ messages: [], compaction: 'yes' }, headers),
        ).toThrowError('compaction: must be a boolean or { trigger_tokens }');
    });

    it('forwards safeguards, speed, cache_control and anthropicBetas', () => {
        const args = parseAnthropicRequest(
            {
                messages: [],
                safeguards: [{ type: 'dangerous_tool_use', classifier_context: {} }],
                speed: 'fast',
                cache_control: { type: 'ephemeral', ttl: '5m' },
            },
            { 'anthropic-beta': 'interleaved-thinking-2025-05-14' },
        );
        expect(args.safeguards).toHaveLength(1);
        expect(args.speed).toBe('fast');
        expect(args.cacheControl).toEqual({ type: 'ephemeral', ttl: '5m' });
        expect(args.anthropicBetas).toEqual(['interleaved-thinking-2025-05-14']);
    });

    it('count_tokens mode never streams, even if the body asks for it', () => {
        const args = parseAnthropicRequest(
            { messages: [], stream: true },
            headers,
            { countTokens: true },
        );
        expect(args.stream).toBe(false);
    });

    it('prepends the system message, in order, ahead of validated messages', () => {
        const args = parseAnthropicRequest(
            {
                messages: [{ role: 'user', content: 'hi' }],
                system: 'be helpful',
            },
            headers,
        );
        expect(args.messages).toEqual([
            { role: 'system', content: [{ type: 'text', text: 'be helpful' }] },
            { role: 'user', content: 'hi' },
        ]);
    });
});

describe('anthropicUsage', () => {
    it('builds the full usage shape from UsageDetails', () => {
        expect(
            anthropicUsage({
                inputTokens: 10,
                outputTokens: 5,
                cacheReadTokens: 2,
                cacheWrite5mTokens: 3,
                cacheWrite1hTokens: 4,
                reasoningTokens: 1,
                webSearchRequests: 1,
                speed: 'fast',
                serviceTier: 'standard',
            }),
        ).toEqual({
            input_tokens: 10,
            cache_creation_input_tokens: 7,
            cache_read_input_tokens: 2,
            cache_creation: {
                ephemeral_5m_input_tokens: 3,
                ephemeral_1h_input_tokens: 4,
            },
            output_tokens: 5,
            output_tokens_details: { thinking_tokens: 1 },
            server_tool_use: { web_search_requests: 1, web_fetch_requests: 0 },
            speed: 'fast',
            service_tier: 'standard',
        });
    });

    it('omits optional keys when the detail is absent', () => {
        expect(anthropicUsage({ inputTokens: 1, outputTokens: 2 })).toEqual({
            input_tokens: 1,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
            cache_creation: {
                ephemeral_5m_input_tokens: 0,
                ephemeral_1h_input_tokens: 0,
            },
            output_tokens: 2,
        });
    });

    it('writes every iteration with all four token counts (what Claude Code trusts)', () => {
        const usage = anthropicUsage({
            inputTokens: 30,
            outputTokens: 6,
            iterations: [
                { type: 'message', inputTokens: 10, outputTokens: 2 },
                {
                    type: 'advisor_message',
                    model: 'claude-opus-4-8',
                    inputTokens: 20,
                    outputTokens: 4,
                    cacheReadTokens: 1,
                    cacheWrite1hTokens: 3,
                },
            ],
        });
        expect(usage.iterations).toEqual([
            {
                type: 'message',
                input_tokens: 10,
                output_tokens: 2,
                cache_read_input_tokens: 0,
                cache_creation_input_tokens: 0,
                cache_creation: {
                    ephemeral_5m_input_tokens: 0,
                    ephemeral_1h_input_tokens: 0,
                },
            },
            {
                type: 'advisor_message',
                model: 'claude-opus-4-8',
                input_tokens: 20,
                output_tokens: 4,
                cache_read_input_tokens: 1,
                cache_creation_input_tokens: 3,
                cache_creation: {
                    ephemeral_5m_input_tokens: 0,
                    ephemeral_1h_input_tokens: 3,
                },
            },
        ]);
    });
});

describe('toAnthropicMessage', () => {
    const ids = { id: 'msg_1', model: 'claude-test' };

    it('keeps native blocks verbatim, in order (no reordering)', () => {
        const result = {
            message: {
                type: 'message',
                content: [
                    { type: 'tool_use', id: 't1', name: 'a', input: {} },
                    { type: 'text', text: 'trailing' },
                ],
            },
            stopReason: 'tool_use',
            stopSequence: null,
            usageDetails: { inputTokens: 1, outputTokens: 2 },
        } as unknown as IChatMessageResult;
        const out = toAnthropicMessage(result, ids);
        expect(out.content).toEqual([
            { type: 'tool_use', id: 't1', name: 'a', input: {} },
            { type: 'text', text: 'trailing' },
        ]);
        expect(out.stop_reason).toBe('tool_use');
    });

    it('drops an empty native text block and returns [] when nothing survives', () => {
        const result = {
            message: { type: 'message', content: [{ type: 'text', text: '' }] },
        } as unknown as IChatMessageResult;
        expect(toAnthropicMessage(result, ids).content).toEqual([]);
    });

    it('drops an unrecognized native block type with a warn, not a throw', () => {
        const result = {
            message: {
                type: 'message',
                content: [
                    { type: 'container_upload' },
                    { type: 'text', text: 'hi' },
                ],
            },
        } as unknown as IChatMessageResult;
        expect(toAnthropicMessage(result, ids).content).toEqual([
            { type: 'text', text: 'hi' },
        ]);
    });

    it('parses a stringified tool_use input on a native block', () => {
        const result = {
            message: {
                type: 'message',
                content: [
                    { type: 'tool_use', id: 't1', name: 'a', input: '{"x":1}' },
                ],
            },
        } as unknown as IChatMessageResult;
        expect(toAnthropicMessage(result, ids).content).toEqual([
            { type: 'tool_use', id: 't1', name: 'a', input: { x: 1 } },
        ]);
    });

    it('keeps a native compaction block, renaming content to encrypted_content', () => {
        const result = {
            message: {
                type: 'message',
                content: [{ type: 'compaction', id: 'c1', content: 'ENC' }],
            },
        } as unknown as IChatMessageResult;
        expect(toAnthropicMessage(result, ids).content).toEqual([
            { type: 'compaction', id: 'c1', encrypted_content: 'ENC' },
        ]);
    });

    it('OpenAI-shaped: orders reasoning details, then text, then tool_calls, then compaction', () => {
        const result = {
            message: {
                content: 'hello',
                reasoning_details: [
                    { type: 'thinking', thinking: 't', signature: 's' },
                    { type: 'redacted_thinking', data: 'd' },
                ],
                tool_calls: [
                    { id: 'c1', function: { name: 'f', arguments: '{"a":1}' } },
                ],
            },
            compaction: { id: 'cm1', encrypted_content: 'ENC' },
        } as unknown as IChatMessageResult;
        expect(toAnthropicMessage(result, ids).content).toEqual([
            { type: 'thinking', thinking: 't', signature: 's' },
            { type: 'redacted_thinking', data: 'd' },
            { type: 'text', text: 'hello' },
            { type: 'tool_use', id: 'c1', name: 'f', input: { a: 1 } },
            { type: 'compaction', id: 'cm1', encrypted_content: 'ENC' },
        ]);
    });

    it('includes safeguard_results and context_management only when present', () => {
        const withBoth = toAnthropicMessage(
            {
                message: { type: 'message', content: [] },
                safeguardResults: [{ type: 'dangerous_tool_use' }],
                contextManagement: { applied_edits: [] },
            } as unknown as IChatMessageResult,
            ids,
        );
        expect(withBoth.safeguard_results).toEqual([
            { type: 'dangerous_tool_use' },
        ]);
        expect(withBoth.context_management).toEqual({ applied_edits: [] });

        const withNeither = toAnthropicMessage(
            { message: { type: 'message', content: [] } } as unknown as IChatMessageResult,
            ids,
        );
        expect(withNeither).not.toHaveProperty('safeguard_results');
        expect(withNeither).not.toHaveProperty('context_management');
    });

    it('never includes container', () => {
        const result = {
            message: { type: 'message', content: [], container: { id: 'x' } },
        } as unknown as IChatMessageResult;
        expect(toAnthropicMessage(result, ids)).not.toHaveProperty('container');
    });
});
