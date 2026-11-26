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
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

import type {
    BetaMessageDeltaUsage,
    BetaMessageIterationUsage,
    BetaUsage,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { Writable } from 'node:stream';
import {
    afterAll,
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
    type MockInstance,
} from 'vitest';
import type { MeteringService } from '../../../../../services/metering/MeteringService.js';
import type { PuterServer } from '../../../../../server.js';
import { setupTestServer } from '../../../../../testUtil.js';
import { AIChatStream } from '../../../interfaces/chat/utils/Streaming.js';
import { withTestActor } from '../../../shared/integrationTestUtil.js';
import { ClaudeProvider } from './ClaudeProvider.js';

const model = 'claude-haiku-4-5-20251001';
let server: PuterServer;
let recordSpy: MockInstance<MeteringService['utilRecordUsageObject']>;

beforeAll(async () => {
    server = await setupTestServer();
});

afterAll(async () => {
    await server?.shutdown();
});

beforeEach(() => {
    recordSpy = vi.spyOn(server.services.metering, 'utilRecordUsageObject');
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

const messageIteration = (
    write5m: number,
    write1h: number,
): BetaMessageIterationUsage => ({
    type: 'message',
    model,
    input_tokens: 250,
    output_tokens: 100,
    cache_read_input_tokens: 500,
    cache_creation_input_tokens: write5m + write1h,
    cache_creation: {
        ephemeral_5m_input_tokens: write5m,
        ephemeral_1h_input_tokens: write1h,
    },
});

// Only HTTP is stubbed so the real SDK accumulates message_start/message_delta usage.
const streamUsage = async (
    start: Partial<BetaUsage>,
    end: Partial<BetaMessageDeltaUsage>,
    compaction = false,
) => {
    const events = [
        {
            type: 'message_start',
            message: {
                id: 'msg_cache_usage',
                type: 'message',
                role: 'assistant',
                model,
                content: [],
                stop_reason: null,
                stop_sequence: null,
                usage: start,
            },
        },
        {
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'text', text: '' },
        },
        {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: 'done' },
        },
        { type: 'content_block_stop', index: 0 },
        {
            type: 'message_delta',
            delta: { stop_reason: 'end_turn', stop_sequence: null },
            usage: end,
        },
        { type: 'message_stop' },
    ];
    vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(
            events.map((event) =>
                `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
            ).join(''),
            { headers: { 'content-type': 'text/event-stream' } },
        )),
    );
    const provider = new ClaudeProvider(
        server.services.metering,
        { fsEntry: server.stores.fsEntry, s3Object: server.stores.s3Object },
        server.services.fs,
        { apiKey: 'test-key' },
    );
    const result = await withTestActor(() => provider.complete({
        model,
        messages: [{ role: 'user', content: 'hi' }],
        stream: true,
        compaction,
    }));
    const chatStream = new AIChatStream({
        stream: new Writable({ write: (_chunk, _encoding, done) => done() }),
    });
    await withTestActor(() => (
        result as {
            init_chat_stream: (params: { chatStream: AIChatStream }) => Promise<void>;
        }
    ).init_chat_stream({ chatStream }));
    const executorCalls = recordSpy.mock.calls.filter(([, , key]) => key === `claude:${model}`);
    expect(executorCalls).toHaveLength(1);
    const [usage, , , costs] = executorCalls[0]!;
    return { usage, costs, details: chatStream.usageDetails };
};

const startUsage = {
    input_tokens: 100,
    output_tokens: 1,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 4096,
    cache_creation: {
        ephemeral_5m_input_tokens: 1024,
        ephemeral_1h_input_tokens: 3072,
    },
};
const endUsage = {
    input_tokens: 500,
    output_tokens: 200,
    cache_read_input_tokens: 1000,
    cache_creation_input_tokens: 12288,
};

describe('Claude streamed cache lifetimes', () => {
    it.each([
        [false, 8192, 0, 9216, 3072],
        [false, 0, 8192, 1024, 11264],
        [false, 4096, 4096, 5120, 7168],
        [true, 8192, 0, 9216, 3072],
        [true, 0, 8192, 1024, 11264],
        [true, 4096, 4096, 5120, 7168],
    ] as const)('bills reported lifetimes with compaction %s and later writes of %i 5m and %i 1h tokens', async (
        compaction, later5m, later1h, total5m, total1h,
    ) => {
        const { usage, costs, details } = await streamUsage(startUsage, {
            ...endUsage,
            iterations: [
                messageIteration(1024, 3072),
                messageIteration(later5m, later1h),
            ],
        }, compaction);
        expect(usage).toMatchObject({
            input_tokens: 500,
            output_tokens: 200,
            cache_read_input_tokens: 1000,
            ephemeral_5m_input_tokens: total5m,
            ephemeral_1h_input_tokens: total1h,
        });
        expect(costs).toMatchObject({
            ephemeral_5m_input_tokens: total5m * 125,
            ephemeral_1h_input_tokens: total1h * 200,
        });
        expect(details).toMatchObject({
            cacheWrite5mTokens: total5m,
            cacheWrite1hTokens: total1h,
            iterations: [
                { type: 'message', cacheWrite5mTokens: 1024, cacheWrite1hTokens: 3072 },
                { type: 'message', cacheWrite5mTokens: later5m, cacheWrite1hTokens: later1h },
            ],
        });
    });

    it('keeps a correct 1h count when later server-tool writes use 5m', async () => {
        const { usage } = await streamUsage({
            ...startUsage,
            cache_creation: {
                ephemeral_5m_input_tokens: 0,
                ephemeral_1h_input_tokens: 4096,
            },
        }, {
            ...endUsage,
            iterations: [messageIteration(0, 4096), messageIteration(8192, 0)],
        });
        expect(usage).toMatchObject({
            ephemeral_5m_input_tokens: 8192,
            ephemeral_1h_input_tokens: 4096,
        });
    });

    it('accepts an omitted lifetime split for an iteration that wrote zero tokens', async () => {
        const { usage } = await streamUsage({
            ...startUsage,
            cache_creation_input_tokens: 0,
            cache_creation: {
                ephemeral_5m_input_tokens: 0,
                ephemeral_1h_input_tokens: 0,
            },
        }, {
            ...endUsage,
            cache_creation_input_tokens: 8192,
            iterations: [
                { ...messageIteration(0, 0), cache_creation: null },
                messageIteration(8192, 0),
            ],
        });
        expect(usage).toMatchObject({
            ephemeral_5m_input_tokens: 8192,
            ephemeral_1h_input_tokens: 0,
        });
    });

    it('keeps advisor cache writes separate from the message lifetime total', async () => {
        const { usage } = await streamUsage(startUsage, {
            ...endUsage,
            iterations: [
                {
                    type: 'advisor_message',
                    model: 'claude-sonnet-4-6',
                    input_tokens: 0,
                    output_tokens: 0,
                    cache_read_input_tokens: 0,
                    cache_creation_input_tokens: 8192,
                    cache_creation: {
                        ephemeral_5m_input_tokens: 0,
                        ephemeral_1h_input_tokens: 8192,
                    },
                },
                messageIteration(1024, 3072),
                messageIteration(8192, 0),
            ],
        });
        expect(usage).toMatchObject({
            ephemeral_5m_input_tokens: 9216,
            ephemeral_1h_input_tokens: 3072,
        });
        expect(recordSpy).toHaveBeenCalledTimes(2);
        expect(recordSpy.mock.calls[1]![0]).toMatchObject({
            advisor_ephemeral_1h_input_tokens: 8192,
        });
    });

    it.each([
        undefined,
        [],
        [messageIteration(1024, 3072)],
        [messageIteration(1024, 3072), { ...messageIteration(8192, 0), cache_creation: null }],
        [messageIteration(1024, 3072), messageIteration(12288, 0)],
    ])('keeps the reported 1h count and bills uncovered writes at 5m when iteration lifetimes are incomplete (%#)', async (iterations) => {
        const { usage } = await streamUsage(startUsage, { ...endUsage, iterations });
        expect(usage).toMatchObject({
            ephemeral_5m_input_tokens: 9216,
            ephemeral_1h_input_tokens: 3072,
        });
    });

    it('bills cache written after a server tool at 5m when the stream reports no iterations', async () => {
        const { usage, costs, details } = await streamUsage({
            input_tokens: 10,
            output_tokens: 1,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 5095,
            cache_creation: {
                ephemeral_5m_input_tokens: 0,
                ephemeral_1h_input_tokens: 5095,
            },
        }, {
            input_tokens: 20,
            output_tokens: 80,
            cache_read_input_tokens: 5095,
            cache_creation_input_tokens: 5312,
            server_tool_use: { web_search_requests: 0, web_fetch_requests: 1 },
        });
        expect(usage).toMatchObject({
            ephemeral_5m_input_tokens: 217,
            ephemeral_1h_input_tokens: 5095,
            web_fetch_requests: 1,
        });
        expect(costs).toMatchObject({
            ephemeral_5m_input_tokens: 217 * 125,
            ephemeral_1h_input_tokens: 5095 * 200,
        });
        expect(details).toMatchObject({
            cacheWrite5mTokens: 217,
            cacheWrite1hTokens: 5095,
        });
    });

    it('keeps the aggregate-only 5m fallback when the upstream omits lifetime splits', async () => {
        const { usage } = await streamUsage({ ...startUsage, cache_creation: null }, endUsage);
        expect(usage).toMatchObject({
            ephemeral_5m_input_tokens: 12288,
            ephemeral_1h_input_tokens: 0,
        });
    });
});
