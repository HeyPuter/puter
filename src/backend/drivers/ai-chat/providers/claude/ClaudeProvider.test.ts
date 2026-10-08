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

import { v4 as uuidv4 } from 'uuid';

import type { Actor } from '../../../../core/actor.js';
import { Context } from '../../../../core/context.js';
import { SYSTEM_ACTOR } from '../../../../core/actor.js';
import type { MeteringService } from '../../../../services/metering/MeteringService.js';
import { PuterServer } from '../../../../server.js';
import { setupTestServer } from '../../../../testUtil.js';
import { generateDefaultFsentries } from '../../../../util/userProvisioning.js';
import { withTestActor } from '../../../integrationTestUtil.js';
import { AIChatStream } from '../../utils/Streaming.js';
import { FILES_API_BETA } from './fileUpload.js';
import { CLAUDE_MODELS } from './models.js';
import { ClaudeProvider } from './ClaudeProvider.js';

// ── Anthropic SDK mock ──────────────────────────────────────────────

const {
    messagesCreateMock,
    messagesStreamMock,
    countTokensMock,
    anthropicCtor,
    filesUploadMock,
    filesDeleteMock,
} = vi.hoisted(() => ({
    messagesCreateMock: vi.fn(),
    messagesStreamMock: vi.fn(),
    countTokensMock: vi.fn(),
    anthropicCtor: vi.fn(),
    filesUploadMock: vi.fn(),
    filesDeleteMock: vi.fn(),
}));

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
            files: { upload: filesUploadMock, delete: filesDeleteMock },
            messages: {
                create: messagesCreateMock,
                stream: messagesStreamMock,
                countTokens: countTokensMock,
            },
        };
    });
    return {
        default: Anthropic,
        toFile: async (data: unknown, filename: string) => ({
            data,
            filename,
        }),
    };
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
    // an async iterable (the events), has a `.withResponse()` promise that
    // settles once the upstream accepts the request, AND has a
    // `.finalMessage()` promise. The provider awaits all three.
    const iter = asAsyncIterable(events);
    return {
        [Symbol.asyncIterator]: iter[Symbol.asyncIterator].bind(iter),
        withResponse: () => Promise.resolve({}),
        finalMessage: () =>
            Promise.resolve({
                usage: finalUsage ?? { input_tokens: 0, output_tokens: 0 },
            }),
    };
};

/**
 * A user with one real FS entry, for the `puter_path` upload branch. Only the
 * Files API calls are stubbed; the read goes through the wired FSService.
 */
const makeUserWithFile = async () => {
    const username = `clsp-${Math.random().toString(36).slice(2, 10)}`;
    const created = await server.stores.user.create({
        username,
        uuid: uuidv4(),
        password: null,
        email: `${username}@test.local`,
        free_storage: 100 * 1024 * 1024,
        requires_email_confirmation: false,
    });
    await generateDefaultFsentries(
        server.clients.db,
        server.stores.user,
        created,
    );
    const user = (await server.stores.user.getById(created.id))!;
    const actor = {
        user: {
            id: user.id,
            uuid: user.uuid,
            username: user.username,
            email: user.email ?? null,
            email_confirmed: true,
        } as Actor['user'],
    };
    const path = `/${username}/Documents/pic.png`;
    await withTestActor(
        () =>
            server.services.fs.write(user.id, {
                fileMetadata: { path, size: 4, contentType: 'image/png' },
                fileContent: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
            }),
        actor,
    );
    return { actor, path };
};

const makeCapturingChatStream = (opts: { streamToolInput?: boolean } = {}) => {
    const chunks: string[] = [];
    const sink = new Writable({
        write(chunk, _enc, cb) {
            chunks.push(chunk.toString('utf8'));
            cb();
        },
    });
    const chatStream = new AIChatStream({ stream: sink, ...opts });
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
    countTokensMock.mockReset();
    anthropicCtor.mockReset();
    filesUploadMock.mockReset();
    filesDeleteMock.mockReset();
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
    it('lists Haiku 5.5 with its context, output, and long-prompt pricing', () => {
        const { provider } = makeProvider();
        expect(
            provider.models().find((model) => model.id === 'claude-haiku-5-5'),
        ).toMatchObject({
            release_date: '2026-10-07',
            knowledge: '2026-06',
            context: 1_000_000,
            max_tokens: 128_000,
            modalities: { input: ['text', 'image', 'pdf'], output: ['text'] },
            tool_call: true,
            long_context_pricing: {
                threshold: 100_000,
                input_multiplier: 5,
                output_multiplier: 5,
            },
        });
    });

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

    it('caps claude-sonnet-4-6 output at its 128K sync limit', () => {
        const { provider } = makeProvider();
        expect(
            provider.models().find((m) => m.id === 'claude-sonnet-4-6')
                ?.max_tokens,
        ).toBe(128_000);
    });

    it('drops the deprecated claude-sonnet-4-5 and its aliases', async () => {
        const { provider } = makeProvider();
        const ids = await provider.list();
        expect(ids).not.toContain('claude-sonnet-4-5-20250929');
        expect(ids).not.toContain('claude-sonnet-4-5');
        expect(ids).not.toContain('claude-sonnet-4.5');
    });
});

// ── Request shape (Anthropic-specific) ──────────────────────────────

describe('ClaudeProvider.complete request shape', () => {
    const baseResponse = {
        content: [{ type: 'text', text: 'hi' }],
        usage: { input_tokens: 1, output_tokens: 1 },
    };

    it.each([false, true])(
        'passes cancellation to the SDK with stream=%s',
        async (stream) => {
            const { provider } = makeProvider();
            const abort = new AbortController();
            if (stream)
                messagesStreamMock.mockReturnValueOnce(makeStreamLike([]));
            else messagesCreateMock.mockResolvedValueOnce(baseResponse);
            await withTestActor(() => {
                Context.set('abortSignal', abort.signal);
                return provider.complete({
                    model: 'claude-sonnet-4-6',
                    messages: [{ role: 'user', content: 'hi' }],
                    stream,
                });
            });
            const sdk = stream ? messagesStreamMock : messagesCreateMock;
            expect(sdk.mock.calls[0][1]?.signal).toBe(abort.signal);
        },
    );

    it.each([
        [
            'a Files API image',
            { type: 'image', source: { type: 'file', file_id: 'file_x' } },
        ],
        [
            'a file nested in a document content source',
            {
                type: 'document',
                source: {
                    type: 'content',
                    content: [
                        {
                            type: 'image',
                            source: { type: 'file', file_id: 'file_x' },
                        },
                    ],
                },
            },
        ],
        [
            'a file inside tool_result content',
            {
                type: 'tool_result',
                tool_use_id: 'toolu_1',
                content: [
                    {
                        type: 'document',
                        source: { type: 'file', file_id: 'file_x' },
                    },
                ],
            },
        ],
        ['a container upload', { type: 'container_upload', file_id: 'file_x' }],
    ])('rejects %s before calling upstream', async (_label, block) => {
        const { provider } = makeProvider();
        await expect(
            withTestActor(() =>
                provider.complete({
                    model: 'claude-haiku-4-5-20251001',
                    messages: [{ role: 'user', content: [block] }],
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
        expect(messagesCreateMock).not.toHaveBeenCalled();
    });

    it('never forwards mcp_servers — sdkParams is an explicit field list', async () => {
        const { provider } = makeProvider();
        messagesCreateMock.mockResolvedValueOnce(baseResponse);

        await withTestActor(() =>
            provider.complete({
                model: 'claude-haiku-4-5-20251001',
                messages: [{ role: 'user', content: 'hi' }],
                mcp_servers: [{ type: 'url', url: 'https://evil.example' }],
            } as never),
        );

        const [args] = messagesCreateMock.mock.calls[0]!;
        expect('mcp_servers' in args).toBe(false);
    });

    it('leaves tool_use arguments that merely look like a file block alone', async () => {
        const { provider } = makeProvider();
        messagesCreateMock.mockResolvedValueOnce(baseResponse);
        await withTestActor(() =>
            provider.complete({
                model: 'claude-haiku-4-5-20251001',
                messages: [
                    { role: 'user', content: 'go' },
                    {
                        role: 'assistant',
                        content: [
                            {
                                type: 'tool_use',
                                id: 'toolu_1',
                                name: 'attach',
                                input: {
                                    type: 'image',
                                    source: { type: 'file', file_id: 'x' },
                                },
                            },
                        ],
                    },
                    {
                        role: 'user',
                        content: [
                            {
                                type: 'tool_result',
                                tool_use_id: 'toolu_1',
                                content: 'ok',
                            },
                        ],
                    },
                ],
            }),
        );
        expect(messagesCreateMock).toHaveBeenCalledTimes(1);
    });

    it('translates canonical image_url parts into url-source image blocks without touching the caller\'s parts', async () => {
        const { provider } = makeProvider();
        messagesCreateMock.mockResolvedValueOnce(baseResponse);

        const imagePart = {
            type: 'image_url',
            image_url: { url: 'https://cdn.test/doge.jpeg', detail: 'low' },
            cache_control: { type: 'ephemeral' },
        };
        const message = {
            role: 'user',
            content: [{ type: 'text', text: 'What do you see?' }, imagePart],
        };
        await withTestActor(() =>
            provider.complete({
                model: 'claude-haiku-4-5-20251001',
                messages: [message],
            }),
        );

        const [args] = messagesCreateMock.mock.calls[0]!;
        expect(args.messages[0].content).toEqual([
            { type: 'text', text: 'What do you see?' },
            {
                type: 'image',
                source: { type: 'url', url: 'https://cdn.test/doge.jpeg' },
                cache_control: { type: 'ephemeral' },
            },
        ]);
        // The driver hands these same objects to the next route on fallback;
        // an OpenAI-format reseller cannot read an Anthropic image block.
        expect(imagePart).toEqual({
            type: 'image_url',
            image_url: { url: 'https://cdn.test/doge.jpeg', detail: 'low' },
            cache_control: { type: 'ephemeral' },
        });
        expect(message.content[1]).toBe(imagePart);
    });

    it('translates data-URL images into base64 sources carrying the media type', async () => {
        const { provider } = makeProvider();
        messagesCreateMock.mockResolvedValueOnce(baseResponse);

        await withTestActor(() =>
            provider.complete({
                model: 'claude-haiku-4-5-20251001',
                messages: [
                    {
                        role: 'user',
                        content: [
                            // The untyped puter.js shorthand, as sent by
                            // `puter.ai.chat(prompt, file)`.
                            { image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' } },
                        ],
                    },
                ],
            }),
        );

        const [args] = messagesCreateMock.mock.calls[0]!;
        expect(args.messages[0].content).toEqual([
            {
                type: 'image',
                source: {
                    type: 'base64',
                    media_type: 'image/png',
                    data: 'iVBORw0KGgo=',
                },
            },
        ]);
    });

    it('replaces video parts with an inline note and leaves text-only messages by identity', async () => {
        const { provider } = makeProvider();
        messagesCreateMock.mockResolvedValueOnce(baseResponse);

        const textOnly = {
            role: 'user',
            content: [{ type: 'text', text: 'first' }],
        };
        // An assistant turn in between keeps the two user messages from
        // merging, so this test stays about media conversion only.
        await withTestActor(() =>
            provider.complete({
                model: 'claude-haiku-4-5-20251001',
                messages: [
                    textOnly,
                    { role: 'assistant', content: 'ok' },
                    {
                        role: 'user',
                        content: [
                            {
                                type: 'video_url',
                                video_url: { url: 'https://cdn.test/a.mp4' },
                            },
                        ],
                    },
                ],
            }),
        );

        const [args] = messagesCreateMock.mock.calls[0]!;
        expect(args.messages[0]).toBe(textOnly);
        expect(args.messages[2].content[0].type).toBe('text');
        expect(args.messages[2].content[0].text).toMatch(
            /video input is not supported/,
        );
    });

    it('merges consecutive user turns into one message, in order', async () => {
        const { provider } = makeProvider();
        messagesCreateMock.mockResolvedValueOnce(baseResponse);

        await withTestActor(() =>
            provider.complete({
                model: 'claude-haiku-4-5-20251001',
                messages: [
                    {
                        role: 'user',
                        content: [{ type: 'text', text: 'first' }],
                    },
                    {
                        role: 'user',
                        content: [{ type: 'text', text: 'second' }],
                    },
                ],
            }),
        );

        const [args] = messagesCreateMock.mock.calls[0]!;
        expect(args.messages).toEqual([
            {
                role: 'user',
                content: [
                    { type: 'text', text: 'first' },
                    { type: 'text', text: 'second' },
                ],
            },
        ]);
    });

    it('tells the driver it resolves puter_path parts itself', () => {
        const { provider } = makeProvider();
        expect(provider.resolvesPuterPaths).toBe(true);
    });

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
        // No tools means no tool_choice at all — nothing to choose
        // between.
        expect('tool_choice' in args).toBe(false);
    });

    it('locks tool_choice to auto with disable_parallel_tool_use by default once tools are present', async () => {
        const { provider } = makeProvider();
        messagesCreateMock.mockResolvedValueOnce(baseResponse);

        await withTestActor(() =>
            provider.complete({
                model: 'claude-haiku-4-5-20251001',
                messages: [{ role: 'user', content: 'hello' }],
                tools: [
                    {
                        type: 'function',
                        function: { name: 'lookup', parameters: { type: 'object' } },
                    },
                ],
            }),
        );

        const [args] = messagesCreateMock.mock.calls[0]!;
        // Legacy puter.js default: parallel tool use stays off unless the
        // caller explicitly opts in.
        expect(args.tool_choice).toEqual({
            type: 'auto',
            disable_parallel_tool_use: true,
        });
    });

    it('omits tool_choice when parallel calls are explicitly allowed and the choice is the default auto', async () => {
        const { provider } = makeProvider();
        messagesCreateMock.mockResolvedValueOnce(baseResponse);

        await withTestActor(() =>
            provider.complete({
                model: 'claude-haiku-4-5-20251001',
                messages: [{ role: 'user', content: 'hello' }],
                tools: [
                    {
                        type: 'function',
                        function: { name: 'lookup', parameters: { type: 'object' } },
                    },
                ],
                parallel_tool_calls: true,
            }),
        );

        const [args] = messagesCreateMock.mock.calls[0]!;
        expect('tool_choice' in args).toBe(false);
    });

    it('forwards a named tool_choice with disable_parallel_tool_use when parallel calls are off', async () => {
        const { provider } = makeProvider();
        messagesCreateMock.mockResolvedValueOnce(baseResponse);

        await withTestActor(() =>
            provider.complete({
                model: 'claude-haiku-4-5-20251001',
                messages: [{ role: 'user', content: 'hello' }],
                tools: [
                    {
                        type: 'function',
                        function: { name: 'lookup', parameters: { type: 'object' } },
                    },
                ],
                tool_choice: { type: 'tool', name: 'lookup' },
                parallel_tool_calls: false,
            }),
        );

        const [args] = messagesCreateMock.mock.calls[0]!;
        expect(args.tool_choice).toEqual({
            type: 'tool',
            name: 'lookup',
            disable_parallel_tool_use: true,
        });
    });

    it('never sets disable_parallel_tool_use when tool_choice is none', async () => {
        const { provider } = makeProvider();
        messagesCreateMock.mockResolvedValueOnce(baseResponse);

        await withTestActor(() =>
            provider.complete({
                model: 'claude-haiku-4-5-20251001',
                messages: [{ role: 'user', content: 'hello' }],
                tools: [
                    {
                        type: 'function',
                        function: { name: 'lookup', parameters: { type: 'object' } },
                    },
                ],
                tool_choice: { type: 'none' },
            }),
        );

        const [args] = messagesCreateMock.mock.calls[0]!;
        expect(args.tool_choice).toEqual({ type: 'none' });
    });

    it('normalizes a raw wire-form tool_choice instead of spreading it verbatim', async () => {
        const { provider } = makeProvider();
        messagesCreateMock.mockResolvedValueOnce(baseResponse);

        await withTestActor(() =>
            provider.complete({
                model: 'claude-haiku-4-5-20251001',
                messages: [{ role: 'user', content: 'hello' }],
                tools: [
                    {
                        type: 'function',
                        function: { name: 'lookup', parameters: { type: 'object' } },
                    },
                ],
                // A bare 'auto' string, as a raw `/drivers/call` caller on
                // the old OpenAI wire form would still send.
                tool_choice: 'auto' as never,
                parallel_tool_calls: false,
            }),
        );

        const [args] = messagesCreateMock.mock.calls[0]!;
        // Spreading the raw string would have produced character-indexed
        // keys ({0:'a', 1:'u', ...}) instead of a real tool_choice object.
        expect(args.tool_choice).toEqual({
            type: 'auto',
            disable_parallel_tool_use: true,
        });
    });

    it('forwards max_tokens 0 instead of substituting the model default', async () => {
        const { provider } = makeProvider();
        messagesCreateMock.mockResolvedValueOnce(baseResponse);

        await withTestActor(() =>
            provider.complete({
                model: 'claude-haiku-4-5-20251001',
                messages: [{ role: 'user', content: 'hello' }],
                max_tokens: 0,
            }),
        );

        const [args] = messagesCreateMock.mock.calls[0]!;
        expect(args.max_tokens).toBe(0);
    });

    // With no explicit max_tokens the ceiling has to come from the entry being
    // called. Deriving it from a second lookup by name-or-alias instead capped
    // at 4096 every id the catalog doesn't also list among that entry's own
    // aliases -- which is every dated id.
    it.each(CLAUDE_MODELS.map((m) => ({ id: m.id, ceiling: m.max_tokens })))(
        'defaults max_tokens to the catalog ceiling for $id',
        async ({ id, ceiling }) => {
            const { provider } = makeProvider();
            messagesCreateMock.mockResolvedValueOnce(baseResponse);

            await withTestActor(() =>
                provider.complete({
                    model: id,
                    messages: [{ role: 'user', content: 'hello' }],
                }),
            );

            const [args] = messagesCreateMock.mock.calls[0]!;
            expect(args.max_tokens).toBe(ceiling);
        },
    );

    // A name with no catalog entry is silently served by the default model,
    // so the ceiling is that entry's own — not the 4096 floor the old second
    // lookup fell back to. Unreachable through ChatCompletionDriver (which
    // rejects unknown ids), but pinned here so the fallback's cost profile
    // can't drift unnoticed for direct callers.
    it('defaults max_tokens to the default model ceiling for an unknown name', async () => {
        const { provider } = makeProvider();
        messagesCreateMock.mockResolvedValueOnce(baseResponse);

        await withTestActor(() =>
            provider.complete({
                model: 'claude-model-that-does-not-exist',
                messages: [{ role: 'user', content: 'hello' }],
            }),
        );

        const fallback = CLAUDE_MODELS.find(
            (m) => m.id === provider.getDefaultModel(),
        )!;
        const [args] = messagesCreateMock.mock.calls[0]!;
        expect(args.model).toBe(fallback.id);
        expect(args.max_tokens).toBe(fallback.max_tokens);
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

    it('splices round-tripped reasoning_details back in ahead of the content', async () => {
        // The replay contract for a normalized Claude turn: the caller resends
        // the whole message, and the thinking blocks have to reach Anthropic
        // with their signature intact and leading the content array (Anthropic
        // rejects both a missing signature and a trailing thinking block).
        const { provider } = makeProvider();
        messagesCreateMock.mockResolvedValueOnce(baseResponse);

        await withTestActor(() =>
            provider.complete({
                model: 'claude-haiku-4-5-20251001',
                messages: [
                    { role: 'user', content: 'think then call a tool' },
                    {
                        role: 'assistant',
                        content: 'here you go',
                        reasoning: 'step one',
                        refusal: null,
                        reasoning_details: [
                            {
                                type: 'thinking',
                                thinking: 'step one',
                                signature: 'sig_1',
                            },
                            { type: 'redacted_thinking', data: 'ENC' },
                        ],
                        tool_calls: [
                            {
                                id: 'call_1',
                                type: 'function',
                                function: {
                                    name: 'lookup',
                                    arguments: '{\"q\":\"puter\"}',
                                },
                            },
                        ],
                    } as never,
                ],
            }),
        );

        const [args] = messagesCreateMock.mock.calls[0]!;
        const assistant = args.messages[1] as Record<string, unknown>;
        const content = assistant.content as Array<Record<string, unknown>>;
        // Thinking blocks lead, verbatim; string content became a text block;
        // the tool_use block is appended after.
        expect(content).toEqual([
            { type: 'thinking', thinking: 'step one', signature: 'sig_1' },
            { type: 'redacted_thinking', data: 'ENC' },
            { type: 'text', text: 'here you go' },
            {
                type: 'tool_use',
                id: 'call_1',
                name: 'lookup',
                input: { q: 'puter' },
            },
        ]);
        // Output-only fields Anthropic rejects are stripped.
        expect('reasoning_details' in assistant).toBe(false);
        expect('reasoning' in assistant).toBe(false);
        expect('refusal' in assistant).toBe(false);
    });

    it('leaves the caller\'s message objects intact', async () => {
        // The driver reuses the same messages array across fallback attempts,
        // so stripping the output-only fields has to happen on a copy.
        const { provider } = makeProvider();
        messagesCreateMock.mockResolvedValueOnce(baseResponse);

        const callerMessage = Object.freeze({
            role: 'assistant',
            content: 'here you go',
            reasoning: 'step one',
            refusal: null,
            reasoning_details: Object.freeze([
                Object.freeze({
                    type: 'thinking',
                    thinking: 'step one',
                    signature: 'sig_1',
                }),
            ]),
        });
        const before = JSON.parse(JSON.stringify(callerMessage));

        // A frozen message would throw on `delete` in strict mode.
        await withTestActor(() =>
            provider.complete({
                model: 'claude-haiku-4-5-20251001',
                messages: [callerMessage as never],
            }),
        );

        expect(callerMessage).toEqual(before);
        // ...and the provider still sent the spliced content upstream.
        const [args] = messagesCreateMock.mock.calls[0]!;
        const sent = args.messages[0] as Record<string, unknown>;
        expect('reasoning_details' in sent).toBe(false);
        expect(
            (sent.content as Array<Record<string, unknown>>)[0],
        ).toMatchObject({ type: 'thinking', signature: 'sig_1' });
    });

    it('survives the same messages array being sent twice', async () => {
        // This is the fallback hazard the copy-on-write exists for: the driver
        // reuses one messages array across attempts, so if attempt 1 strips
        // `reasoning_details` in place, attempt 2 sends a message with no
        // thinking blocks and Anthropic rejects the continuation. Two
        // sequential calls over one shared array reproduce that at the
        // provider level; the real fallback loop is driven end-to-end by
        // "hands every fallback attempt the same messages array" in
        // ChatCompletionDriver.test.ts.
        const { provider } = makeProvider();
        messagesCreateMock
            .mockResolvedValueOnce(baseResponse)
            .mockResolvedValueOnce(baseResponse);

        const messages = [
            { role: 'user', content: 'think then call a tool' },
            {
                role: 'assistant',
                content: 'here you go',
                reasoning: 'step one',
                refusal: null,
                reasoning_details: [
                    {
                        type: 'thinking',
                        thinking: 'step one',
                        signature: 'sig_1',
                    },
                ],
            },
        ];
        const before = structuredClone(messages);

        await withTestActor(() =>
            provider.complete({
                model: 'claude-haiku-4-5-20251001',
                messages: messages as never,
            }),
        );
        await withTestActor(() =>
            provider.complete({
                model: 'claude-haiku-4-5-20251001',
                messages: messages as never,
            }),
        );

        // The caller's array is untouched by either attempt...
        expect(messages).toEqual(before);
        // ...so both attempts sent the thinking block with its signature.
        for (const call of messagesCreateMock.mock.calls.slice(0, 2)) {
            const sent = call[0].messages[1] as Record<string, unknown>;
            const content = sent.content as Array<Record<string, unknown>>;
            expect(content[0]).toEqual({
                type: 'thinking',
                thinking: 'step one',
                signature: 'sig_1',
            });
        }
    });

    it('strips output-only reasoning fields even with no reasoning_details', async () => {
        const { provider } = makeProvider();
        messagesCreateMock.mockResolvedValueOnce(baseResponse);

        await withTestActor(() =>
            provider.complete({
                model: 'claude-haiku-4-5-20251001',
                messages: [
                    {
                        role: 'assistant',
                        content: 'plain reply',
                        reasoning: 'leftover',
                        refusal: null,
                    } as never,
                ],
            }),
        );

        const [args] = messagesCreateMock.mock.calls[0]!;
        const assistant = args.messages[0] as Record<string, unknown>;
        expect('reasoning' in assistant).toBe(false);
        expect('refusal' in assistant).toBe(false);
        // Content is untouched when there was nothing to splice.
        expect(assistant.content).toBe('plain reply');
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

    it.each([
        'claude-fable-5-1',
        'claude-haiku-5-5',
        'claude-opus-5-5',
        'claude-sonnet-5-5',
        'claude-sonnet-5',
    ])(
        'omits temperature for %s',
        async (model) => {
            const { provider } = makeProvider();
            messagesCreateMock.mockResolvedValueOnce(baseResponse);

            await withTestActor(() =>
                provider.complete({
                    model,
                    messages: [{ role: 'user', content: 'hi' }],
                    temperature: 0.5,
                }),
            );

            const [args] = messagesCreateMock.mock.calls[0]!;
            expect('temperature' in args).toBe(false);
        },
    );

    it.each([
        'claude-fable-5-1',
        'claude-haiku-5-5',
        'claude-opus-5-5',
        'claude-sonnet-5-5',
        'claude-sonnet-5',
    ])(
        'uses adaptive thinking and output effort on %s',
        async (model) => {
            const { provider } = makeProvider();
            messagesCreateMock.mockResolvedValueOnce(baseResponse);

            await withTestActor(() =>
                provider.complete({
                    model,
                    messages: [{ role: 'user', content: 'hi' }],
                    reasoning_effort: 'high',
                } as never),
            );

            const [args] = messagesCreateMock.mock.calls[0]!;
            expect(args.thinking).toEqual({
                type: 'adaptive',
                display: 'summarized',
            });
            expect(args.output_config).toEqual({ effort: 'high' });
            expect('temperature' in args).toBe(false);
        },
    );

    it('forwards reasoning_effort as adaptive thinking + output_config effort on opus 5.5', async () => {
        const { provider } = makeProvider();
        messagesCreateMock.mockResolvedValueOnce(baseResponse);

        await withTestActor(() =>
            provider.complete({
                model: 'claude-opus-5-5',
                messages: [{ role: 'user', content: 'hi' }],
                reasoning_effort: 'low',
                temperature: 0.5,
            } as never),
        );

        const [args] = messagesCreateMock.mock.calls[0]!;
        // Opus 5.5 rejects disabled thinking, `budget_tokens`, and sampling params.
        expect(args.thinking).toEqual({
            type: 'adaptive',
            display: 'summarized',
        });
        expect(args.output_config).toEqual({ effort: 'low' });
        expect('temperature' in args).toBe(false);
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

    it('routes the bare claude-fable alias to fable 5.1 rather than fable 5', async () => {
        const { provider } = makeProvider();
        messagesCreateMock.mockResolvedValueOnce(baseResponse);

        await withTestActor(() =>
            provider.complete({
                model: 'claude-fable',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

        expect(messagesCreateMock.mock.calls[0]![0].model).toBe(
            'claude-fable-5-1',
        );
    });

    it('routes the bare claude-opus alias to opus 5.5 rather than opus 5', async () => {
        const { provider } = makeProvider();
        messagesCreateMock.mockResolvedValueOnce(baseResponse);

        await withTestActor(() =>
            provider.complete({
                model: 'claude-opus',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

        expect(messagesCreateMock.mock.calls[0]![0].model).toBe(
            'claude-opus-5-5',
        );
    });

    it('routes the bare claude-sonnet alias to sonnet 5.5 rather than sonnet 5', async () => {
        const { provider } = makeProvider();
        messagesCreateMock.mockResolvedValueOnce(baseResponse);

        await withTestActor(() =>
            provider.complete({
                model: 'claude-sonnet',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

        expect(messagesCreateMock.mock.calls[0]![0].model).toBe(
            'claude-sonnet-5-5',
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
    it.each([
        ['claude-haiku-5-5', 'claude-haiku-5-5', 10, 12.5, 20, 1, 50],
        ['anthropic/claude-haiku-5-5', 'claude-haiku-5-5', 10, 12.5, 20, 1, 50],
        ['claude-haiku-5.5', 'claude-haiku-5-5', 10, 12.5, 20, 1, 50],
        ['claude-haiku-5-5-latest', 'claude-haiku-5-5', 10, 12.5, 20, 1, 50],
        ['claude-opus-5-5', 'claude-opus-5-5', 400, 500, 800, 20, 2000],
        [
            'anthropic/claude-opus-5-5',
            'claude-opus-5-5',
            400,
            500,
            800,
            20,
            2000,
        ],
        ['claude-opus', 'claude-opus-5-5', 400, 500, 800, 20, 2000],
        ['claude-opus-latest', 'claude-opus-5-5', 400, 500, 800, 20, 2000],
        ['claude-opus-5-latest', 'claude-opus-5', 500, 625, 1000, 50, 2500],
        ['claude-sonnet-5-5', 'claude-sonnet-5-5', 200, 250, 400, 10, 1000],
        ['claude-sonnet', 'claude-sonnet-5-5', 200, 250, 400, 10, 1000],
        ['claude-sonnet-latest', 'claude-sonnet-5-5', 200, 250, 400, 10, 1000],
        ['claude-sonnet-5', 'claude-sonnet-5', 200, 250, 400, 20, 1000],
    ])(
        'resolves and meters %s at its current rates',
        async (model, canonicalId, input, write5m, write1h, cached, output) => {
            const { provider } = makeProvider();
            messagesCreateMock.mockResolvedValueOnce({
                content: [{ type: 'text', text: 'ok' }],
                usage: {
                    input_tokens: 100,
                    output_tokens: 50,
                    cache_creation_input_tokens: 30,
                    cache_creation: {
                        ephemeral_5m_input_tokens: 10,
                        ephemeral_1h_input_tokens: 20,
                    },
                    cache_read_input_tokens: 1000,
                },
            });
            await withTestActor(() =>
                provider.complete({
                    model,
                    messages: [{ role: 'user', content: 'hi' }],
                }),
            );
            expect(await provider.list()).toContain(model);
            const [args] = messagesCreateMock.mock.calls[0]!;
            expect(args.model).toBe(canonicalId);
            expect(args.max_tokens).toBe(128_000);
            const [, , prefix, overrides] = recordSpy.mock.calls[0]!;
            expect(prefix).toBe(`claude:${canonicalId}`);
            expect(overrides).toMatchObject({
                input_tokens: 100 * Number(input),
                output_tokens: 50 * Number(output),
                ephemeral_5m_input_tokens: 10 * Number(write5m),
                ephemeral_1h_input_tokens: 20 * Number(write1h),
                cache_read_input_tokens: 1000 * Number(cached),
            });
        },
    );

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

    it('reports finish_reason "stop" on the wire even for a tool_use stop, with the real reason in stopReason', async () => {
        const { provider } = makeProvider();
        const msg = {
            content: [
                { type: 'tool_use', id: 'tu_1', name: 'lookup', input: {} },
            ],
            stop_reason: 'tool_use',
            usage: { input_tokens: 10, output_tokens: 5 },
        };
        messagesCreateMock.mockResolvedValueOnce(msg);

        const result = (await withTestActor(() =>
            provider.complete({
                model: 'claude-haiku-4-5-20251001',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        )) as { finish_reason: string; stopReason: string };

        expect(result.finish_reason).toBe('stop');
        expect(result.stopReason).toBe('tool_use');
    });

    it('meters fable 5.1 cache reads at its reduced rate, not the 0.1x used elsewhere', async () => {
        const { provider } = makeProvider();
        messagesCreateMock.mockResolvedValueOnce({
            content: [{ type: 'text', text: 'ok' }],
            usage: {
                input_tokens: 100,
                output_tokens: 50,
                cache_read_input_tokens: 1000,
            },
        });

        await withTestActor(() =>
            provider.complete({
                model: 'claude-fable-5-1',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

        const fable51 = CLAUDE_MODELS.find((m) => m.id === 'claude-fable-5-1')!;
        const fable5 = CLAUDE_MODELS.find((m) => m.id === 'claude-fable-5')!;
        // Same per-token price as Fable 5 except cache reads at a quarter of the rate.
        expect(fable51.costs.input_tokens).toBe(fable5.costs.input_tokens);
        expect(fable51.costs.output_tokens).toBe(fable5.costs.output_tokens);
        expect(Number(fable51.costs.cache_read_input_tokens)).toBeCloseTo(
            Number(fable5.costs.cache_read_input_tokens) / 4,
        );

        const [, , prefix, overrides] = recordSpy.mock.calls[0]!;
        expect(prefix).toBe('claude:claude-fable-5-1');
        expect(overrides.input_tokens).toBe(
            100 * Number(fable51.costs.input_tokens),
        );
        expect(overrides.output_tokens).toBe(
            50 * Number(fable51.costs.output_tokens),
        );
        expect(overrides.cache_read_input_tokens).toBeCloseTo(
            1000 * Number(fable51.costs.cache_read_input_tokens),
        );
    });

    it('bills the compaction pass by summing usage.iterations', async () => {
        const { provider } = makeProvider();
        // Per Anthropic: top-level input/output reflect only the message pass;
        // the compaction pass lives in `iterations` and must be summed to bill.
        const msg = {
            content: [{ type: 'text', text: 'done' }],
            usage: {
                input_tokens: 23000, // message pass only (NOT the total)
                output_tokens: 1000,
                iterations: [
                    {
                        type: 'compaction',
                        input_tokens: 180000,
                        output_tokens: 3500,
                    },
                    { type: 'message', input_tokens: 23000, output_tokens: 1000 },
                ],
            },
        };
        messagesCreateMock.mockResolvedValueOnce(msg);

        const result = (await withTestActor(() =>
            provider.complete({
                model: 'claude-haiku-4-5-20251001',
                messages: [{ role: 'user', content: 'hi' }],
                compaction: true,
            }),
        )) as { usage: Record<string, number> };

        // Totals are the SUM across iterations, not the top-level fields.
        expect(result.usage.input_tokens).toBe(203000); // 180000 + 23000
        expect(result.usage.output_tokens).toBe(4500); // 3500 + 1000
        // The reported breakdown mirrors upstream: top-level plus the passes.
        const details = (
            result as unknown as {
                usageDetails: { inputTokens: number; iterations: unknown[] };
            }
        ).usageDetails;
        expect(details.inputTokens).toBe(23000);
        expect(details.iterations).toHaveLength(2);

        const haiku = CLAUDE_MODELS.find(
            (m) => m.id === 'claude-haiku-4-5-20251001',
        )!;
        const [usage, , , overrides] = recordSpy.mock.calls[0]!;
        expect(usage.input_tokens).toBe(203000);
        expect(overrides.input_tokens).toBe(
            203000 * Number(haiku.costs.input_tokens),
        );
        expect(overrides.output_tokens).toBe(
            4500 * Number(haiku.costs.output_tokens),
        );
    });
});

// ── Streaming deltas ────────────────────────────────────────────────

describe('ClaudeProvider.complete streaming', () => {
    it.each([99_999, 100_000, 100_001])(
        'meters Haiku 5.5 at %s prompt tokens with cached input and a flat search fee',
        async (promptTokens) => {
            const { provider } = makeProvider();
            const usage = {
                input_tokens: promptTokens - 90_000,
                output_tokens: 50,
                cache_creation_input_tokens: 30_000,
                cache_creation: {
                    ephemeral_5m_input_tokens: 10_000,
                    ephemeral_1h_input_tokens: 20_000,
                },
                cache_read_input_tokens: 60_000,
                server_tool_use: { web_search_requests: 1 },
            };
            for (const stream of [false, true]) {
                if (stream) {
                    messagesStreamMock.mockReturnValueOnce(
                        makeStreamLike([], usage),
                    );
                } else {
                    messagesCreateMock.mockResolvedValueOnce({
                        content: [{ type: 'text', text: 'hi' }],
                        usage,
                    });
                }
                const result = await withTestActor(() =>
                    provider.complete({
                        model: 'claude-haiku-5-5',
                        messages: [{ role: 'user', content: 'hi' }],
                        stream,
                    }),
                );
                if (stream) {
                    const { chatStream } = makeCapturingChatStream();
                    await withTestActor(() =>
                        (
                            result as {
                                init_chat_stream: (params: {
                                    chatStream: AIChatStream;
                                }) => Promise<void>;
                            }
                        ).init_chat_stream({ chatStream }),
                    );
                }
                const multiplier = promptTokens > 100_000 ? 5 : 1;
                expect(recordSpy.mock.lastCall).toEqual([
                    {
                        input_tokens: promptTokens - 90_000,
                        output_tokens: 50,
                        ephemeral_5m_input_tokens: 10_000,
                        ephemeral_1h_input_tokens: 20_000,
                        cache_read_input_tokens: 60_000,
                        web_search_requests: 1,
                    },
                    SYSTEM_ACTOR,
                    'claude:claude-haiku-5-5',
                    {
                        input_tokens: (promptTokens - 90_000) * 10 * multiplier,
                        output_tokens: 50 * 50 * multiplier,
                        ephemeral_5m_input_tokens: 10_000 * 12.5 * multiplier,
                        ephemeral_1h_input_tokens: 20_000 * 20 * multiplier,
                        cache_read_input_tokens: 60_000 * multiplier,
                        web_search_requests: 1_000_000,
                    },
                ]);
            }
        },
    );

    it('rejects from complete() when the upstream refuses the stream, so the driver can fall back', async () => {
        const { provider } = makeProvider();
        const refused = Object.assign(new Error('Overloaded'), {
            status: 529,
        });
        messagesStreamMock.mockReturnValueOnce({
            ...makeStreamLike([]),
            withResponse: () => Promise.reject(refused),
        });

        // Thrown here, before a populator exists — a populator that failed
        // later would already have a 200 on the wire.
        await expect(
            withTestActor(() =>
                provider.complete({
                    model: 'claude-haiku-4-5-20251001',
                    messages: [{ role: 'user', content: 'say hi' }],
                    stream: true,
                }),
            ),
        ).rejects.toBe(refused);
    });

    it('deletes the uploaded files and hands back the puter_path when the stream is refused', async () => {
        const { provider } = makeProvider();
        const { actor, path } = await makeUserWithFile();
        filesUploadMock.mockResolvedValue({ id: 'file_stream_1' });
        const refused = Object.assign(new Error('Overloaded'), {
            status: 529,
        });
        messagesStreamMock.mockReturnValueOnce({
            ...makeStreamLike([]),
            withResponse: () => Promise.reject(refused),
        });

        const part: Record<string, unknown> = { puter_path: path };
        await expect(
            withTestActor(
                () =>
                    provider.complete({
                        model: 'claude-haiku-4-5-20251001',
                        messages: [{ role: 'user', content: [part] }],
                        stream: true,
                    }),
                actor,
            ),
        ).rejects.toBe(refused);

        expect(filesUploadMock).toHaveBeenCalledTimes(1);
        expect(filesDeleteMock).toHaveBeenCalledWith('file_stream_1', {
            betas: [FILES_API_BETA],
        });
        // The driver reuses this object on the fallback route, which has no
        // way to resolve a file we just deleted from our own account.
        expect(part).toEqual({ puter_path: path });
    });

    it('surfaces a failure the event iterator swallowed instead of ending the stream clean', async () => {
        const { provider } = makeProvider();
        const dropped = Object.assign(new Error('Overloaded'), {
            status: 529,
        });
        // The SDK hands an error only to a reader already waiting on it; one
        // that lands earlier leaves the iterator reporting a plain end of
        // stream, so `errored` is the only thing left to go on.
        messagesStreamMock.mockReturnValueOnce({
            ...makeStreamLike([
                { type: 'message_start' },
                {
                    type: 'content_block_start',
                    content_block: { type: 'text' },
                },
                {
                    type: 'content_block_delta',
                    delta: { type: 'text_delta', text: 'half an ans' },
                },
            ]),
            errored: true,
            finalMessage: () => Promise.reject(dropped),
        });

        const result = await withTestActor(() =>
            provider.complete({
                model: 'claude-haiku-4-5-20251001',
                messages: [{ role: 'user', content: 'say hi' }],
                stream: true,
            }),
        );

        const harness = makeCapturingChatStream();
        await expect(
            (
                result as {
                    init_chat_stream: (p: {
                        chatStream: unknown;
                    }) => Promise<void>;
                }
            ).init_chat_stream({ chatStream: harness.chatStream }),
        ).rejects.toBe(dropped);

        // A truncated response reported as a success would also have been
        // billed for the tokens it did produce.
        expect(recordSpy).not.toHaveBeenCalled();
    });

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

// ── Inline compaction ───────────────────────────────────────────────

describe('ClaudeProvider.complete compaction', () => {
    it('translates the neutral opt-in to context_management + the compaction beta', async () => {
        const { provider } = makeProvider();
        messagesCreateMock.mockResolvedValueOnce({
            content: [{ type: 'text', text: 'hi' }],
            usage: { input_tokens: 1, output_tokens: 1 },
        });

        await withTestActor(() =>
            provider.complete({
                model: 'claude-haiku-4-5-20251001',
                messages: [{ role: 'user', content: 'hi' }],
                compaction: { trigger_tokens: 50000 },
            }),
        );

        const [args] = messagesCreateMock.mock.calls[0]!;
        expect(args.context_management).toEqual({
            edits: [
                {
                    type: 'compact_20260112',
                    trigger: { type: 'input_tokens', value: 50000 },
                },
            ],
        });
        expect(args.betas).toContain('compact-2026-01-12');
    });

    it('emits a canonical compaction event from a streamed compaction block', async () => {
        const { provider } = makeProvider();
        messagesStreamMock.mockReturnValueOnce(
            makeStreamLike(
                [
                    { type: 'message_start' },
                    {
                        type: 'content_block_start',
                        content_block: {
                            type: 'compaction',
                            id: 'cmpct_1',
                            content: 'ENC', // Anthropic carries the summary here
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
                messages: [{ role: 'user', content: 'hi' }],
                stream: true,
                compaction: true,
            }),
        );
        const harness = makeCapturingChatStream();
        await (
            result as {
                init_chat_stream: (p: { chatStream: unknown }) => Promise<void>;
            }
        ).init_chat_stream({ chatStream: harness.chatStream });

        const compaction = harness
            .events()
            .find((e) => e.type === 'compaction');
        expect(compaction).toEqual({
            type: 'compaction',
            id: 'cmpct_1',
            encrypted_content: 'ENC',
        });
    });

    it('emits a compaction streamed through compaction_delta at its own position, before later text', async () => {
        const { provider } = makeProvider();
        messagesStreamMock.mockReturnValueOnce(
            makeStreamLike([
                { type: 'message_start' },
                {
                    type: 'content_block_start',
                    index: 0,
                    content_block: { type: 'compaction', content: null },
                },
                {
                    type: 'content_block_delta',
                    index: 0,
                    delta: {
                        type: 'compaction_delta',
                        content: 'SUMMARY',
                        encrypted_content: 'OPAQUE',
                    },
                },
                { type: 'content_block_stop', index: 0 },
                {
                    type: 'content_block_start',
                    index: 1,
                    content_block: { type: 'text', text: '' },
                },
                {
                    type: 'content_block_delta',
                    index: 1,
                    delta: { type: 'text_delta', text: 'after' },
                },
                { type: 'content_block_stop', index: 1 },
                { type: 'message_stop' },
            ]),
        );

        const result = await withTestActor(() =>
            provider.complete({
                model: 'claude-haiku-4-5-20251001',
                messages: [{ role: 'user', content: 'hi' }],
                stream: true,
                compaction: true,
            }),
        );
        const harness = makeCapturingChatStream();
        await (
            result as {
                init_chat_stream: (p: { chatStream: unknown }) => Promise<void>;
            }
        ).init_chat_stream({ chatStream: harness.chatStream });

        const types = harness
            .events()
            .map((e) => e.type)
            .filter((t) => t === 'compaction' || t === 'text');
        expect(types).toEqual(['compaction', 'text']);
        expect(
            harness.events().find((e) => e.type === 'compaction')
                ?.encrypted_content,
        ).toBe('SUMMARY');
    });

    it('enables the compaction beta when a round-tripped compaction block is resent (no opt-in)', async () => {
        const { provider } = makeProvider();
        messagesCreateMock.mockResolvedValueOnce({
            content: [{ type: 'text', text: 'ok' }],
            usage: { input_tokens: 1, output_tokens: 1 },
        });

        await withTestActor(() =>
            provider.complete({
                model: 'claude-haiku-4-5-20251001',
                messages: [
                    { role: 'user', content: 'continue' },
                    {
                        role: 'assistant',
                        content: [
                            {
                                type: 'compaction',
                                id: 'cmpct_1',
                                encrypted_content: 'ENC',
                            },
                        ],
                    },
                ],
                // note: no `compaction`/`context_management` opt-in
            }),
        );

        const [args] = messagesCreateMock.mock.calls[0]!;
        expect(args.betas).toContain('compact-2026-01-12');
        // No new compaction was requested, so no context_management is sent.
        expect(args.context_management).toBeUndefined();
    });

    it('surfaces a compaction block from a non-streaming response as result.compaction', async () => {
        const { provider } = makeProvider();
        messagesCreateMock.mockResolvedValueOnce({
            content: [
                { type: 'text', text: 'done' },
                {
                    type: 'compaction',
                    id: 'cmpct_2',
                    content: 'ENC2', // Anthropic carries the summary here
                },
            ],
            usage: { input_tokens: 1, output_tokens: 1 },
        });

        const result = (await withTestActor(() =>
            provider.complete({
                model: 'claude-haiku-4-5-20251001',
                messages: [{ role: 'user', content: 'hi' }],
                compaction: true,
            }),
        )) as { compaction?: { id?: string; encrypted_content: string } };

        // Anthropic's `content` is surfaced under the unified `encrypted_content`.
        expect(result.compaction).toEqual({
            type: 'compaction',
            id: 'cmpct_2',
            encrypted_content: 'ENC2',
        });
    });

    it('maps a round-tripped compaction block back to Anthropic `content` on input', async () => {
        const { provider } = makeProvider();
        messagesCreateMock.mockResolvedValueOnce({
            content: [{ type: 'text', text: 'ok' }],
            usage: { input_tokens: 1, output_tokens: 1 },
        });

        await withTestActor(() =>
            provider.complete({
                model: 'claude-haiku-4-5-20251001',
                messages: [
                    { role: 'user', content: 'continue' },
                    {
                        role: 'assistant',
                        content: [
                            { type: 'compaction', encrypted_content: 'SUMMARY' },
                        ],
                    },
                ],
            }),
        );

        const [args] = messagesCreateMock.mock.calls[0]!;
        const compactionBlock = args.messages
            .flatMap((m: { content?: unknown[] }) =>
                Array.isArray(m.content) ? m.content : [],
            )
            .find((c: { type?: string }) => c?.type === 'compaction');
        // Internal `encrypted_content` carrier → Anthropic native `content`.
        expect(compactionBlock).toEqual({
            type: 'compaction',
            content: 'SUMMARY',
        });
    });

    it('preserves the reply text when an assistant turn carries compaction + text', async () => {
        const { provider } = makeProvider();
        messagesCreateMock.mockResolvedValueOnce({
            content: [{ type: 'text', text: 'ok' }],
            usage: { input_tokens: 1, output_tokens: 1 },
        });

        await withTestActor(() =>
            provider.complete({
                model: 'claude-haiku-4-5-20251001',
                messages: [
                    {
                        role: 'assistant',
                        content: [
                            { type: 'compaction', encrypted_content: 'SUMMARY' },
                            { type: 'text', text: 'earlier reply' },
                        ],
                    },
                    { role: 'user', content: 'continue' },
                ],
            }),
        );

        const [args] = messagesCreateMock.mock.calls[0]!;
        const blocks = args.messages.flatMap((m: { content?: unknown[] }) =>
            Array.isArray(m.content) ? m.content : [],
        );
        // Compaction mapped to Anthropic `content`, AND the reply text kept.
        expect(blocks).toContainEqual({
            type: 'compaction',
            content: 'SUMMARY',
        });
        expect(blocks).toContainEqual({ type: 'text', text: 'earlier reply' });
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

// -- Metering ----------------------------------------------------

describe('ClaudeProvider metering', () => {
    it('does not double-bill thinking tokens: output_tokens already includes them', async () => {
        const { provider } = makeProvider();
        messagesCreateMock.mockResolvedValueOnce({
            content: [{ type: 'text', text: 'hi' }],
            usage: {
                input_tokens: 100,
                output_tokens: 233,
                output_tokens_details: { thinking_tokens: 110 },
            },
        });

        const result = (await withTestActor(() =>
            provider.complete({
                model: 'claude-haiku-4-5-20251001',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        )) as { usage: Record<string, number>; usageDetails: { reasoningTokens?: number } };

        expect('thinking_tokens' in result.usage).toBe(false);
        expect(result.usage.output_tokens).toBe(233);
        expect(result.usageDetails.reasoningTokens).toBe(110);

        const haiku = CLAUDE_MODELS.find((m) => m.id === 'claude-haiku-4-5-20251001')!;
        const [, , , overrides] = recordSpy.mock.calls[0]!;
        // Billed once, at the plain output rate — not inflated by a second
        // thinking_tokens line.
        expect(overrides.output_tokens).toBe(233 * Number(haiku.costs.output_tokens));
        expect('thinking_tokens' in overrides).toBe(false);
    });

    it('bills at the fast_* rates when the upstream reports usage.speed:"fast"', async () => {
        const { provider } = makeProvider();
        messagesCreateMock.mockResolvedValueOnce({
            content: [{ type: 'text', text: 'hi' }],
            usage: { input_tokens: 10, output_tokens: 5, speed: 'fast' },
        });

        const result = (await withTestActor(() =>
            provider.complete({
                model: 'claude-opus-5-5',
                messages: [{ role: 'user', content: 'hi' }],
                speed: 'fast',
            }),
        )) as { usage: Record<string, number>; usageDetails: { speed?: string } };

        expect(result.usage.fast_input_tokens).toBe(10);
        expect(result.usage.fast_output_tokens).toBe(5);
        expect('input_tokens' in result.usage).toBe(false);
        expect(result.usageDetails.speed).toBe('fast');

        const opus = CLAUDE_MODELS.find((m) => m.id === 'claude-opus-5-5')!;
        const [, , prefix, overrides] = recordSpy.mock.calls[0]!;
        expect(prefix).toBe('claude:claude-opus-5-5');
        expect(overrides.fast_input_tokens).toBe(10 * Number(opus.costs.fast_input_tokens));
        expect(overrides.fast_output_tokens).toBe(5 * Number(opus.costs.fast_output_tokens));
    });

    it('bills at standard rates when fast mode was requested but not granted by the upstream', async () => {
        const { provider } = makeProvider();
        messagesCreateMock.mockResolvedValueOnce({
            content: [{ type: 'text', text: 'hi' }],
            usage: { input_tokens: 10, output_tokens: 5, speed: 'standard' },
        });

        const result = (await withTestActor(() =>
            provider.complete({
                model: 'claude-opus-5-5',
                messages: [{ role: 'user', content: 'hi' }],
                speed: 'fast',
            }),
        )) as { usage: Record<string, number> };

        expect(result.usage.input_tokens).toBe(10);
        expect('fast_input_tokens' in result.usage).toBe(false);
    });

    it('retries at standard speed on Claude when fast mode is rate limited', async () => {
        const { provider } = makeProvider();
        const fastLimited = Object.assign(
            new Error(
                "This request would exceed your organization's rate limit of 0 fast mode input tokens per minute",
            ),
            { status: 429 },
        );
        messagesCreateMock.mockRejectedValueOnce(fastLimited).mockResolvedValueOnce({
            content: [{ type: 'text', text: 'hi' }],
            usage: { input_tokens: 10, output_tokens: 5, speed: 'standard' },
        });

        const result = (await withTestActor(() =>
            provider.complete({
                model: 'claude-opus-5-5',
                messages: [{ role: 'user', content: 'hi' }],
                speed: 'fast',
            }),
        )) as { usage: Record<string, number> };

        expect(messagesCreateMock).toHaveBeenCalledTimes(2);
        expect(messagesCreateMock.mock.calls[0]![0].speed).toBe('fast');
        expect('speed' in messagesCreateMock.mock.calls[1]![0]).toBe(false);
        expect(result.usage.input_tokens).toBe(10);
        expect('fast_input_tokens' in result.usage).toBe(false);
    });

    it('does not retry an ordinary 429 on a fast-mode request', async () => {
        const { provider } = makeProvider();
        const limited = Object.assign(new Error('rate limited'), { status: 429 });
        messagesCreateMock.mockRejectedValueOnce(limited);

        await expect(
            withTestActor(() =>
                provider.complete({
                    model: 'claude-opus-5-5',
                    messages: [{ role: 'user', content: 'hi' }],
                    speed: 'fast',
                }),
            ),
        ).rejects.toBe(limited);
        expect(messagesCreateMock).toHaveBeenCalledTimes(1);
    });

    it('meters web_search_requests at 1,000,000 µ¢ per request', async () => {
        const { provider } = makeProvider();
        messagesCreateMock.mockResolvedValueOnce({
            content: [{ type: 'text', text: 'hi' }],
            usage: {
                input_tokens: 10,
                output_tokens: 5,
                server_tool_use: { web_search_requests: 2 },
            },
        });

        const result = (await withTestActor(() =>
            provider.complete({
                model: 'claude-haiku-4-5-20251001',
                messages: [{ role: 'user', content: 'hi' }],
                tools: [{ type: 'web_search' }],
            }),
        )) as { usage: Record<string, number>; usageDetails: { webSearchRequests?: number } };

        expect(result.usage.web_search_requests).toBe(2);
        expect(result.usageDetails.webSearchRequests).toBe(2);
        const [, , , overrides] = recordSpy.mock.calls[0]!;
        expect(overrides.web_search_requests).toBe(2 * 1_000_000);
    });

    it('records advisor iterations separately, under the advisor model\'s own rates', async () => {
        const { provider } = makeProvider();
        messagesCreateMock.mockResolvedValueOnce({
            content: [{ type: 'text', text: 'hi' }],
            usage: {
                input_tokens: 1102,
                output_tokens: 50,
                iterations: [
                    { type: 'message', input_tokens: 1102, output_tokens: 50 },
                    {
                        type: 'advisor_message',
                        model: 'claude-opus-4-8',
                        input_tokens: 2717,
                        output_tokens: 202,
                    },
                ],
            },
        });

        await withTestActor(() =>
            provider.complete({
                model: 'claude-haiku-4-5-20251001',
                messages: [{ role: 'user', content: 'hi' }],
                tools: [{ type: 'advisor_20260301', model: 'claude-opus-4-8' }],
            }),
        );

        expect(recordSpy).toHaveBeenCalledTimes(2);
        const [execUsage, , execPrefix, execOverrides] = recordSpy.mock.calls[0]!;
        // The lone `message` iteration is already reflected in the top-level
        // totals — it must not be double-counted into the executor's usage.
        expect(execUsage.input_tokens).toBe(1102);
        expect(execUsage.output_tokens).toBe(50);
        expect(execPrefix).toBe('claude:claude-haiku-4-5-20251001');

        const [advUsage, , advPrefix, advOverrides] = recordSpy.mock.calls[1]!;
        expect(advPrefix).toBe('claude:claude-opus-4-8');
        expect(advUsage).toEqual({
            advisor_input_tokens: 2717,
            advisor_ephemeral_5m_input_tokens: 0,
            advisor_ephemeral_1h_input_tokens: 0,
            advisor_cache_read_input_tokens: 0,
            advisor_output_tokens: 202,
        });
        const opus48 = CLAUDE_MODELS.find((m) => m.id === 'claude-opus-4-8')!;
        expect(advOverrides.advisor_input_tokens).toBe(
            2717 * Number(opus48.costs.input_tokens),
        );
        expect(advOverrides.advisor_output_tokens).toBe(
            202 * Number(opus48.costs.output_tokens),
        );
        expect(execOverrides.input_tokens).toBe(
            1102 * Number(CLAUDE_MODELS.find((m) => m.id === 'claude-haiku-4-5-20251001')!.costs.input_tokens),
        );
    });

    it('reports the upstream top-level usage and every raw iteration in usageDetails', async () => {
        const { provider } = makeProvider();
        messagesCreateMock.mockResolvedValueOnce({
            content: [{ type: 'text', text: 'hi' }],
            usage: {
                input_tokens: 2329,
                output_tokens: 90,
                iterations: [
                    { type: 'message', input_tokens: 1102, output_tokens: 40 },
                    {
                        type: 'advisor_message',
                        model: 'claude-opus-4-8',
                        input_tokens: 2717,
                        output_tokens: 202,
                        cache_read_input_tokens: 5,
                    },
                    { type: 'message', input_tokens: 1227, output_tokens: 50 },
                ],
            },
        });

        const result = (await withTestActor(() =>
            provider.complete({
                model: 'claude-haiku-4-5-20251001',
                messages: [{ role: 'user', content: 'hi' }],
                tools: [{ type: 'advisor_20260301', model: 'claude-opus-4-8' }],
            }),
        )) as { usageDetails: Record<string, unknown> };

        expect(result.usageDetails.inputTokens).toBe(2329);
        expect(result.usageDetails.outputTokens).toBe(90);
        expect(result.usageDetails.iterations).toEqual([
            {
                type: 'message',
                inputTokens: 1102,
                outputTokens: 40,
                cacheReadTokens: 0,
                cacheWrite5mTokens: 0,
                cacheWrite1hTokens: 0,
            },
            {
                type: 'advisor_message',
                model: 'claude-opus-4-8',
                inputTokens: 2717,
                outputTokens: 202,
                cacheReadTokens: 5,
                cacheWrite5mTokens: 0,
                cacheWrite1hTokens: 0,
            },
            {
                type: 'message',
                inputTokens: 1227,
                outputTokens: 50,
                cacheReadTokens: 0,
                cacheWrite5mTokens: 0,
                cacheWrite1hTokens: 0,
            },
        ]);
    });

    it('prices an advisor model outside the catalog at the priciest entry\'s rates', async () => {
        const { provider } = makeProvider();
        messagesCreateMock.mockResolvedValueOnce({
            content: [{ type: 'text', text: 'hi' }],
            usage: {
                input_tokens: 10,
                output_tokens: 5,
                iterations: [
                    {
                        type: 'advisor_message',
                        model: 'some-future-advisor-model',
                        input_tokens: 100,
                        output_tokens: 50,
                    },
                ],
            },
        });

        await withTestActor(() =>
            provider.complete({
                model: 'claude-haiku-4-5-20251001',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

        expect(recordSpy).toHaveBeenCalledTimes(2);
        const [, , advPrefix, advOverrides] = recordSpy.mock.calls[1]!;
        // The priciest catalog entry (by output rate) prices the unknown model.
        const priciest = CLAUDE_MODELS.reduce((max, m) =>
            Number(m.costs.output_tokens) > Number(max.costs.output_tokens) ? m : max,
        );
        expect(advPrefix).toBe(`claude:${priciest.id}`);
        expect(advOverrides.advisor_output_tokens).toBe(
            50 * Number(priciest.costs.output_tokens),
        );
    });
});

// -- requestPricing (credit-hold sizing, §3.4) -----------------------

describe('ClaudeProvider.requestPricing', () => {
    const haiku = CLAUDE_MODELS.find((m) => m.id === 'claude-haiku-4-5-20251001')!;
    const opus55 = CLAUDE_MODELS.find((m) => m.id === 'claude-opus-5-5')!;

    it('returns fast cost keys only when the model has fast rates and fast was requested', () => {
        const { provider } = makeProvider();
        expect(
            provider.requestPricing({ speed: 'fast', tools: [] } as never, opus55, {
                promptTokenEstimate: 10,
            }),
        ).toMatchObject({ inputKey: 'fast_input_tokens', outputKey: 'fast_output_tokens' });
        expect(
            provider.requestPricing({ speed: 'fast', tools: [] } as never, haiku, {
                promptTokenEstimate: 10,
            }),
        ).toEqual({});
    });

    it('prices a web-search tool\'s reservation from the request-fee plus a token margin', () => {
        const { provider } = makeProvider();
        const pricing = provider.requestPricing(
            { tools: [{ type: 'web_search_20250305', max_uses: 2 }] } as never,
            haiku,
            { promptTokenEstimate: 10 },
        );
        const expected = 2 * (Number(haiku.costs.web_search_requests) + 10_000 * Number(haiku.costs.input_tokens));
        expect(pricing.extraCost).toBe(expected);
    });

    it('reserves for a web_search_2026 tool the same as the 2025 tool it is forwarded as', () => {
        const { provider } = makeProvider();
        const pricing = provider.requestPricing(
            { tools: [{ type: 'web_search_20260209', max_uses: 2 }] } as never,
            haiku,
            { promptTokenEstimate: 10 },
        );
        const expected = 2 * (Number(haiku.costs.web_search_requests) + 10_000 * Number(haiku.costs.input_tokens));
        expect(pricing.extraCost).toBe(expected);
    });

    it('prices an advisor tool\'s reservation from the prompt estimate and its max_tokens', () => {
        const { provider } = makeProvider();
        const opus48 = CLAUDE_MODELS.find((m) => m.id === 'claude-opus-4-8')!;
        const pricing = provider.requestPricing(
            {
                tools: [
                    { type: 'advisor_20260301', model: 'claude-opus-4-8', max_uses: 2, max_tokens: 1000 },
                ],
            } as never,
            haiku,
            { promptTokenEstimate: 500 },
        );
        const expected =
            2 * (500 * Number(opus48.costs.input_tokens) + 1000 * Number(opus48.costs.output_tokens));
        expect(pricing.extraCost).toBe(expected);
    });

    it('returns {} for a request with no tools and no fast mode', () => {
        const { provider } = makeProvider();
        expect(provider.requestPricing({} as never, haiku, { promptTokenEstimate: 10 })).toEqual({});
    });
});

// -- Streaming response fidelity ---------------------------------

describe('ClaudeProvider.complete streaming response fidelity', () => {
    const streamOnce = async (
        provider: ReturnType<typeof makeProvider>['provider'],
        events: unknown[],
        finalUsage?: unknown,
        opts: { streamToolInput?: boolean } = {},
    ) => {
        messagesStreamMock.mockReturnValueOnce(makeStreamLike(events, finalUsage));
        const result = await withTestActor(() =>
            provider.complete({
                model: 'claude-haiku-4-5-20251001',
                messages: [{ role: 'user', content: 'hi' }],
                stream: true,
                streamToolInput: opts.streamToolInput,
            } as never),
        );
        const harness = makeCapturingChatStream(opts);
        await (
            result as { init_chat_stream: (p: { chatStream: unknown }) => Promise<void> }
        ).init_chat_stream({ chatStream: harness.chatStream });
        return harness.events();
    };

    it('emits reasoning_start + a signed reasoning_detail for a thinking block', async () => {
        const { provider } = makeProvider();
        const events = await streamOnce(provider, [
            { type: 'message_start' },
            {
                type: 'content_block_start',
                index: 0,
                content_block: { type: 'thinking', signature: '' },
            },
            {
                type: 'content_block_delta',
                index: 0,
                delta: { type: 'thinking_delta', thinking: 'step one' },
            },
            {
                type: 'content_block_delta',
                index: 0,
                delta: { type: 'signature_delta', signature: 'sig_abc' },
            },
            { type: 'content_block_stop', index: 0 },
            { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { input_tokens: 1, output_tokens: 1 } },
            { type: 'message_stop' },
        ]);

        expect(events).toContainEqual({ type: 'reasoning_start', format: 'anthropic' });
        expect(events).toContainEqual({
            type: 'reasoning_detail',
            detail: { type: 'thinking', thinking: 'step one', signature: 'sig_abc' },
        });
    });

    it('emits a redacted_thinking reasoning_detail verbatim', async () => {
        const { provider } = makeProvider();
        const events = await streamOnce(provider, [
            { type: 'message_start' },
            {
                type: 'content_block_start',
                index: 0,
                content_block: { type: 'redacted_thinking', data: 'ENC_DATA' },
            },
            { type: 'content_block_stop', index: 0 },
            { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { input_tokens: 1, output_tokens: 1 } },
            { type: 'message_stop' },
        ]);

        expect(events).toContainEqual({
            type: 'reasoning_detail',
            detail: { type: 'redacted_thinking', data: 'ENC_DATA' },
        });
    });

    it('emits server_tool chunks for a server_tool_use call and its result block', async () => {
        const { provider } = makeProvider();
        const events = await streamOnce(provider, [
            { type: 'message_start' },
            {
                type: 'content_block_start',
                index: 0,
                content_block: { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search' },
            },
            {
                type: 'content_block_delta',
                index: 0,
                delta: { type: 'input_json_delta', partial_json: '{"query":"puter"}' },
            },
            { type: 'content_block_stop', index: 0 },
            {
                type: 'content_block_start',
                index: 1,
                content_block: {
                    type: 'web_search_tool_result',
                    tool_use_id: 'srvtoolu_1',
                    content: [{ type: 'web_search_result', url: 'https://x' }],
                },
            },
            { type: 'content_block_stop', index: 1 },
            {
                type: 'message_delta',
                delta: { stop_reason: 'end_turn' },
                usage: { input_tokens: 1, output_tokens: 1, server_tool_use: { web_search_requests: 1 } },
            },
            { type: 'message_stop' },
        ]);

        expect(events).toContainEqual({
            type: 'server_tool',
            block: { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: { query: 'puter' } },
        });
        expect(events).toContainEqual({
            type: 'server_tool',
            block: {
                type: 'web_search_tool_result',
                tool_use_id: 'srvtoolu_1',
                content: [{ type: 'web_search_result', url: 'https://x' }],
            },
        });
    });

    it('emits a server_tool chunk for an advisor_tool_result block', async () => {
        const { provider } = makeProvider();
        const events = await streamOnce(provider, [
            { type: 'message_start' },
            {
                type: 'content_block_start',
                index: 0,
                content_block: { type: 'advisor_tool_result', tool_use_id: 'adv_1', content: 'ok' },
            },
            { type: 'content_block_stop', index: 0 },
            { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { input_tokens: 1, output_tokens: 1 } },
            { type: 'message_stop' },
        ]);

        expect(events).toContainEqual({
            type: 'server_tool',
            block: { type: 'advisor_tool_result', tool_use_id: 'adv_1', content: 'ok' },
        });
    });

    it('never throws on an unknown content block type', async () => {
        const { provider } = makeProvider();
        const events = await streamOnce(provider, [
            { type: 'message_start' },
            {
                type: 'content_block_start',
                index: 0,
                content_block: { type: 'something_brand_new' },
            },
            { type: 'content_block_stop', index: 0 },
            {
                type: 'content_block_start',
                index: 1,
                content_block: { type: 'text' },
            },
            {
                type: 'content_block_delta',
                index: 1,
                delta: { type: 'text_delta', text: 'still works' },
            },
            { type: 'content_block_stop', index: 1 },
            { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { input_tokens: 1, output_tokens: 1 } },
            { type: 'message_stop' },
        ]);

        expect(events.find((e) => e.type === 'text')?.text).toBe('still works');
    });

    it('emits tool_use_start / tool_input_delta only when streamToolInput is set', async () => {
        const { provider } = makeProvider();
        const toolEvents = [
            { type: 'message_start' },
            {
                type: 'content_block_start',
                index: 0,
                content_block: { type: 'tool_use', id: 'toolu_1', name: 'lookup' },
            },
            {
                type: 'content_block_delta',
                index: 0,
                delta: { type: 'input_json_delta', partial_json: '{"q":' },
            },
            {
                type: 'content_block_delta',
                index: 0,
                delta: { type: 'input_json_delta', partial_json: '"x"}' },
            },
            { type: 'content_block_stop', index: 0 },
            { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { input_tokens: 1, output_tokens: 1 } },
            { type: 'message_stop' },
        ];

        const withStreaming = await streamOnce(provider, toolEvents, undefined, {
            streamToolInput: true,
        });
        expect(withStreaming).toContainEqual({ type: 'tool_use_start', id: 'toolu_1', name: 'lookup' });
        expect(withStreaming).toContainEqual({
            type: 'tool_input_delta',
            id: 'toolu_1',
            partialJson: '{"q":',
        });

        const withoutStreaming = await streamOnce(provider, toolEvents, undefined, {
            streamToolInput: false,
        });
        expect(withoutStreaming.find((e) => e.type === 'tool_use_start')).toBeUndefined();
        expect(withoutStreaming.find((e) => e.type === 'tool_input_delta')).toBeUndefined();
        expect(withoutStreaming).toContainEqual(
            expect.objectContaining({ type: 'tool_use', id: 'toolu_1', name: 'lookup', input: { q: 'x' } }),
        );
    });

    it('carries stop_details, safeguard_results, and context_management onto the end-of-stream usage line', async () => {
        const { provider } = makeProvider();
        const events = await streamOnce(provider, [
            { type: 'message_start' },
            {
                type: 'message_delta',
                delta: {
                    stop_reason: 'refusal',
                    stop_sequence: null,
                    stop_details: { type: 'refusal' },
                    safeguard_results: [{ type: 'dangerous_tool_use', status: { tool_use_id: 'toolu_1' } }],
                },
                context_management: { applied_edits: [{ type: 'compact_20260112' }] },
                usage: { input_tokens: 1, output_tokens: 1 },
            },
            { type: 'message_stop' },
        ]);

        expect(events).toContainEqual({
            type: 'safeguard_results',
            results: [{ type: 'dangerous_tool_use', status: { tool_use_id: 'toolu_1' } }],
        });
        const usageLine = events.find((e) => e.type === 'usage')!;
        expect(usageLine.stopReason).toBe('refusal');
        expect(usageLine.stopDetails).toEqual({ type: 'refusal' });
        expect(usageLine.contextManagement).toEqual({ applied_edits: [{ type: 'compact_20260112' }] });
    });

    it('omits the safeguard_results chunk entirely when the upstream never sent the field', async () => {
        const { provider } = makeProvider();
        const events = await streamOnce(provider, [
            { type: 'message_start' },
            { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { input_tokens: 1, output_tokens: 1 } },
            { type: 'message_stop' },
        ]);

        expect(events.find((e) => e.type === 'safeguard_results')).toBeUndefined();
    });
});

// -- countTokens -----------------------------------

describe('ClaudeProvider.countTokens', () => {
    it('forwards only the fields count_tokens accepts', async () => {
        const { provider } = makeProvider();
        countTokensMock.mockResolvedValueOnce({ input_tokens: 42 });

        const result = await withTestActor(() =>
            provider.countTokens({
                model: 'claude-haiku-4-5-20251001',
                messages: [{ role: 'user', content: 'hi' }],
                max_tokens: 999,
                temperature: 0.9,
            } as never),
        );

        expect(result).toBe(42);
        const [payload] = countTokensMock.mock.calls[0]!;
        expect('max_tokens' in payload).toBe(false);
        expect('temperature' in payload).toBe(false);
        expect('metadata' in payload).toBe(false);
        expect('stream' in payload).toBe(false);
        expect('stop_sequences' in payload).toBe(false);
        expect(payload.model).toBe('claude-haiku-4-5-20251001');
        expect(payload.messages).toEqual([{ role: 'user', content: 'hi' }]);
    });
});

// -- Determinism (§8 risk: preserved thinking) ------------------------

describe('ClaudeProvider request determinism', () => {
    it.each(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-5-1'])(
        'produces a byte-identical sdkParams for the same args on %s',
        async (model) => {
            const { provider } = makeProvider();
            messagesCreateMock.mockResolvedValue({
                content: [{ type: 'text', text: 'ok' }],
                usage: { input_tokens: 1, output_tokens: 1 },
            });

            const args = {
                model,
                messages: [
                    { role: 'system', content: 'be concise' },
                    { role: 'user', content: 'hello there' },
                ],
                reasoning_effort: 'high',
                tools: [
                    {
                        type: 'function',
                        function: { name: 'lookup', parameters: { type: 'object' } },
                    },
                ],
            };

            await withTestActor(() => provider.complete(structuredClone(args) as never));
            await withTestActor(() => provider.complete(structuredClone(args) as never));

            const [first] = messagesCreateMock.mock.calls[0]!;
            const [second] = messagesCreateMock.mock.calls[1]!;
            expect(JSON.stringify(first)).toBe(JSON.stringify(second));
        },
    );
});
