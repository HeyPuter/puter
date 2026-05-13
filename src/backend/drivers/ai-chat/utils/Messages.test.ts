/**
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
// @ts-expect-error — sibling JS module without an adjacent .d.ts
import {
    extract_and_remove_system_messages,
    extract_text,
    normalize_messages,
    normalize_single_message,
} from './Messages.js';

// All four exports are pure data transforms over arrays/objects, so
// these tests just feed inputs and assert on the output shape — no
// service mocks or method spies are needed.

// ── normalize_single_message ────────────────────────────────────────

describe('normalize_single_message', () => {
    it('wraps a string into a single-content user message by default', () => {
        const result = normalize_single_message('hello');
        expect(result.role).toBe('user');
        expect(result.content).toEqual([{ type: 'text', text: 'hello' }]);
    });

    it('honors a caller-supplied default role for string input', () => {
        const result = normalize_single_message('greetings', {
            role: 'system',
        });
        expect(result.role).toBe('system');
    });

    it('throws 400 when message is null/undefined/array', () => {
        expect(() => normalize_single_message(null)).toThrow(
            expect.objectContaining({ statusCode: 400 }),
        );
        expect(() => normalize_single_message(undefined)).toThrow(
            expect.objectContaining({ statusCode: 400 }),
        );
        expect(() => normalize_single_message([])).toThrow(
            expect.objectContaining({ statusCode: 400 }),
        );
    });

    it('throws 400 when no content + no tool_calls (and not a tool message)', () => {
        expect(() =>
            normalize_single_message({ role: 'assistant' }),
        ).toThrow(expect.objectContaining({ statusCode: 400 }));
    });

    it('synthesizes content from tool_calls when content is missing', () => {
        const result = normalize_single_message({
            role: 'assistant',
            tool_calls: [
                {
                    id: 'call_1',
                    function: { name: 'lookup', arguments: { q: 'puter' } },
                },
                {
                    id: 'call_2',
                    function: { name: 'lookup', arguments: { q: 'fs' } },
                },
            ],
        });

        expect(result.tool_calls).toBeUndefined();
        expect(result.content).toEqual([
            {
                type: 'tool_use',
                id: 'call_1',
                name: 'lookup',
                input: { q: 'puter' },
            },
            {
                type: 'tool_use',
                id: 'call_2',
                name: 'lookup',
                input: { q: 'fs' },
            },
        ]);
    });

    it('coerces string tool content into a tool_result block', () => {
        const result = normalize_single_message({
            role: 'tool',
            tool_call_id: 'call_1',
            content: 'tool said hi',
        });
        expect(result.tool_use_id).toBe('call_1');
        expect(result.content).toEqual([
            {
                type: 'tool_result',
                tool_use_id: 'call_1',
                content: 'tool said hi',
            },
        ]);
    });

    it('JSON-serializes non-string tool content', () => {
        const result = normalize_single_message({
            role: 'tool',
            tool_call_id: 'call_1',
            content: { ok: true, data: [1, 2] },
        });
        expect(result.content[0].content).toBe(
            JSON.stringify({ ok: true, data: [1, 2] }),
        );
    });

    it('preserves the existing role when present', () => {
        const result = normalize_single_message(
            { role: 'assistant', content: 'hi' },
            { role: 'system' },
        );
        expect(result.role).toBe('assistant');
    });

    it('upgrades string content blocks into typed text blocks', () => {
        const result = normalize_single_message({
            role: 'user',
            content: ['hello', 'world'],
        });
        expect(result.content).toEqual([
            { type: 'text', text: 'hello' },
            { type: 'text', text: 'world' },
        ]);
    });

    it('infers type=text when only a `text` field is present', () => {
        const result = normalize_single_message({
            role: 'user',
            content: [{ text: 'untyped' }],
        });
        expect(result.content[0].type).toBe('text');
    });

    it('throws 400 when a content item is not a string or object', () => {
        expect(() =>
            normalize_single_message({
                role: 'user',
                content: [42],
            }),
        ).toThrow(expect.objectContaining({ statusCode: 400 }));
    });

    it('strips a stray `text` from tool_use blocks', () => {
        const result = normalize_single_message({
            role: 'assistant',
            content: [
                {
                    type: 'tool_use',
                    id: 'call_1',
                    name: 'lookup',
                    input: {},
                    text: 'should be removed',
                },
            ],
        });
        expect(result.content[0].text).toBeUndefined();
    });
});

// ── normalize_messages ──────────────────────────────────────────────

describe('normalize_messages', () => {
    it('normalizes each entry and merges consecutive same-role text messages', () => {
        const result = normalize_messages([
            'hi',
            'there',
            { role: 'assistant', content: 'hello back' },
            { role: 'assistant', content: 'I can help' },
        ]);

        // Two user text blocks merge; two assistant text blocks merge.
        expect(result).toHaveLength(2);
        expect(result[0].role).toBe('user');
        expect(result[0].content).toEqual([
            { type: 'text', text: 'hi' },
            { type: 'text', text: 'there' },
        ]);
        expect(result[1].role).toBe('assistant');
        expect(result[1].content).toEqual([
            { type: 'text', text: 'hello back' },
            { type: 'text', text: 'I can help' },
        ]);
    });

    it('splits multi-block non-tool messages into one message per block', () => {
        const result = normalize_messages([
            {
                role: 'user',
                content: [
                    { type: 'text', text: 'hello' },
                    { type: 'image_url', image_url: 'https://x/a.png' },
                ],
            },
        ]);
        // After split the two user blocks collapse back into one merged
        // message because both have role='user' and neither is a
        // tool block.
        expect(result).toHaveLength(1);
        expect(result[0].content).toHaveLength(2);
    });

    it('keeps assistant tool_use blocks together (no per-block split)', () => {
        const result = normalize_messages([
            {
                role: 'assistant',
                content: [
                    {
                        type: 'tool_use',
                        id: 'call_1',
                        name: 'lookup',
                        input: { q: 'a' },
                    },
                    {
                        type: 'tool_use',
                        id: 'call_2',
                        name: 'lookup',
                        input: { q: 'b' },
                    },
                ],
            },
        ]);

        expect(result).toHaveLength(1);
        expect(result[0].content).toHaveLength(2);
        // Both tool_use blocks live under the same assistant message
        // so OpenAI's tool-call ordering is preserved on the wire.
        expect(result[0].content[0].id).toBe('call_1');
        expect(result[0].content[1].id).toBe('call_2');
    });

    it('does not merge across tool_use / tool_result boundaries', () => {
        const result = normalize_messages([
            {
                role: 'assistant',
                content: [
                    {
                        type: 'tool_use',
                        id: 'call_1',
                        name: 'lookup',
                        input: {},
                    },
                ],
            },
            {
                role: 'user',
                content: [
                    {
                        type: 'tool_result',
                        tool_use_id: 'call_1',
                        content: 'ok',
                    },
                ],
            },
            { role: 'user', content: 'and another follow-up' },
        ]);
        // tool_use, tool_result, and the trailing user text must remain
        // as separate messages — merging would clobber tool ordering.
        expect(result).toHaveLength(3);
        expect(result[0].content[0].type).toBe('tool_use');
        expect(result[1].content[0].type).toBe('tool_result');
        expect(result[2].content[0]).toEqual({
            type: 'text',
            text: 'and another follow-up',
        });
    });
});

// ── extract_and_remove_system_messages ─────────────────────────────

describe('extract_and_remove_system_messages', () => {
    it('returns [system, non-system] preserving relative order', () => {
        const messages = [
            { role: 'system', content: 'sys-1' },
            { role: 'user', content: 'u-1' },
            { role: 'system', content: 'sys-2' },
            { role: 'assistant', content: 'a-1' },
            { role: 'user', content: 'u-2' },
        ];
        const [systems, others] = extract_and_remove_system_messages(messages);
        expect(systems.map((m: Record<string, unknown>) => m.content)).toEqual([
            'sys-1',
            'sys-2',
        ]);
        expect(others.map((m: Record<string, unknown>) => m.content)).toEqual([
            'u-1',
            'a-1',
            'u-2',
        ]);
    });

    it('returns empty arrays for an empty input', () => {
        const [systems, others] = extract_and_remove_system_messages([]);
        expect(systems).toEqual([]);
        expect(others).toEqual([]);
    });
});

// ── extract_text ────────────────────────────────────────────────────

describe('extract_text', () => {
    it('joins string messages with a single space', () => {
        expect(extract_text(['hello', 'world'])).toBe('hello world');
    });

    it('skips falsy / non-object entries by emitting an empty string', () => {
        // null / array entries collapse to '' and don't crash.
        expect(extract_text([null, undefined, ['nope'], 'kept'])).toBe(
            '   kept',
        );
    });

    it('joins content arrays of {text} blocks with spaces, then space-joins messages', () => {
        const result = extract_text([
            { content: [{ text: 'a' }, { text: 'b' }] },
            { content: [{ text: 'c' }] },
        ]);
        expect(result).toBe('a b c');
    });

    it('passes through messages whose content is a plain string', () => {
        expect(extract_text([{ content: 'plain' }])).toBe('plain');
    });

    it('reads single-block content objects with type=text', () => {
        expect(extract_text([{ content: { type: 'text', text: 'one' } }])).toBe(
            'one',
        );
    });

    it('returns "" for non-text typed single-block content', () => {
        expect(
            extract_text([{ content: { type: 'image_url', image_url: 'x' } }]),
        ).toBe('');
    });

    it('throws 400 when a typed text block has a non-string text field', () => {
        expect(() =>
            extract_text([{ content: { type: 'text', text: 42 } }]),
        ).toThrow(expect.objectContaining({ statusCode: 400 }));
    });
});
