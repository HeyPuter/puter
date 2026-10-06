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

import type { Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnthropicSseWriter, startSse } from './sse.js';

const makeRes = () => {
    const written: string[] = [];
    let closeHandler: (() => void) | undefined;
    const ended = { value: false };
    const res = {
        write: vi.fn((chunk: string) => {
            written.push(chunk);
            return true;
        }),
        end: vi.fn(() => {
            ended.value = true;
        }),
        once: vi.fn((event: string, handler: () => void) => {
            if (event === 'close') closeHandler = handler;
            return res;
        }),
    };
    return {
        res: res as unknown as Response,
        written,
        ended,
        triggerClose: () => closeHandler?.(),
    };
};

// -- startSse ----------------------------------------------------------

describe('startSse', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('writes event: <type>\\ndata: <json>\\n\\n frames', () => {
        const { res, written } = makeRes();
        const sse = startSse(res);
        sse.write('message_start', { type: 'message_start' });
        expect(written[0]).toBe(
            'event: message_start\ndata: {"type":"message_start"}\n\n',
        );
    });

    it('sends a ping frame after 15s of silence, not before', () => {
        const { res, written } = makeRes();
        startSse(res, { ping: true });
        vi.advanceTimersByTime(14_000);
        expect(written.some((w) => w.includes('event: ping'))).toBe(false);
        vi.advanceTimersByTime(2_000);
        expect(written.some((w) => w.includes('event: ping'))).toBe(true);
        expect(written.at(-1)).toBe('event: ping\ndata: {"type": "ping"}\n\n');
    });

    it('resets the idle clock on every write — no ping while active', () => {
        const { res, written } = makeRes();
        const sse = startSse(res, { ping: true });
        vi.advanceTimersByTime(10_000);
        sse.write('content_block_delta', { type: 'content_block_delta' });
        vi.advanceTimersByTime(10_000);
        expect(written.some((w) => w.includes('event: ping'))).toBe(false);
        vi.advanceTimersByTime(5_000);
        expect(written.some((w) => w.includes('event: ping'))).toBe(true);
    });

    it('does not ping without the option', () => {
        const { res, written } = makeRes();
        startSse(res);
        vi.advanceTimersByTime(60_000);
        expect(written.some((w) => w.includes('event: ping'))).toBe(false);
    });

    it('end() stops further writes and clears the ping timer', () => {
        const { res, written, ended } = makeRes();
        const sse = startSse(res, { ping: true });
        sse.end();
        expect(ended.value).toBe(true);
        expect(sse.ended).toBe(true);
        const before = written.length;
        vi.advanceTimersByTime(60_000);
        expect(written.length).toBe(before);
        sse.write('x', {});
        expect(written.length).toBe(before);
    });

    it('marks ended and clears the timer when the client disconnects', () => {
        const { res, triggerClose } = makeRes();
        const sse = startSse(res, { ping: true });
        triggerClose();
        expect(sse.ended).toBe(true);
    });
});

// -- AnthropicSseWriter ------------------------------------------------

const events = (written: string[]): Array<{ event: string; data: unknown }> =>
    written.map((frame) => {
        const [eventLine, dataLine] = frame.split('\n');
        return {
            event: eventLine!.replace('event: ', ''),
            data: JSON.parse(dataLine!.replace('data: ', '')),
        };
    });

const newWriter = () => {
    const { res, written } = makeRes();
    const sse = startSse(res);
    const writer = new AnthropicSseWriter(sse, {
        id: 'msg_1',
        model: 'claude-test',
        requestId: 'req_1',
    });
    return { writer, written };
};

describe('AnthropicSseWriter', () => {
    it('start() writes message_start with zero usage and null stop fields', () => {
        const { writer, written } = newWriter();
        writer.start();
        const [first] = events(written);
        expect(first!.event).toBe('message_start');
        expect(first!.data).toMatchObject({
            type: 'message_start',
            message: {
                id: 'msg_1',
                type: 'message',
                role: 'assistant',
                content: [],
                model: 'claude-test',
                stop_reason: null,
                stop_sequence: null,
            },
        });
    });

    it('text: content_block_start → delta(text_delta) → stop, then message_delta/message_stop on usage', () => {
        const { writer, written } = newWriter();
        writer.start();
        writer.onChunk({ type: 'text', text: 'hi' });
        writer.onChunk({
            type: 'usage',
            usageDetails: { inputTokens: 1, outputTokens: 1 },
        });
        const seq = events(written).map((e) => e.event);
        expect(seq).toEqual([
            'message_start',
            'content_block_start',
            'content_block_delta',
            'content_block_stop',
            'message_delta',
            'message_stop',
        ]);
        const delta = events(written)[2]!.data as {
            delta: { type: string; text: string };
        };
        expect(delta.delta).toEqual({ type: 'text_delta', text: 'hi' });
    });

    it('thinking: reasoning_start(anthropic) opens a thinking block; signature arrives via reasoning_detail', () => {
        const { writer, written } = newWriter();
        writer.start();
        writer.onChunk({ type: 'reasoning_start', format: 'anthropic' });
        writer.onChunk({ type: 'reasoning', reasoning: 'because' });
        writer.onChunk({
            type: 'reasoning_detail',
            detail: { type: 'thinking', thinking: 'because', signature: 'sig' },
        });
        writer.onChunk({ type: 'usage', usageDetails: {} });

        const evs = events(written);
        const start = evs.find((e) => e.event === 'content_block_start');
        expect((start!.data as { content_block: { type: string } }).content_block)
            .toMatchObject({ type: 'thinking' });
        const deltas = evs.filter((e) => e.event === 'content_block_delta');
        expect(deltas[0]!.data).toMatchObject({
            delta: { type: 'thinking_delta', thinking: 'because' },
        });
        expect(deltas[1]!.data).toMatchObject({
            delta: { type: 'signature_delta', signature: 'sig' },
        });
    });

    it('bare reasoning deltas with no reasoning_start (unsigned) never open an Anthropic thinking block', () => {
        const { writer, written } = newWriter();
        writer.start();
        writer.onChunk({ type: 'reasoning', reasoning: 'stray' });
        writer.onChunk({ type: 'text', text: 'hi' });
        writer.onChunk({ type: 'usage', usageDetails: {} });
        const kinds = events(written)
            .filter((e) => e.event === 'content_block_start')
            .map((e) => (e.data as { content_block: { type: string } }).content_block.type);
        expect(kinds).toEqual(['text']);
    });

    it('redacted_thinking opens and closes immediately with no preceding reasoning_start', () => {
        const { writer, written } = newWriter();
        writer.start();
        writer.onChunk({
            type: 'reasoning_detail',
            detail: { type: 'redacted_thinking', data: 'opaque' },
        });
        writer.onChunk({ type: 'usage', usageDetails: {} });
        const evs = events(written);
        const start = evs.find((e) => e.event === 'content_block_start')!;
        expect(start.data).toMatchObject({
            content_block: { type: 'redacted_thinking', data: 'opaque' },
        });
        const stopIndex = evs.findIndex((e) => e.event === 'content_block_stop');
        expect(stopIndex).toBeGreaterThan(evs.indexOf(start));
    });

    it('tool_use incremental: tool_use_start → input_json_delta× → stop (no extra delta on the closing tool_use)', () => {
        const { writer, written } = newWriter();
        writer.start();
        writer.onChunk({ type: 'tool_use_start', id: 'tu_1', name: 'Bash' });
        writer.onChunk({ type: 'tool_input_delta', id: 'tu_1', partialJson: '{"c' });
        writer.onChunk({ type: 'tool_input_delta', id: 'tu_1', partialJson: 'md":1}' });
        writer.onChunk({ type: 'tool_use', id: 'tu_1', name: 'Bash', input: { cmd: 1 } });
        writer.onChunk({ type: 'usage', usageDetails: {} });

        const evs = events(written);
        const deltas = evs.filter((e) => e.event === 'content_block_delta');
        expect(deltas).toHaveLength(2);
        expect(deltas.map((d) => (d.data as { delta: { partial_json: string } }).delta.partial_json)).toEqual([
            '{"c',
            'md":1}',
        ]);
    });

    it('parallel calls whose tool_use chunks land after the next start are not emitted twice', () => {
        const { writer, written } = newWriter();
        writer.start();
        writer.onChunk({ type: 'tool_use_start', id: 'tu_a', name: 'Read' });
        writer.onChunk({ type: 'tool_input_delta', id: 'tu_a', partialJson: '{}' });
        writer.onChunk({ type: 'tool_use_start', id: 'tu_b', name: 'Read' });
        writer.onChunk({ type: 'tool_input_delta', id: 'tu_b', partialJson: '{}' });
        writer.onChunk({ type: 'tool_use', id: 'tu_a', name: 'Read', input: {} });
        writer.onChunk({ type: 'tool_use', id: 'tu_b', name: 'Read', input: {} });
        writer.onChunk({ type: 'usage', usageDetails: {} });

        const starts = events(written).filter(
            (e) => e.event === 'content_block_start',
        );
        expect(
            starts.map((e) => (e.data as { content_block: { id: string } }).content_block.id),
        ).toEqual(['tu_a', 'tu_b']);
        const stops = events(written).filter((e) => e.event === 'content_block_stop');
        expect(stops.map((e) => (e.data as { index: number }).index)).toEqual([0, 1]);
    });

    it('tool_use single-shot (no prior start): one content_block_start/delta/stop', () => {
        const { writer, written } = newWriter();
        writer.start();
        writer.onChunk({ type: 'tool_use', id: 'tu_2', name: 'Grep', input: { q: 'x' } });
        writer.onChunk({ type: 'usage', usageDetails: {} });
        const evs = events(written);
        expect(evs.filter((e) => e.event === 'content_block_start')).toHaveLength(1);
        const delta = evs.find((e) => e.event === 'content_block_delta')!;
        expect(delta.data).toMatchObject({
            delta: { type: 'input_json_delta', partial_json: '{"q":"x"}' },
        });
    });

    it('server_tool_use streams one input_json_delta then stops', () => {
        const { writer, written } = newWriter();
        writer.start();
        writer.onChunk({
            type: 'server_tool',
            block: {
                type: 'server_tool_use',
                id: 'srvtoolu_1',
                name: 'web_search',
                input: { query: 'puter' },
            },
        });
        writer.onChunk({ type: 'usage', usageDetails: {} });
        const evs = events(written);
        const start = evs.find((e) => e.event === 'content_block_start')!;
        expect(start.data).toMatchObject({
            content_block: { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search' },
        });
        const delta = evs.find((e) => e.event === 'content_block_delta')!;
        expect(delta.data).toMatchObject({
            delta: { partial_json: '{"query":"puter"}' },
        });
    });

    it('a server-tool result block arrives whole — no deltas', () => {
        const { writer, written } = newWriter();
        writer.start();
        writer.onChunk({
            type: 'server_tool',
            block: {
                type: 'web_search_tool_result',
                tool_use_id: 'srvtoolu_1',
                content: [{ type: 'web_search_result', title: 'x', url: 'y' }],
            },
        });
        writer.onChunk({ type: 'usage', usageDetails: {} });
        const evs = events(written);
        expect(evs.filter((e) => e.event === 'content_block_delta')).toHaveLength(0);
        const start = evs.find((e) => e.event === 'content_block_start')!;
        expect(start.data).toMatchObject({
            content_block: { type: 'web_search_tool_result' },
        });
    });

    it('message_delta carries real stop_reason/stop_sequence/usage, and stop_details only when non-null', () => {
        const { writer, written } = newWriter();
        writer.start();
        writer.onChunk({
            type: 'usage',
            stopReason: 'max_tokens',
            stopSequence: 'END',
            stopDetails: { reason: 'budget' },
            usageDetails: { inputTokens: 5, outputTokens: 7, cacheReadTokens: 2 },
        });
        const delta = events(written).find((e) => e.event === 'message_delta')!;
        expect(delta.data).toMatchObject({
            delta: {
                stop_reason: 'max_tokens',
                stop_sequence: 'END',
                stop_details: { reason: 'budget' },
            },
            usage: { input_tokens: 5, output_tokens: 7, cache_read_input_tokens: 2 },
        });
    });

    it('omits stop_details when null/absent', () => {
        const { writer, written } = newWriter();
        writer.start();
        writer.onChunk({ type: 'usage', stopReason: 'end_turn', usageDetails: {} });
        const delta = events(written).find((e) => e.event === 'message_delta')!;
        expect((delta.data as { delta: Record<string, unknown> }).delta).not.toHaveProperty(
            'stop_details',
        );
    });

    it('safeguard_results in message_delta.delta ONLY when the upstream sent them', () => {
        const withSafeguards = newWriter();
        withSafeguards.writer.start();
        withSafeguards.writer.onChunk({
            type: 'safeguard_results',
            results: [{ type: 'dangerous_tool_use', status: { tool_uses: {} } }],
        });
        withSafeguards.writer.onChunk({ type: 'usage', usageDetails: {} });
        const deltaWith = events(withSafeguards.written).find(
            (e) => e.event === 'message_delta',
        )!;
        expect((deltaWith.data as { delta: Record<string, unknown> }).delta).toHaveProperty(
            'safeguard_results',
        );

        const withoutSafeguards = newWriter();
        withoutSafeguards.writer.start();
        withoutSafeguards.writer.onChunk({ type: 'usage', usageDetails: {} });
        const deltaWithout = events(withoutSafeguards.written).find(
            (e) => e.event === 'message_delta',
        )!;
        expect((deltaWithout.data as { delta: Record<string, unknown> }).delta).not.toHaveProperty(
            'safeguard_results',
        );
    });

    it('context_management on message_delta only when present', () => {
        const { writer, written } = newWriter();
        writer.start();
        writer.onChunk({
            type: 'usage',
            usageDetails: {},
            contextManagement: { applied_edits: [{ type: 'compact_20260112' }] },
        });
        const delta = events(written).find((e) => e.event === 'message_delta')!;
        expect(delta.data).toMatchObject({
            context_management: { applied_edits: [{ type: 'compact_20260112' }] },
        });
    });

    it('stop_reason defaults to tool_use when a tool_use was seen and the upstream gave none', () => {
        const { writer, written } = newWriter();
        writer.start();
        writer.onChunk({ type: 'tool_use', id: 't1', name: 'a', input: {} });
        writer.onChunk({ type: 'usage', usageDetails: {} });
        const delta = events(written).find((e) => e.event === 'message_delta')!;
        expect((delta.data as { delta: { stop_reason: string } }).delta.stop_reason).toBe(
            'tool_use',
        );
    });

    it('stop_reason defaults to end_turn with no tool_use and no upstream reason', () => {
        const { writer, written } = newWriter();
        writer.start();
        writer.onChunk({ type: 'text', text: 'hi' });
        writer.onChunk({ type: 'usage', usageDetails: {} });
        const delta = events(written).find((e) => e.event === 'message_delta')!;
        expect((delta.data as { delta: { stop_reason: string } }).delta.stop_reason).toBe(
            'end_turn',
        );
    });

    it('promotes an explicit stopReason of end_turn to tool_use when a tool_use was seen', () => {
        const { writer, written } = newWriter();
        writer.start();
        writer.onChunk({ type: 'tool_use', id: 't1', name: 'a', input: {} });
        writer.onChunk({
            type: 'usage',
            stopReason: 'end_turn',
            usageDetails: {},
        });
        const delta = events(written).find((e) => e.event === 'message_delta')!;
        expect(
            (delta.data as { delta: { stop_reason: string } }).delta
                .stop_reason,
        ).toBe('tool_use');
    });

    it('an in-band error chunk writes event: error with no message_delta/message_stop, then ends', () => {
        const { res, written, ended } = makeRes();
        const sse = startSse(res);
        const writer = new AnthropicSseWriter(sse, {
            id: 'msg_1',
            model: 'claude-test',
            requestId: 'req_1',
        });
        writer.start();
        writer.onChunk({ type: 'text', text: 'partial' });
        writer.onChunk({ type: 'error', message: 'upstream overloaded', status: 529 });

        const evs = events(written);
        expect(evs.map((e) => e.event)).not.toContain('message_delta');
        expect(evs.map((e) => e.event)).not.toContain('message_stop');
        const errorEvent = evs.find((e) => e.event === 'error')!;
        expect(errorEvent.data).toEqual({
            type: 'error',
            error: { type: 'overloaded_error', message: 'upstream overloaded' },
            request_id: 'req_1',
        });
        expect(writer.ended).toBe(true);
        expect(ended.value).toBe(true);
    });

    it('maps known statuses to Anthropic error types, falling back to api_error', () => {
        const cases: Array<[number, string]> = [
            [400, 'invalid_request_error'],
            [401, 'authentication_error'],
            [403, 'permission_error'],
            [404, 'not_found_error'],
            [413, 'request_too_large'],
            [429, 'rate_limit_error'],
            [504, 'timeout_error'],
            [529, 'overloaded_error'],
            [502, 'api_error'],
        ];
        for (const [status, type] of cases) {
            const { writer, written } = newWriter();
            writer.onChunk({ type: 'error', message: 'x', status });
            const errorEvent = events(written).find((e) => e.event === 'error')!;
            expect((errorEvent.data as { error: { type: string } }).error.type).toBe(
                type,
            );
        }
    });

    it('ignores further chunks once ended', () => {
        const { writer, written } = newWriter();
        writer.start();
        writer.onChunk({ type: 'usage', usageDetails: {} });
        const before = written.length;
        writer.onChunk({ type: 'text', text: 'too late' });
        expect(written.length).toBe(before);
    });
});
