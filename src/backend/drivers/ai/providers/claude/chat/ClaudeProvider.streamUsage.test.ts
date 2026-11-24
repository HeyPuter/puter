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
 * Runs ClaudeProvider against the real Anthropic SDK, with only `fetch`
 * stubbed, so a stream's usage passes through the SDK's own accumulator.
 */

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
import { PuterServer } from '../../../../../server.js';
import { setupTestServer } from '../../../../../testUtil.js';
import { withTestActor } from '../../../shared/integrationTestUtil.js';
import { AIChatStream } from '../../../interfaces/chat/utils/Streaming.js';
import { ClaudeProvider } from './ClaudeProvider.js';

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

const MODEL = 'claude-haiku-4-5-20251001';

/** Streams one answer whose usage starts as `start` and ends as `end`. */
const streamUsage = async (start: object, end: object) => {
    const events = [
        {
            type: 'message_start',
            message: {
                id: 'msg_1',
                type: 'message',
                role: 'assistant',
                model: MODEL,
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
        vi.fn(
            async () =>
                new Response(
                    events
                        .map(
                            (event) =>
                                `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
                        )
                        .join(''),
                    {
                        status: 200,
                        headers: { 'content-type': 'text/event-stream' },
                    },
                ),
        ),
    );
    const provider = new ClaudeProvider(
        server.services.metering,
        { fsEntry: server.stores.fsEntry, s3Object: server.stores.s3Object },
        server.services.fs,
        { apiKey: 'test-key' },
    );
    const result = (await withTestActor(() =>
        provider.complete({
            model: MODEL,
            messages: [{ role: 'user', content: 'hi' }],
            stream: true,
        }),
    )) as {
        init_chat_stream: (params: {
            chatStream: AIChatStream;
        }) => Promise<void>;
    };
    const chatStream = new AIChatStream({
        stream: new Writable({ write: (_chunk, _enc, done) => done() }),
    });
    await withTestActor(() => result.init_chat_stream({ chatStream }));
    return recordSpy.mock.calls.at(-1)![0] as Record<string, number>;
};

describe('ClaudeProvider streamed cache writes', () => {
    it('bills the cache writes a stream reports after its lifetime split', async () => {
        // The split arrives once, on message_start; the total keeps growing
        // as later server-tool passes write to the cache.
        const usage = await streamUsage(
            {
                input_tokens: 100,
                output_tokens: 1,
                cache_creation_input_tokens: 1000,
                cache_read_input_tokens: 0,
                cache_creation: {
                    ephemeral_5m_input_tokens: 1000,
                    ephemeral_1h_input_tokens: 0,
                },
            },
            {
                input_tokens: 500,
                output_tokens: 200,
                cache_creation_input_tokens: 5000,
                cache_read_input_tokens: 0,
            },
        );

        expect(usage).toMatchObject({
            input_tokens: 500,
            output_tokens: 200,
            ephemeral_5m_input_tokens: 5000,
            ephemeral_1h_input_tokens: 0,
        });
    });

    it('shares later writes between 5m and 1h as the split it has', async () => {
        const usage = await streamUsage(
            {
                input_tokens: 100,
                output_tokens: 1,
                cache_creation_input_tokens: 1000,
                cache_creation: {
                    ephemeral_5m_input_tokens: 250,
                    ephemeral_1h_input_tokens: 750,
                },
            },
            {
                input_tokens: 500,
                output_tokens: 200,
                cache_creation_input_tokens: 5000,
            },
        );

        expect(usage).toMatchObject({
            ephemeral_5m_input_tokens: 1250,
            ephemeral_1h_input_tokens: 3750,
        });
    });

    it('leaves a split that already adds up to the total as reported', async () => {
        const usage = await streamUsage(
            {
                input_tokens: 100,
                output_tokens: 1,
                cache_creation_input_tokens: 1000,
                cache_creation: {
                    ephemeral_5m_input_tokens: 400,
                    ephemeral_1h_input_tokens: 600,
                },
            },
            {
                input_tokens: 100,
                output_tokens: 200,
                cache_creation_input_tokens: 1000,
            },
        );

        expect(usage).toMatchObject({
            ephemeral_5m_input_tokens: 400,
            ephemeral_1h_input_tokens: 600,
        });
    });
});
