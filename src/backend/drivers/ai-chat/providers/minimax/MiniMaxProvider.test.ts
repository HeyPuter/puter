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

import { SYSTEM_ACTOR } from '../../../../core/actor.js';
import type { MeteringService } from '../../../../services/metering/MeteringService.js';
import { PuterServer } from '../../../../server.js';
import { setupTestServer } from '../../../../testUtil.js';
import { withTestActor } from '../../../integrationTestUtil.js';
import { MINIMAX_MODELS } from './models.js';
import { MiniMaxProvider } from './MiniMaxProvider.js';

const { createMock, openAICtor } = vi.hoisted(() => {
    const createMock = vi.fn();
    const openAICtor = vi.fn();
    return { createMock, openAICtor };
});

vi.mock('openai', () => {
    const OpenAICtor = vi.fn().mockImplementation(function (
        this: Record<string, unknown>,
        opts: unknown,
    ) {
        openAICtor(opts);
        this.chat = { completions: { create: createMock } };
    });
    return { OpenAI: OpenAICtor, default: { OpenAI: OpenAICtor } };
});

let server: PuterServer;
let recordSpy: MockInstance<MeteringService['utilRecordUsageObject']>;

beforeAll(async () => {
    server = await setupTestServer();
});

afterAll(async () => {
    await server?.shutdown();
});

const makeProvider = () => {
    const provider = new MiniMaxProvider(
        { apiKey: 'test-key' },
        server.services.metering,
    );
    return { provider };
};

const asAsyncIterable = <T>(items: T[]): AsyncIterable<T> => ({
    async *[Symbol.asyncIterator]() {
        for (const item of items) {
            yield item;
        }
    },
});

beforeEach(() => {
    createMock.mockReset();
    openAICtor.mockReset();
    recordSpy = vi.spyOn(server.services.metering, 'utilRecordUsageObject');
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('MiniMaxProvider construction', () => {
    it('points the OpenAI SDK at the MiniMax base URL with the configured key', () => {
        makeProvider();
        expect(openAICtor).toHaveBeenCalledTimes(1);
        expect(openAICtor).toHaveBeenCalledWith({
            apiKey: 'test-key',
            baseURL: 'https://api.minimax.io/v1',
        });
    });

    it('allows overriding the MiniMax API base URL', () => {
        new MiniMaxProvider(
            {
                apiKey: 'test-key',
                apiBaseUrl: 'https://example.test/v1',
            },
            server.services.metering,
        );
        expect(openAICtor).toHaveBeenCalledWith({
            apiKey: 'test-key',
            baseURL: 'https://example.test/v1',
        });
    });
});

describe('MiniMaxProvider model catalog', () => {
    it('returns minimax-m2.7 as the default', () => {
        const { provider } = makeProvider();
        expect(provider.getDefaultModel()).toBe('minimax-m2.7');
    });

    it('exposes the static MINIMAX_MODELS list verbatim from models()', () => {
        const { provider } = makeProvider();
        expect(provider.models()).toBe(MINIMAX_MODELS);
    });

    it('list() flattens canonical ids and aliases', () => {
        const { provider } = makeProvider();
        const ids = provider.list();
        for (const model of MINIMAX_MODELS) {
            expect(ids).toContain(model.id);
            for (const alias of model.aliases ?? []) {
                expect(ids).toContain(alias);
            }
        }
        expect(ids).toContain('minimax-m2.7');
        expect(ids).toContain('MiniMax-M2.7');
        expect(ids).toContain('minimax/minimax-m2.7');
    });

    it('uses MiniMax completion-token limits instead of the context window', () => {
        for (const model of MINIMAX_MODELS) {
            expect(model.context).toBe(204_800);
            expect(model.max_tokens).toBe(196_608);
        }
    });
});

describe('MiniMaxProvider.complete request shape', () => {
    const baseCompletion = {
        choices: [
            {
                message: { content: 'hi', role: 'assistant' },
                finish_reason: 'stop',
            },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
    };

    it('sends the case-sensitive upstream MiniMax model id', async () => {
        const { provider } = makeProvider();
        createMock.mockResolvedValueOnce(baseCompletion);

        await withTestActor(() =>
            provider.complete({
                model: 'minimax-m2.7',
                messages: [{ role: 'user', content: 'hello' }],
            }),
        );

        const [args] = createMock.mock.calls[0]!;
        expect(args.model).toBe('MiniMax-M2.7');
        expect(args.messages).toEqual([{ role: 'user', content: 'hello' }]);
        expect(args.max_tokens).toBe(1000);
    });

    it('resolves the upstream-cased alias to the canonical API model', async () => {
        const { provider } = makeProvider();
        createMock.mockResolvedValueOnce(baseCompletion);

        await withTestActor(() =>
            provider.complete({
                model: 'MiniMax-M2.7-highspeed',
                messages: [{ role: 'user', content: 'hello' }],
            }),
        );

        expect(createMock.mock.calls[0]![0].model).toBe(
            'MiniMax-M2.7-highspeed',
        );
        expect(recordSpy).toHaveBeenCalledWith(
            expect.any(Object),
            expect.anything(),
            'minimax:minimax-m2.7-highspeed',
            expect.any(Object),
        );
    });

    it('passes standard chat completion options through', async () => {
        const { provider } = makeProvider();
        createMock.mockResolvedValueOnce(baseCompletion);
        const tools = [
            {
                type: 'function',
                function: {
                    name: 'lookup',
                    parameters: { type: 'object', properties: {} },
                },
            },
        ];

        await withTestActor(() =>
            provider.complete({
                model: 'minimax-m2.7',
                messages: [{ role: 'user', content: 'hi' }],
                tools,
                tool_choice: 'auto',
                max_tokens: 256,
                temperature: 0.4,
                top_p: 0.9,
            }),
        );

        const [args] = createMock.mock.calls[0]!;
        expect(args.tools).toBe(tools);
        expect(args.tool_choice).toBe('auto');
        expect(args.max_tokens).toBe(256);
        expect(args.temperature).toBe(0.4);
        expect(args.top_p).toBe(0.9);
    });

    it('clamps oversized max_tokens to the MiniMax completion limit', async () => {
        const { provider } = makeProvider();
        createMock.mockResolvedValueOnce(baseCompletion);

        await withTestActor(() =>
            provider.complete({
                model: 'minimax-m2.1',
                messages: [{ role: 'user', content: 'hi' }],
                max_tokens: 200_000,
            }),
        );

        const [args] = createMock.mock.calls[0]!;
        expect(args.model).toBe('MiniMax-M2.1');
        expect(args.max_tokens).toBe(196_608);
    });

    it('only sets stream_options.include_usage when streaming', async () => {
        const { provider } = makeProvider();
        createMock.mockResolvedValueOnce(baseCompletion);

        await withTestActor(() =>
            provider.complete({
                model: 'minimax-m2.7',
                messages: [{ role: 'user', content: 'hi' }],
                stream: false,
            }),
        );
        const [nonStreamArgs] = createMock.mock.calls[0]!;
        expect(nonStreamArgs.stream).toBe(false);
        expect('stream_options' in nonStreamArgs).toBe(false);

        createMock.mockReturnValueOnce(asAsyncIterable([]));
        await withTestActor(() =>
            provider.complete({
                model: 'minimax-m2.7',
                messages: [{ role: 'user', content: 'hi' }],
                stream: true,
            }),
        );
        const [streamArgs] = createMock.mock.calls[1]!;
        expect(streamArgs.stream).toBe(true);
        expect(streamArgs.stream_options).toEqual({ include_usage: true });
    });
});

describe('MiniMaxProvider.complete output and metering', () => {
    it('returns the first choice and records MiniMax usage with model costs', async () => {
        const { provider } = makeProvider();
        createMock.mockResolvedValueOnce({
            choices: [
                {
                    message: { content: 'hi there', role: 'assistant' },
                    finish_reason: 'stop',
                },
            ],
            usage: {
                prompt_tokens: 100,
                completion_tokens: 50,
                prompt_tokens_details: { cached_tokens: 10 },
            },
        });

        const result = await withTestActor(() =>
            provider.complete({
                model: 'minimax-m2.7',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

        expect(result).toMatchObject({
            message: { content: 'hi there', role: 'assistant' },
            finish_reason: 'stop',
        });
        expect((result as { usage: unknown }).usage).toEqual({
            prompt_tokens: 100,
            completion_tokens: 50,
            cached_tokens: 10,
        });

        expect(recordSpy).toHaveBeenCalledTimes(1);
        const [usage, actor, prefix, overrides] = recordSpy.mock.calls[0]!;
        expect(usage).toEqual({
            prompt_tokens: 100,
            completion_tokens: 50,
            cached_tokens: 10,
        });
        expect(actor).toBe(SYSTEM_ACTOR);
        expect(prefix).toBe('minimax:minimax-m2.7');
        expect(overrides).toEqual({
            prompt_tokens: 100 * 30,
            completion_tokens: 50 * 120,
            cached_tokens: 10 * 6,
        });
    });

    it('rethrows errors raised by the OpenAI client unchanged', async () => {
        const { provider } = makeProvider();
        const apiError = new Error('MiniMax exploded');
        createMock.mockRejectedValueOnce(apiError);

        await expect(
            withTestActor(() =>
                provider.complete({
                    model: 'minimax-m2.7',
                    messages: [{ role: 'user', content: 'boom' }],
                }),
            ),
        ).rejects.toBe(apiError);
        expect(recordSpy).not.toHaveBeenCalled();
    });
});

describe('MiniMaxProvider.checkModeration', () => {
    it('throws because MiniMax provider does not implement moderation', () => {
        const { provider } = makeProvider();
        expect(() => provider.checkModeration('anything')).toThrow(
            /not implemented/i,
        );
    });
});
