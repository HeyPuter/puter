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
import type { IChatMessageResult } from '../types.js';
import {
    isPostCutoffRelease,
    needsOpenAICoercion,
    normalizeResultToOpenAI,
} from './normalizeToOpenAI.js';

// Pure data transforms — inputs in, shapes out, no mocks needed.

const claudeResult = (
    content: unknown[],
    stop_reason = 'end_turn',
): IChatMessageResult => ({
    message: {
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        model: 'claude-sonnet-5',
        content,
        stop_reason,
        stop_sequence: null,
    },
    usage: { input_tokens: 3, output_tokens: 5 },
    finish_reason: 'stop',
});

// ── isPostCutoffRelease ─────────────────────────────────────────────

describe('isPostCutoffRelease', () => {
    it('is true on the cutoff date and after', () => {
        expect(isPostCutoffRelease('2026-09-01')).toBe(true);
        expect(isPostCutoffRelease('2027-01-15')).toBe(true);
    });

    it('is false before the cutoff', () => {
        expect(isPostCutoffRelease('2026-08-31')).toBe(false);
        expect(isPostCutoffRelease('2025-01-01')).toBe(false);
    });

    it('handles month-precision catalog dates', () => {
        expect(isPostCutoffRelease('2026-09')).toBe(true);
        expect(isPostCutoffRelease('2026-08')).toBe(false);
    });

    it('treats missing or unparseable dates as pre-cutoff', () => {
        expect(isPostCutoffRelease(undefined)).toBe(false);
        expect(isPostCutoffRelease('')).toBe(false);
        expect(isPostCutoffRelease('soon')).toBe(false);
    });
});

// ── needsOpenAICoercion ─────────────────────────────────────────────

describe('needsOpenAICoercion', () => {
    it('flags Anthropic message envelopes and block arrays', () => {
        expect(
            needsOpenAICoercion({ type: 'message', content: 'x' }),
        ).toBe(true);
        expect(
            needsOpenAICoercion({
                role: 'assistant',
                content: [{ type: 'text', text: 'x' }],
            }),
        ).toBe(true);
        // A bare string is not flagged: no provider produces one, so it
        // passes through by reference rather than through a coercion path
        // nothing exercises.
        expect(needsOpenAICoercion('bare string')).toBe(false);
    });

    it('passes OpenAI-shaped messages through', () => {
        expect(
            needsOpenAICoercion({ role: 'assistant', content: 'hello' }),
        ).toBe(false);
        expect(
            needsOpenAICoercion({
                role: 'assistant',
                content: null,
                tool_calls: [],
            }),
        ).toBe(false);
        expect(needsOpenAICoercion(undefined)).toBe(false);
        expect(needsOpenAICoercion(null)).toBe(false);
    });
});

// ── normalizeResultToOpenAI ─────────────────────────────────────────

describe('normalizeResultToOpenAI', () => {
    it('returns an already-OpenAI-shaped result by reference', () => {
        const res: IChatMessageResult = {
            message: { role: 'assistant', content: 'hi', refusal: null },
            usage: { input_tokens: 1, output_tokens: 1 },
            finish_reason: 'stop',
        };
        expect(normalizeResultToOpenAI(res)).toBe(res);
    });

    it('leaves a responses-API-shaped message untouched', () => {
        const res: IChatMessageResult = {
            message: {
                role: 'assistant',
                content: 'text',
                reasoning: null,
                refusal: null,
            },
            usage: { input_tokens: 1, output_tokens: 1 },
            finish_reason: 'stop',
        };
        expect(normalizeResultToOpenAI(res)).toBe(res);
    });

    it('leaves a string-content message with images untouched', () => {
        const res: IChatMessageResult = {
            message: {
                role: 'assistant',
                content: 'here is your image',
                images: [{ type: 'image_url', image_url: { url: 'data:x' } }],
            },
            usage: { input_tokens: 1, output_tokens: 1 },
            finish_reason: 'stop',
        };
        expect(normalizeResultToOpenAI(res)).toBe(res);
    });

    it('joins text blocks into a string content', () => {
        const out = normalizeResultToOpenAI(
            claudeResult([
                { type: 'text', text: 'Hello' },
                { type: 'text', text: ', world' },
            ]),
        );
        expect(out.message).toEqual({
            role: 'assistant',
            content: 'Hello, world',
            refusal: null,
        });
        expect(out.finish_reason).toBe('stop');
    });

    it('passes a bare-string message through untouched', () => {
        // No provider in the repo returns a bare string message. Rather than
        // carry a coercion path nothing exercises, the predicate ignores
        // strings and the result comes back by reference.
        const res = {
            message: 'plain',
            usage: { input_tokens: 1, output_tokens: 1 },
            finish_reason: 'stop',
        };
        expect(normalizeResultToOpenAI(res)).toBe(res);
    });

    it.each([
        ['end_turn', 'stop'],
        ['stop_sequence', 'stop'],
        ['max_tokens', 'length'],
        ['tool_use', 'tool_calls'],
        ['refusal', 'content_filter'],
    ])('maps stop_reason %s to finish_reason %s', (stop_reason, expected) => {
        const out = normalizeResultToOpenAI(
            claudeResult([{ type: 'text', text: 'x' }], stop_reason),
        );
        expect(out.finish_reason).toBe(expected);
    });

    it('passes an unmapped vendor stop_reason through verbatim', () => {
        // `pause_turn` means "continue this turn"; mapping it to `stop` would
        // erase that. Objects/chatresponse.md documents the passthrough.
        const out = normalizeResultToOpenAI(
            claudeResult([{ type: 'text', text: 'x' }], 'pause_turn'),
        );
        expect(out.finish_reason).toBe('pause_turn');
    });

    it('falls back to the existing finish_reason when stop_reason is absent', () => {
        const res = claudeResult([{ type: 'text', text: 'x' }]);
        delete (res.message as Record<string, unknown>).stop_reason;
        expect(normalizeResultToOpenAI(res).finish_reason).toBe('stop');
    });

    it('converts tool_use blocks into OpenAI tool_calls with stringified arguments', () => {
        const out = normalizeResultToOpenAI(
            claudeResult(
                [
                    { type: 'text', text: 'calling' },
                    {
                        type: 'tool_use',
                        id: 'toolu_1',
                        name: 'get_weather',
                        input: { city: 'Paris' },
                    },
                ],
                'tool_use',
            ),
        );
        expect(out.message.content).toBe('calling');
        expect(out.message.tool_calls).toEqual([
            {
                id: 'toolu_1',
                type: 'function',
                function: {
                    name: 'get_weather',
                    arguments: '{"city":"Paris"}',
                },
            },
        ]);
        expect(out.finish_reason).toBe('tool_calls');
    });

    it('uses null content for tool-only turns', () => {
        const out = normalizeResultToOpenAI(
            claudeResult(
                [
                    {
                        type: 'tool_use',
                        id: 'toolu_2',
                        name: 'noop',
                        input: {},
                    },
                ],
                'tool_use',
            ),
        );
        expect(out.message.content).toBeNull();
        expect(out.message.tool_calls).toHaveLength(1);
    });

    it('joins thinking blocks into message.reasoning', () => {
        const out = normalizeResultToOpenAI(
            claudeResult([
                { type: 'thinking', thinking: 'step one. ', signature: 's1' },
                { type: 'thinking', thinking: 'step two.', signature: 's2' },
                { type: 'text', text: 'answer' },
            ]),
        );
        expect(out.message.reasoning).toBe('step one. \n\nstep two.');
        expect(out.message.content).toBe('answer');
    });

    it('preserves thinking blocks verbatim in reasoning_details for replay', () => {
        // Anthropic rejects an extended-thinking continuation whose thinking
        // blocks lost their signature, so the raw blocks have to survive.
        const out = normalizeResultToOpenAI(
            claudeResult([
                { type: 'thinking', thinking: 'step one.', signature: 's1' },
                { type: 'redacted_thinking', data: 'ENC' },
                { type: 'text', text: 'answer' },
            ]),
        );
        expect(out.message.reasoning_details).toEqual([
            { type: 'thinking', thinking: 'step one.', signature: 's1' },
            { type: 'redacted_thinking', data: 'ENC' },
        ]);
    });

    it('omits reasoning_details when there was no reasoning', () => {
        const out = normalizeResultToOpenAI(
            claudeResult([{ type: 'text', text: 'answer' }]),
        );
        expect('reasoning_details' in (out.message as object)).toBe(false);
    });

    it('drops compaction and unknown blocks', () => {
        const out = normalizeResultToOpenAI({
            ...claudeResult([
                { type: 'compaction', content: 'ENC2' },
                { type: 'server_tool_use', id: 'x', name: 'y', input: {} },
                { type: 'text', text: 'visible' },
            ]),
            compaction: { type: 'compaction', encrypted_content: 'ENC2' },
        });
        expect(out.message).toEqual({
            role: 'assistant',
            content: 'visible',
            refusal: null,
        });
        // The top-level compaction artifact survives coercion.
        expect(out.compaction).toEqual({
            type: 'compaction',
            encrypted_content: 'ENC2',
        });
    });

    it('preserves usage untouched', () => {
        const res = claudeResult([{ type: 'text', text: 'x' }]);
        const out = normalizeResultToOpenAI(res);
        expect(out.usage).toBe(res.usage);
    });
});
