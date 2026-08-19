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
 * Offline unit tests for GeminiInteractionsChatProvider.
 *
 * Boots a real PuterServer so metering is exercised against the live
 * MeteringService, and mocks @google/genai at the module boundary — the actual
 * network egress point. What these assert is the drop-in claim: an Interactions
 * upstream comes back out of the provider in the same shape the driver already
 * consumes from every OpenAI-compatible one.
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

import type { MeteringService } from '../../../../services/metering/MeteringService.js';
import { PuterServer } from '../../../../server.js';
import { setupTestServer } from '../../../../testUtil.js';
import { withTestActor } from '../../../integrationTestUtil.js';
import { AIChatStream } from '../../utils/Streaming.js';
import { GeminiInteractionsChatProvider } from './GeminiInteractionsChatProvider.js';

const { createMock, genAICtor } = vi.hoisted(() => ({
    createMock: vi.fn(),
    genAICtor: vi.fn(),
}));

vi.mock('@google/genai', () => {
    const GoogleGenAI = vi.fn().mockImplementation(function (
        this: Record<string, unknown>,
        opts: unknown,
    ) {
        genAICtor(opts);
        this.interactions = { create: createMock };
    });
    return { GoogleGenAI };
});

let server: PuterServer;
let recordSpy: MockInstance<MeteringService['utilRecordUsageObject']>;

beforeAll(async () => {
    server = await setupTestServer();
});

afterAll(async () => {
    await server?.shutdown();
});

const makeProvider = () =>
    new GeminiInteractionsChatProvider(server.services.metering, {
        apiKey: 'test-key',
    });

const makeCapturingChatStream = () => {
    const chunks: string[] = [];
    const sink = new Writable({
        write(chunk, _enc, cb) {
            chunks.push(chunk.toString('utf8'));
            cb();
        },
    });
    return {
        chatStream: new AIChatStream({ stream: sink }),
        events: () =>
            chunks
                .join('')
                .split('\n')
                .filter(Boolean)
                .map((line) => JSON.parse(line)),
    };
};

const interaction = (overrides: Record<string, unknown> = {}) => ({
    id: 'int_1',
    created: '2026-08-19T00:00:00Z',
    updated: '2026-08-19T00:00:01Z',
    status: 'completed',
    model: 'gemini-3.5-flash',
    outputs: [{ type: 'text', text: 'hello' }],
    usage: { total_input_tokens: 10, total_output_tokens: 4 },
    ...overrides,
});

beforeEach(() => {
    createMock.mockReset();
    genAICtor.mockReset();
    recordSpy = vi.spyOn(server.services.metering, 'utilRecordUsageObject');
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('catalog', () => {
    it('serves the same models as the OpenAI-compat route', async () => {
        const ids = (await makeProvider().models()).map((m) => m.id);
        expect(ids).toContain('gemini-3.5-flash');
    });

    it('hands out copies so the driver cannot mutate the shared catalog', async () => {
        const provider = makeProvider();
        const first = await provider.models();
        first[0].aliases!.push('mutated');
        const second = await provider.models();
        expect(second[0].aliases).not.toContain('mutated');
    });
});

describe('complete (non-streaming)', () => {
    it('returns a chat-completions choice and meters the turn', async () => {
        createMock.mockResolvedValue(interaction());
        const provider = makeProvider();

        const result = await withTestActor(() =>
            provider.complete({
                messages: [{ role: 'user', content: 'hi' }],
                model: 'gemini-3.5-flash',
            }),
        );

        expect(result).toMatchObject({
            finish_reason: 'stop',
            message: { role: 'assistant', content: 'hello' },
        });
        expect(recordSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                prompt_tokens: 10,
                completion_tokens: 4,
            }),
            expect.anything(),
            'gemini:gemini-3.5-flash',
            expect.anything(),
        );
    });

    it('sends turns, system_instruction and store:false upstream', async () => {
        createMock.mockResolvedValue(interaction());
        const provider = makeProvider();

        await withTestActor(() =>
            provider.complete({
                messages: [
                    { role: 'system', content: 'be terse' },
                    { role: 'user', content: 'hi' },
                ],
                model: 'gemini-3.5-flash',
            }),
        );

        expect(createMock).toHaveBeenCalledWith(
            expect.objectContaining({
                model: 'gemini-3.5-flash',
                system_instruction: 'be terse',
                // Puter resends history every turn; nothing here is Google's
                // to retain.
                store: false,
                input: [
                    { role: 'user', content: [{ type: 'text', text: 'hi' }] },
                ],
            }),
        );
    });

    it('bills thinking tokens separately from generated output', async () => {
        createMock.mockResolvedValue(
            interaction({
                usage: {
                    total_input_tokens: 100,
                    total_output_tokens: 40,
                    total_thought_tokens: 25,
                    total_cached_tokens: 10,
                },
            }),
        );

        await withTestActor(() =>
            makeProvider().complete({
                messages: [{ role: 'user', content: 'hi' }],
                model: 'gemini-3.5-flash',
            }),
        );

        expect(recordSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                prompt_tokens: 90,
                completion_tokens: 40,
                cached_tokens: 10,
                thinking_tokens: 25,
            }),
            expect.anything(),
            expect.any(String),
            expect.anything(),
        );
    });

    it('refuses a caller-supplied previous_response_id', async () => {
        await expect(
            withTestActor(() =>
                makeProvider().complete({
                    messages: [{ role: 'user', content: 'hi' }],
                    model: 'gemini-3.5-flash',
                    previous_response_id: 'int_someone_else',
                }),
            ),
        ).rejects.toThrow(/not supported/i);
        expect(createMock).not.toHaveBeenCalled();
    });
});

describe('complete (streaming)', () => {
    it('drives the shared stream handler to a normal NDJSON stream', async () => {
        async function* events() {
            yield {
                event_type: 'interaction.start',
                interaction: interaction(),
            };
            yield {
                event_type: 'content.delta',
                index: 0,
                delta: { type: 'text', text: 'hel' },
            };
            yield {
                event_type: 'content.delta',
                index: 0,
                delta: { type: 'text', text: 'lo' },
            };
            yield {
                event_type: 'interaction.complete',
                interaction: interaction(),
            };
        }
        createMock.mockResolvedValue(events());

        const result = (await withTestActor(() =>
            makeProvider().complete({
                messages: [{ role: 'user', content: 'hi' }],
                model: 'gemini-3.5-flash',
                stream: true,
            }),
        )) as {
            init_chat_stream: (p: { chatStream: unknown }) => Promise<void>;
        };

        const harness = makeCapturingChatStream();
        await result.init_chat_stream({ chatStream: harness.chatStream });

        const chunks = harness.events();
        expect(
            chunks
                .filter((c) => c.type === 'text')
                .map((c) => c.text)
                .join(''),
        ).toBe('hello');
        expect(chunks.find((c) => c.type === 'usage')?.usage).toMatchObject({
            prompt_tokens: 10,
        });
        expect(recordSpy).toHaveBeenCalled();
    });
});
