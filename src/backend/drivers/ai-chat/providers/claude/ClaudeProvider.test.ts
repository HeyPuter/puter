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
 * Offline unit tests for ClaudeProvider.
 *
 * Boots a real PuterServer (in-memory sqlite + dynamo + s3 + mock
 * redis) and constructs ClaudeProvider directly against the live
 * wired `MeteringService`, `stores`, and `FSService`. The Anthropic
 * SDK is mocked at the module boundary; that's the real network
 * egress point. Text-only prompts skip the `puter_path` Files-API
 * branch by design — file-upload behaviour is covered separately by
 * the integration suite. The companion integration test
 * (ClaudeProvider.integration.test.ts) exercises the real Anthropic
 * endpoint.
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

import { SYSTEM_ACTOR } from '../../../../core/actor.js';
import type { MeteringService } from '../../../../services/metering/MeteringService.js';
import { PuterServer } from '../../../../server.js';
import { setupTestServer } from '../../../../testUtil.js';
import { withTestActor } from '../../../integrationTestUtil.js';
import { AIChatStream } from '../../utils/Streaming.js';
import { CLAUDE_MODELS } from './models.js';
import { ClaudeProvider } from './ClaudeProvider.js';

// ── Anthropic SDK mock ──────────────────────────────────────────────

const { messagesCreateMock, messagesStreamMock, anthropicCtor } = vi.hoisted(
    () => ({
        messagesCreateMock: vi.fn(),
        messagesStreamMock: vi.fn(),
        anthropicCtor: vi.fn(),
    }),
);

vi.mock('@anthropic-ai/sdk', () => {
    const Anthropic = vi.fn().mockImplementation(function (
        this: Record<string, unknown>,
        opts: unknown,
    ) {
        anthropicCtor(opts);
        this.messages = {
            create: messagesCreateMock,
            stream: messagesStreamMock,
        };
        // Beta files surface — only consulted when puter_path uploads run, so
        // tests that exercise text-only paths never hit these stubs.
        this.beta = {
            files: { delete: vi.fn() },
            messages: {
                create: messagesCreateMock,
                stream: messagesStreamMock,
            },
        };
    });
    return { default: Anthropic };
});

// ── Test harness ────────────────────────────────────────────────────

let server: PuterServer;
let recordSpy: MockInstance<MeteringService['utilRecordUsageObject']>;

beforeAll(async () => {
    server = await setupTestServer();
});

afterAll(async () => {
    await server?.shutdown();
});

const makeProvider = () => {
    const provider = new ClaudeProvider(
        server.services.metering,
        {
            fsEntry: server.stores.fsEntry,
            s3Object: server.stores.s3Object,
        },
        server.services.fs,
        { apiKey: 'test-key' },
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

const makeStreamLike = (events: unknown[], finalUsage?: unknown) => {
    // Anthropic's `messages.stream(...)` returns an object that is itself
    // both an async iterable (the events) AND has a `.finalMessage()`
    // promise. The provider awaits both.
    const iter = asAsyncIterable(events);
    return {
        [Symbol.asyncIterator]: iter[Symbol.asyncIterator].bind(iter),
        finalMessage: () =>
            Promise.resolve({
                usage: finalUsage ?? { input_tokens: 0, output_tokens: 0 },
            }),
    };
};

const makeCapturingChatStream = () => {
    const chunks: string[] = [];
    const sink = new Writable({
        write(chunk, _enc, cb) {
            chunks.push(chunk.toString('utf8'));
            cb();
        },
    });
    const chatStream = new AIChatStream({ stream: sink });
    return {
        chatStream,
        events: () =>
            chunks
                .join('')
                .split('\n')
                .filter(Boolean)
                .map((line) => JSON.parse(line)),
    };
};

beforeEach(() => {
    messagesCreateMock.mockReset();
    messagesStreamMock.mockReset();
    anthropicCtor.mockReset();
    recordSpy = vi.spyOn(server.services.metering, 'utilRecordUsageObject');
});

afterEach(() => {
    vi.restoreAllMocks();
});

// ── Construction ────────────────────────────────────────────────────

describe('ClaudeProvider construction', () => {
    it('constructs the Anthropic SDK with the configured API key and a long timeout', () => {
        makeProvider();
        expect(anthropicCtor).toHaveBeenCalledTimes(1);
        const opts = anthropicCtor.mock.calls[0]![0];
        expect(opts.apiKey).toBe('test-key');
        // ~10 minutes — long enough for slow Opus 4.7 thinking responses.
        expect(opts.timeout).toBeGreaterThan(60_000);
    });
});

// ── Model catalog ───────────────────────────────────────────────────

describe('ClaudeProvider model catalog', () => {
    it('returns claude-haiku-4-5-20251001 as the default', () => {
        const { provider } = makeProvider();
        expect(provider.getDefaultModel()).toBe('claude-haiku-4-5-20251001');
    });

    it('exposes the static CLAUDE_MODELS list verbatim from models()', () => {
        const { provider } = makeProvider();
        expect(provider.models()).toBe(CLAUDE_MODELS);
    });

    it('list() flattens canonical ids and aliases', async () => {
        const { provider } = makeProvider();
        const ids = await provider.list();
        for (const m of CLAUDE_MODELS) {
            expect(ids).toContain(m.id);
            for (const a of m.aliases ?? []) {
                expect(ids).toContain(a);
            }
        }
        expect(ids).toContain('claude-haiku');
        expect(ids).toContain('claude-haiku-4-5-20251001');
    });
});

// ── Request shape (Anthropic-specific) ──────────────────────────────

describe('ClaudeProvider.complete request shape', () => {
    const baseResponse = {
        content: [{ type: 'text', text: 'hi' }],
        usage: { input_tokens: 1, output_tokens: 1 },
    };

    it('forwards model + messages and threads max_tokens through', async () => {
        const { provider } = makeProvider();
        messagesCreateMock.mockResolvedValueOnce(baseResponse);

        await withTestActor(() =>
            provider.complete({
                model: 'claude-haiku-4-5-20251001',
                messages: [{ role: 'user', content: 'hello' }],
                max_tokens: 256,
            }),
        );

        const [args] = messagesCreateMock.mock.calls[0]!;
        expect(args.model).toBe('claude-haiku-4-5-20251001');
        expect(args.messages).toEqual([{ role: 'user', content: 'hello' }]);
        expect(args.max_tokens).toBe(256);
        // Anthropic requires explicit tool_choice; provider locks to auto with
        // disable_parallel_tool_use=true.
        expect(args.tool_choice).toEqual({
            type: 'auto',
            disable_parallel_tool_use: true,
        });
    });

    it('extracts system messages and forwards them as the top-level `system` field', async () => {
        const { provider } = makeProvider();
        messagesCreateMock.mockResolvedValueOnce(baseResponse);

        await withTestActor(() =>
            provider.complete({
                model: 'claude-haiku-4-5-20251001',
                messages: [
                    { role: 'system', content: 'be brief' },
                    { role: 'user', content: 'hi' },
                ],
            }),
        );

        const [args] = messagesCreateMock.mock.calls[0]!;
        expect(args.system).toBeDefined();
        // Only the user message should remain in the messages array.
        expect(args.messages).toEqual([{ role: 'user', content: 'hi' }]);
    });

    it('converts OpenAI-shaped tool_calls on assistant messages into Claude tool_use content blocks', async () => {
        const { provider } = makeProvider();
        messagesCreateMock.mockResolvedValueOnce(baseResponse);

        await withTestActor(() =>
            provider.complete({
                model: 'claude-haiku-4-5-20251001',
                messages: [
                    { role: 'user', content: 'do tool call' },
                    {
                        role: 'assistant',
                        content: 'here you go',
                        tool_calls: [
                            {
                                id: 'call_1',
                                type: 'function',
                                function: {
                                    name: 'lookup',
                                    arguments: '{"q":"puter"}',
                                },
                            },
                        ],
                    } as never,
                ],
            }),
        );

        const [args] = messagesCreateMock.mock.calls[0]!;
        const assistant = args.messages[1];
        expect(assistant.role).toBe('assistant');
        // tool_calls is removed from the assistant message; content array now
        // contains the tool_use block.
        expect('tool_calls' in assistant).toBe(false);
        const toolUse = (assistant.content as Array<Record<string, unknown>>).find(
            (c) => c.type === 'tool_use',
        );
        expect(toolUse).toMatchObject({
            id: 'call_1',
            name: 'lookup',
        });
        // String arguments are JSON-parsed into a dictionary because Claude
        // requires tool_use.input to be a dict.
        expect(toolUse!.input).toEqual({ q: 'puter' });
    });

    it('converts a tool-role message with tool_call_id into a user-role tool_result block', async () => {
        const { provider } = makeProvider();
        messagesCreateMock.mockResolvedValueOnce(baseResponse);

        await withTestActor(() =>
            provider.complete({
                model: 'claude-haiku-4-5-20251001',
                messages: [
                    { role: 'user', content: 'do tool call' },
                    {
                        role: 'tool',
                        tool_call_id: 'call_1',
                        content: 'the-result',
                    } as never,
                ],
            }),
        );

        const [args] = messagesCreateMock.mock.calls[0]!;
        const last = args.messages[args.messages.length - 1];
        // Claude's tool result is a user message containing a tool_result block.
        expect(last.role).toBe('user');
        expect(last.content[0]).toEqual({
            type: 'tool_result',
            tool_use_id: 'call_1',
            content: 'the-result',
        });
    });

    it('omits temperature for opus 4.7 (rejects non-default sampling)', async () => {
        const { provider } = makeProvider();
        messagesCreateMock.mockResolvedValueOnce(baseResponse);

        await withTestActor(() =>
            provider.complete({
                model: 'claude-opus-4-7',
                messages: [{ role: 'user', content: 'hi' }],
                temperature: 0.5,
            }),
        );

        const [args] = messagesCreateMock.mock.calls[0]!;
        expect('temperature' in args).toBe(false);
    });

    it('forwards reasoning_effort as the adaptive thinking config on opus 4.7', async () => {
        const { provider } = makeProvider();
        messagesCreateMock.mockResolvedValueOnce(baseResponse);

        await withTestActor(() =>
            provider.complete({
                model: 'claude-opus-4-7',
                messages: [{ role: 'user', content: 'hi' }],
                reasoning_effort: 'high',
            } as never),
        );

        const [args] = messagesCreateMock.mock.calls[0]!;
        // Opus 4.7 uses adaptive thinking with a summarized display so users
        // still see reasoning in the stream.
        expect(args.thinking).toEqual({
            type: 'adaptive',
            display: 'summarized',
        });
    });

    it('builds an enabled thinking budget from reasoning_effort on older Sonnet models', async () => {
        const { provider } = makeProvider();
        messagesCreateMock.mockResolvedValueOnce(baseResponse);

        await withTestActor(() =>
            provider.complete({
                model: 'claude-3-7-sonnet-20250219',
                messages: [{ role: 'user', content: 'hi' }],
                reasoning_effort: 'low',
            } as never),
        );

        const [args] = messagesCreateMock.mock.calls[0]!;
        expect(args.thinking).toEqual({
            type: 'enabled',
            budget_tokens: 1024,
        });
        // Provider locks temperature=1 when thinking is enabled.
        expect(args.temperature).toBe(1);
    });
});

// ── Model resolution ────────────────────────────────────────────────

describe('ClaudeProvider model resolution', () => {
    const baseResponse = {
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 1, output_tokens: 1 },
    };

    it('resolves an alias to its canonical id', async () => {
        const { provider } = makeProvider();
        messagesCreateMock.mockResolvedValueOnce(baseResponse);

        await withTestActor(() =>
            provider.complete({
                // claude-haiku is an alias of claude-haiku-4-5-20251001.
                model: 'claude-haiku',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

        expect(messagesCreateMock.mock.calls[0]![0].model).toBe(
            'claude-haiku-4-5-20251001',
        );
        expect(recordSpy).toHaveBeenCalledWith(
            expect.any(Object),
            expect.anything(),
            'claude:claude-haiku-4-5-20251001',
            expect.any(Object),
        );
    });

    it('falls back to the default model when given an unknown id', async () => {
        const { provider } = makeProvider();
        messagesCreateMock.mockResolvedValueOnce(baseResponse);

        await withTestActor(() =>
            provider.complete({
                model: 'totally-not-a-real-model',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

        expect(messagesCreateMock.mock.calls[0]![0].model).toBe(
            'claude-haiku-4-5-20251001',
        );
    });
});

// ── Non-stream completion ───────────────────────────────────────────

describe('ClaudeProvider.complete non-stream output', () => {
    it('returns the message verbatim and meters input/output/cache token costs', async () => {
        const { provider } = makeProvider();
        const msg = {
            content: [{ type: 'text', text: 'hi there' }],
            usage: {
                input_tokens: 100,
                output_tokens: 50,
                cache_creation_input_tokens: 5,
                cache_read_input_tokens: 10,
            },
        };
        messagesCreateMock.mockResolvedValueOnce(msg);

        const result = (await withTestActor(() =>
            provider.complete({
                model: 'claude-haiku-4-5-20251001',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        )) as { message: typeof msg; usage: Record<string, number> };

        expect(result.message).toBe(msg);
        expect(result.usage.input_tokens).toBe(100);
        expect(result.usage.output_tokens).toBe(50);
        expect(result.usage.ephemeral_5m_input_tokens).toBe(5);
        expect(result.usage.cache_read_input_tokens).toBe(10);

        // claude-haiku-4-5-20251001 costs from the model row.
        const haiku = CLAUDE_MODELS.find(
            (m) => m.id === 'claude-haiku-4-5-20251001',
        )!;
        expect(recordSpy).toHaveBeenCalledTimes(1);
        const [usage, actor, prefix, overrides] = recordSpy.mock.calls[0]!;
        expect(actor).toBe(SYSTEM_ACTOR);
        expect(prefix).toBe('claude:claude-haiku-4-5-20251001');
        expect(usage.input_tokens).toBe(100);
        expect(overrides.input_tokens).toBe(
            100 * Number(haiku.costs.input_tokens),
        );
        expect(overrides.output_tokens).toBe(
            50 * Number(haiku.costs.output_tokens),
        );
        expect(overrides.cache_read_input_tokens).toBe(
            10 * Number(haiku.costs.cache_read_input_tokens),
        );
    });
});

// ── Streaming deltas ────────────────────────────────────────────────

describe('ClaudeProvider.complete streaming', () => {
    it('streams text_delta events as text and meters usage from message_delta + finalMessage', async () => {
        const { provider } = makeProvider();
        messagesStreamMock.mockReturnValueOnce(
            makeStreamLike(
                [
                    { type: 'message_start' },
                    {
                        type: 'content_block_start',
                        content_block: { type: 'text' },
                    },
                    {
                        type: 'content_block_delta',
                        delta: { type: 'text_delta', text: 'hel' },
                    },
                    {
                        type: 'content_block_delta',
                        delta: { type: 'text_delta', text: 'lo' },
                    },
                    { type: 'content_block_stop' },
                    {
                        type: 'message_delta',
                        usage: { input_tokens: 4, output_tokens: 2 },
                    },
                    { type: 'message_stop' },
                ],
                { input_tokens: 4, output_tokens: 2 },
            ),
        );

        const result = await withTestActor(() =>
            provider.complete({
                model: 'claude-haiku-4-5-20251001',
                messages: [{ role: 'user', content: 'say hi' }],
                stream: true,
            }),
        );
        expect((result as { stream: boolean }).stream).toBe(true);

        const harness = makeCapturingChatStream();
        await (
            result as {
                init_chat_stream: (p: { chatStream: unknown }) => Promise<void>;
            }
        ).init_chat_stream({ chatStream: harness.chatStream });

        const events = harness.events();
        const textEvents = events.filter((e) => e.type === 'text');
        expect(textEvents.map((e) => e.text)).toEqual(['hel', 'lo']);

        // Metering uses the finalMessage usage shape (input_tokens, output_tokens).
        const haiku = CLAUDE_MODELS.find(
            (m) => m.id === 'claude-haiku-4-5-20251001',
        )!;
        expect(recordSpy).toHaveBeenCalledTimes(1);
        const [, , prefix, overrides] = recordSpy.mock.calls[0]!;
        expect(prefix).toBe('claude:claude-haiku-4-5-20251001');
        expect(overrides.input_tokens).toBe(
            4 * Number(haiku.costs.input_tokens),
        );
        expect(overrides.output_tokens).toBe(
            2 * Number(haiku.costs.output_tokens),
        );
    });

    it('builds a tool_use block from content_block_start + input_json_delta + content_block_stop', async () => {
        const { provider } = makeProvider();
        messagesStreamMock.mockReturnValueOnce(
            makeStreamLike(
                [
                    { type: 'message_start' },
                    {
                        type: 'content_block_start',
                        content_block: {
                            type: 'tool_use',
                            id: 'call_1',
                            name: 'lookup',
                        },
                    },
                    {
                        type: 'content_block_delta',
                        delta: {
                            type: 'input_json_delta',
                            partial_json: '{"q":',
                        },
                    },
                    {
                        type: 'content_block_delta',
                        delta: {
                            type: 'input_json_delta',
                            partial_json: '"puter"}',
                        },
                    },
                    { type: 'content_block_stop' },
                    {
                        type: 'message_delta',
                        usage: { input_tokens: 1, output_tokens: 1 },
                    },
                    { type: 'message_stop' },
                ],
                { input_tokens: 1, output_tokens: 1 },
            ),
        );

        const result = await withTestActor(() =>
            provider.complete({
                model: 'claude-haiku-4-5-20251001',
                messages: [{ role: 'user', content: 'do tool call' }],
                stream: true,
            }),
        );

        const harness = makeCapturingChatStream();
        await (
            result as {
                init_chat_stream: (p: { chatStream: unknown }) => Promise<void>;
            }
        ).init_chat_stream({ chatStream: harness.chatStream });

        const events = harness.events();
        const toolEvent = events.find((e) => e.type === 'tool_use');
        expect(toolEvent).toBeDefined();
        expect(toolEvent?.id).toBe('call_1');
        expect(toolEvent?.name).toBe('lookup');
        expect(toolEvent?.input).toEqual({ q: 'puter' });
    });
});

// ── Moderation ──────────────────────────────────────────────────────

describe('ClaudeProvider.checkModeration', () => {
    it('throws — Claude provider does not implement moderation', () => {
        const { provider } = makeProvider();
        expect(() => provider.checkModeration('anything')).toThrow(
            /not provided by claude/i,
        );
    });
});
