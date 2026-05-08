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

import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
// @ts-expect-error — sibling JS module without an adjacent .d.ts
import Streaming, {
    AIChatMessageStream,
    AIChatStream,
    AIChatTextStream,
    AIChatToolUseStream,
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

    it('throws when the buffered partial JSON is malformed', () => {
        const h = makeHarness();
        const block = h.chatStream.message().contentBlock({
            type: 'tool_use',
            id: 'call_5',
            name: 'lookup',
        });
        block.addPartialJSON('not-json');
        // .end() runs JSON.parse on the buffer — bad JSON surfaces here.
        expect(() => block.end()).toThrow(SyntaxError);
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
