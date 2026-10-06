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

import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
// @ts-expect-error — sibling JS module without an adjacent .d.ts
import Streaming, {
    AIChatMessageStream,
    AIChatStream,
    AIChatTextStream,
    AIChatToolUseStream,
    ChatStreamAbortedError,
} from './Streaming.js';

// AIChatStream + friends emit newline-delimited JSON to an underlying
// Writable. Tests run them against a real buffering Writable and parse
// the captured chunks back, so assertions read the live wire shape —
// no method-level spies on the stream classes.

const makeHarness = () => {
    const chunks: string[] = [];
    let ended = false;
    const sink = new Writable({
        write(chunk, _enc, cb) {
            chunks.push(chunk.toString('utf8'));
            cb();
        },
        final(cb) {
            ended = true;
            cb();
        },
    });
    const chatStream = new AIChatStream({ stream: sink });
    return {
        chatStream,
        sink,
        rawChunks: () => chunks.slice(),
        events: () =>
            chunks
                .join('')
                .split('\n')
                .filter(Boolean)
                .map((line) => JSON.parse(line)),
        isEnded: () => ended,
    };
};

// ── AIChatStream ────────────────────────────────────────────────────

describe('AIChatStream', () => {
    it('exposes a Streaming default with AIChatStream attached', () => {
        expect(Streaming.AIChatStream).toBe(AIChatStream);
    });

    it('writes a `usage` event and ends the underlying stream on .end()', () => {
        const h = makeHarness();
        h.chatStream.end({ tokens: 42 });
        const events = h.events();
        expect(events).toEqual([
            { type: 'usage', usage: { tokens: 42 } },
        ]);
        expect(h.isEnded()).toBe(true);
    });

    it('forwards .write(...) calls straight to the underlying stream', () => {
        const h = makeHarness();
        h.chatStream.write('raw chunk\n');
        // .write is a passthrough — the raw bytes hit the sink without
        // being wrapped in an event envelope.
        expect(h.rawChunks()).toEqual(['raw chunk\n']);
    });

    it('returns a fresh AIChatMessageStream from .message()', () => {
        const h = makeHarness();
        const m = h.chatStream.message();
        expect(m).toBeInstanceOf(AIChatMessageStream);
    });

    it('carries extra fields on the `usage` event', () => {
        const h = makeHarness();
        h.chatStream.end({ tokens: 1 }, { metadata: { usage_limited: true } });
        expect(h.events()).toEqual([
            {
                type: 'usage',
                usage: { tokens: 1 },
                metadata: { usage_limited: true },
            },
        ]);
    });
});

// -- Stop / usage-detail / context-management chunk writers ---------

describe('AIChatStream stop + usage-detail reporting', () => {
    it('merges a stored stop into the usage line, deriving finish_reason', () => {
        const h = makeHarness();
        h.chatStream.setStop({ reason: 'tool_use', sequence: null });
        h.chatStream.end({ tokens: 1 });

        expect(h.events()).toEqual([
            {
                type: 'usage',
                usage: { tokens: 1 },
                stopReason: 'tool_use',
                stopSequence: null,
                stopDetails: null,
                finish_reason: 'tool_calls',
            },
        ]);
    });

    it('carries usageDetails and contextManagement on the usage line', () => {
        const h = makeHarness();
        h.chatStream.setUsageDetails({ inputTokens: 3, outputTokens: 4 });
        h.chatStream.setContextManagement({ applied_edits: ['x'] });
        h.chatStream.end({ tokens: 7 });

        const [event] = h.events();
        expect(event.usageDetails).toEqual({ inputTokens: 3, outputTokens: 4 });
        expect(event.contextManagement).toEqual({ applied_edits: ['x'] });
    });

    it('never writes usageCosts to the wire, though it reads back off the stream', () => {
        const h = makeHarness();
        h.chatStream.setUsageCosts({ input_tokens: 123 });
        h.chatStream.end({ tokens: 1 });

        expect(h.chatStream.usageCosts).toEqual({ input_tokens: 123 });
        const [event] = h.events();
        expect(event).not.toHaveProperty('usageCosts');
    });

    it('lets `extra` override the stored stop fields', () => {
        const h = makeHarness();
        h.chatStream.setStop({ reason: 'end_turn' });
        h.chatStream.end({ tokens: 1 }, { metadata: { usage_limited: true } });

        expect(h.events()).toEqual([
            {
                type: 'usage',
                usage: { tokens: 1 },
                stopReason: 'end_turn',
                stopSequence: null,
                stopDetails: null,
                finish_reason: 'stop',
                metadata: { usage_limited: true },
            },
        ]);
    });

    it('writes reasoningStart, reasoningDetail, serverTool and safeguardResults chunks verbatim', () => {
        const h = makeHarness();
        h.chatStream.reasoningStart('anthropic');
        h.chatStream.reasoningDetail({ type: 'thinking', thinking: 't', signature: 's' });
        h.chatStream.serverTool({ type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search' });
        h.chatStream.safeguardResults([{ type: 'dangerous_tool_use', status: {} }]);

        expect(h.events()).toEqual([
            { type: 'reasoning_start', format: 'anthropic' },
            {
                type: 'reasoning_detail',
                detail: { type: 'thinking', thinking: 't', signature: 's' },
            },
            {
                type: 'server_tool',
                block: { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search' },
            },
            {
                type: 'safeguard_results',
                results: [{ type: 'dangerous_tool_use', status: {} }],
            },
        ]);
    });
});

// ── Abort ──────────────────────────────────────────────────────────

describe('AIChatStream.abort', () => {
    it('throws into the next text, reasoning or tool-call write', () => {
        const h = makeHarness();
        const text = h.chatStream.message().contentBlock({ type: 'text' });
        const tool = h.chatStream
            .message()
            .contentBlock({ type: 'tool_use', id: 't', name: 'f' });
        h.chatStream.abort();
        expect(() => text.addText('x')).toThrow(ChatStreamAbortedError);
        expect(() => text.addReasoning('x')).toThrow(ChatStreamAbortedError);
        expect(() => tool.addPartialJSON('{')).toThrow(ChatStreamAbortedError);
        expect(() => h.chatStream.write('raw')).toThrow(ChatStreamAbortedError);
        expect(h.rawChunks()).toEqual([]);
    });

    it('still records usage and ends the stream, writing nothing', () => {
        const h = makeHarness();
        h.chatStream.abort();
        h.chatStream.end({ output_tokens: 3 });
        expect(h.chatStream.reportedUsage).toEqual({ output_tokens: 3 });
        expect(h.rawChunks()).toEqual([]);
        expect(h.isEnded()).toBe(true);
    });
});

// ── AIChatMessageStream / AIChatTextStream ─────────────────────────

describe('AIChatTextStream (via message().contentBlock)', () => {
    it('emits a text event for addText with no extra_content', () => {
        const h = makeHarness();
        const block = h.chatStream.message().contentBlock({ type: 'text' });
        block.addText('hello');
        expect(h.events()).toEqual([{ type: 'text', text: 'hello' }]);
    });

    it('attaches extra_content when provided', () => {
        const h = makeHarness();
        const block = h.chatStream.message().contentBlock({ type: 'text' });
        block.addText('hello', { meta: 1 });
        expect(h.events()).toEqual([
            { type: 'text', text: 'hello', extra_content: { meta: 1 } },
        ]);
    });

    it('emits a separate reasoning event from addReasoning', () => {
        const h = makeHarness();
        const block = h.chatStream.message().contentBlock({ type: 'text' });
        block.addReasoning('thinking…');
        expect(h.events()).toEqual([
            { type: 'reasoning', reasoning: 'thinking…' },
        ]);
    });

    it('emits an extra_content event from addExtraContent', () => {
        const h = makeHarness();
        const block = h.chatStream.message().contentBlock({ type: 'text' });
        block.addExtraContent({ tag: 'gemini-meta' });
        expect(h.events()).toEqual([
            { type: 'extra_content', extra_content: { tag: 'gemini-meta' } },
        ]);
    });

    it('exposes AIChatTextStream as the constructor for type=text', () => {
        const h = makeHarness();
        const block = h.chatStream.message().contentBlock({ type: 'text' });
        expect(block).toBeInstanceOf(AIChatTextStream);
    });
});

// ── AIChatToolUseStream ────────────────────────────────────────────

describe('AIChatToolUseStream (via message().contentBlock)', () => {
    it('exposes AIChatToolUseStream as the constructor for type=tool_use', () => {
        const h = makeHarness();
        const block = h.chatStream
            .message()
            .contentBlock({ type: 'tool_use', id: 'call_1', name: 'lookup' });
        expect(block).toBeInstanceOf(AIChatToolUseStream);
    });

    it('parses buffered partial JSON arguments on .end()', () => {
        const h = makeHarness();
        const block = h.chatStream.message().contentBlock({
            type: 'tool_use',
            id: 'call_1',
            name: 'lookup',
        });
        block.addPartialJSON('{"q":');
        block.addPartialJSON('"puter"}');
        block.end();

        expect(h.events()).toEqual([
            {
                type: 'tool_use',
                id: 'call_1',
                name: 'lookup',
                input: { q: 'puter' },
                text: '',
            },
        ]);
    });

    it('forwards extra_content when supplied on the contentBlock spec', () => {
        const h = makeHarness();
        const block = h.chatStream.message().contentBlock({
            type: 'tool_use',
            id: 'call_2',
            name: 'lookup',
            extra_content: { hint: 'metadata' },
        });
        block.addPartialJSON('{}');
        block.end();

        const [event] = h.events();
        expect(event.extra_content).toEqual({ hint: 'metadata' });
    });

    it('falls back to {} when nothing was buffered', () => {
        const h = makeHarness();
        const block = h.chatStream.message().contentBlock({
            type: 'tool_use',
            id: 'call_3',
            name: 'lookup',
        });
        block.end();

        const [event] = h.events();
        expect(event.input).toEqual({});
    });

    it('omits the empty-text suffix when contentBlock already has text', () => {
        const h = makeHarness();
        const block = h.chatStream.message().contentBlock({
            type: 'tool_use',
            id: 'call_4',
            name: 'lookup',
            text: 'preserved',
        });
        block.addPartialJSON('{}');
        block.end();

        const [event] = h.events();
        // The trailing-text empty-fill only happens when no `text` is
        // already present on the spec.
        expect(event.text).toBe('preserved');
    });

    it('falls back to {} instead of throwing when the buffered partial JSON is malformed', () => {
        // Truncated eager_input_streaming input must not kill the whole
        // stream over one malformed tool-call block.
        const h = makeHarness();
        const block = h.chatStream.message().contentBlock({
            type: 'tool_use',
            id: 'call_5',
            name: 'lookup',
        });
        block.addPartialJSON('{"q": "unterminat');
        expect(() => block.end()).not.toThrow();

        const [event] = h.events();
        expect(event.input).toEqual({});
    });

    it('emits tool_use_start and tool_input_delta only when streamToolInput is set', () => {
        const h = makeHarness();
        const withDeltas = new AIChatStream({
            stream: h.sink,
            streamToolInput: true,
        });
        const block = withDeltas
            .message()
            .contentBlock({ type: 'tool_use', id: 'call_6', name: 'lookup' });
        block.addPartialJSON('{"q":');
        block.addPartialJSON('"puter"}');
        block.end();

        expect(h.events()).toEqual([
            { type: 'tool_use_start', id: 'call_6', name: 'lookup' },
            { type: 'tool_input_delta', id: 'call_6', partialJson: '{"q":' },
            {
                type: 'tool_input_delta',
                id: 'call_6',
                partialJson: '"puter"}',
            },
            {
                type: 'tool_use',
                id: 'call_6',
                name: 'lookup',
                input: { q: 'puter' },
                text: '',
            },
        ]);
    });

    it('carries the upstream canonical_id on tool_use_start', () => {
        const h = makeHarness();
        const chatStream = new AIChatStream({
            stream: h.sink,
            streamToolInput: true,
        });
        chatStream.message().contentBlock({
            type: 'tool_use',
            id: 'call_7',
            name: 'lookup',
            canonical_id: 'fc_1',
        });
        expect(h.events()[0]).toEqual({
            type: 'tool_use_start',
            id: 'call_7',
            name: 'lookup',
            canonical_id: 'fc_1',
        });
    });

    it('omits tool_use_start / tool_input_delta without streamToolInput', () => {
        const h = makeHarness();
        const block = h.chatStream
            .message()
            .contentBlock({ type: 'tool_use', id: 'call_7', name: 'lookup' });
        block.addPartialJSON('{}');
        block.end();

        expect(h.events().map((e) => (e as { type: string }).type)).toEqual([
            'tool_use',
        ]);
    });
});

// ── unknown content block type ──────────────────────────────────────

describe('AIChatMessageStream.contentBlock', () => {
    it('throws on an unknown content block type', () => {
        const h = makeHarness();
        expect(() =>
            h.chatStream.message().contentBlock({ type: 'audio' }),
        ).toThrow(/Unknown content block type/);
    });
});
