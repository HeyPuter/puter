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
 * What a chat completion is charged when the usual path doesn't complete.
 *
 * Providers meter from the usage they hand to `chatStream.end`, which is the
 * last thing a stream does — so every way a stream can stop early is a way a
 * completion the upstream billed us for reaches the account as free. These
 * tests pin the driver's backstop: output that was produced gets charged, and
 * output that was never produced doesn't.
 */
import type { Readable } from 'node:stream';
import {
    afterAll,
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';

import { Context } from '../../core/context.js';
import type { UsageInput } from '../../services/metering/types.js';
import { PuterServer } from '../../server.js';
import { setupTestServer } from '../../testUtil.js';
import { withTestActor } from '../integrationTestUtil.js';
import { ChatCompletionDriver } from './ChatCompletionDriver.js';
import { clearUnhealthyRoutes, isRouteUnhealthy } from './utils/providerHealth.js';
import { FakeChatProvider } from './providers/FakeChatProvider.js';
import type { IChatCompleteResult } from './types.js';
import { type AIChatStream, ChatStreamAbortedError } from './utils/Streaming.js';

let server: PuterServer;

const PRICED_MODEL = {
    id: 'priced',
    aliases: [],
    costs_currency: 'usd-cents',
    costs: { input_tokens: 1000, output_tokens: 2000 },
    max_tokens: 8192,
};

const makeDriver = async () => {
    const d = new ChatCompletionDriver(
        { providers: { ollama: { enabled: false } } } as never,
        server.clients,
        server.stores,
        server.services,
    );
    d.onServerStart();
    for (let i = 0; i < 200; i++) {
        const m = await d.models();
        if (m.length > 0) return d;
        await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error('ChatCompletionDriver model map never populated in test');
};

const drain = async (stream: Readable): Promise<void> => {
    for await (const _chunk of stream as AsyncIterable<Buffer>) {
        void _chunk;
    }
    // The driver meters in the `finally` of the fire-and-forget stream pump,
    // which can land a tick after the last byte.
    await new Promise((r) => setTimeout(r, 20));
};

/** Every usage entry the driver recorded, flattened across batches. */
const meteredUsages = (
    spy: ReturnType<typeof vi.spyOn>,
): UsageInput[] =>
    spy.mock.calls.flatMap((call) => (call[1] as UsageInput[]) ?? []);

beforeAll(async () => {
    server = await setupTestServer();
});

afterAll(async () => {
    await server?.shutdown();
});

let driver: ChatCompletionDriver;

beforeEach(async () => {
    vi.spyOn(FakeChatProvider.prototype, 'models').mockResolvedValue([
        PRICED_MODEL,
    ] as never);
    driver = await makeDriver();
});

afterEach(() => {
    vi.restoreAllMocks();
});

const streamOf = (
    init: (args: { chatStream: AIChatStream }) => Promise<void>,
): IChatCompleteResult =>
    ({
        init_chat_stream: init,
        stream: true,
    }) as unknown as IChatCompleteResult;

const startStream = async (driverUnderTest: ChatCompletionDriver) =>
    (await withTestActor(() =>
        driverUnderTest.complete({
            model: 'priced',
            messages: [{ role: 'user', content: 'write me something' }],
            stream: true,
        }),
    )) as unknown as { stream: Readable };

describe('ChatCompletionDriver streaming metering backstop', () => {
    it('charges an estimate when a stream dies after producing output', async () => {
        const metered = vi.spyOn(server.services.metering, 'batchIncrementUsages');

        vi.spyOn(FakeChatProvider.prototype, 'complete').mockResolvedValueOnce(
            streamOf(async ({ chatStream }) => {
                const message = chatStream.message();
                const block = message.contentBlock({ type: 'text' });
                block.addText('x'.repeat(4000));
                throw new Error('upstream died mid-response');
            }) as never,
        );

        const result = await startStream(driver);
        await drain(result.stream);

        const estimated = meteredUsages(metered).filter((u) =>
            u.usageType.includes('estimated_'),
        );
        expect(estimated.length).toBe(2);
        const output = estimated.find((u) =>
            u.usageType.endsWith('estimated_output_tokens'),
        )!;
        // 4000 characters at 4 chars/token, priced at 2000 ucents/token.
        expect(output.usageAmount).toBe(1000);
        expect(output.costOverride).toBe(2_000_000);
    });

    it('charges an estimate when a stream completes without a usage report', async () => {
        const metered = vi.spyOn(server.services.metering, 'batchIncrementUsages');

        vi.spyOn(FakeChatProvider.prototype, 'complete').mockResolvedValueOnce(
            streamOf(async ({ chatStream }) => {
                const message = chatStream.message();
                const block = message.contentBlock({ type: 'text' });
                block.addText('y'.repeat(2000));
                // Provider sent no usage chunk — `end` with nothing to report.
                chatStream.end(undefined as never);
            }) as never,
        );

        const result = await startStream(driver);
        await drain(result.stream);

        const estimated = meteredUsages(metered).filter((u) =>
            u.usageType.includes('estimated_'),
        );
        expect(estimated.length).toBe(2);
    });

    it('does not charge when the stream failed before producing anything', async () => {
        const metered = vi.spyOn(server.services.metering, 'batchIncrementUsages');

        vi.spyOn(FakeChatProvider.prototype, 'complete').mockResolvedValueOnce(
            streamOf(async () => {
                throw new Error('upstream refused the request');
            }) as never,
        );

        const result = await startStream(driver);
        await drain(result.stream);

        expect(
            meteredUsages(metered).filter((u) =>
                u.usageType.includes('estimated_'),
            ),
        ).toHaveLength(0);
    });

    // The provider metered, then died before `chatStream.end` — the one
    // path where the backstop used to charge a second, estimated time on
    // top of the real usage.
    it('does not double-charge a stream whose provider metered before it threw', async () => {
        const metered = vi.spyOn(server.services.metering, 'batchIncrementUsages');

        vi.spyOn(FakeChatProvider.prototype, 'complete').mockResolvedValueOnce(
            streamOf(async ({ chatStream }) => {
                const message = chatStream.message();
                const block = message.contentBlock({ type: 'text' });
                block.addText('w'.repeat(4000));
                // Real usage was metered here (providers report the moment
                // they meter)...
                chatStream.reportUsage({ input_tokens: 10, output_tokens: 1000 });
                // ...then the stream died before reaching chatStream.end —
                // e.g. a malformed tool-call payload failing to parse.
                throw new Error('malformed tool-call payload');
            }) as never,
        );

        const result = await startStream(driver);
        await drain(result.stream);

        expect(
            meteredUsages(metered).filter((u) =>
                u.usageType.includes('estimated_'),
            ),
        ).toHaveLength(0);
    });

    // `end({})` meters nothing — an empty usage object must not pass for a
    // usage report, or a stream full of output goes out billed at zero.
    it('charges the estimate when the usage report is empty', async () => {
        const metered = vi.spyOn(server.services.metering, 'batchIncrementUsages');

        vi.spyOn(FakeChatProvider.prototype, 'complete').mockResolvedValueOnce(
            streamOf(async ({ chatStream }) => {
                const message = chatStream.message();
                const block = message.contentBlock({ type: 'text' });
                block.addText('v'.repeat(2000));
                chatStream.end({} as never);
            }) as never,
        );

        const result = await startStream(driver);
        await drain(result.stream);

        expect(
            meteredUsages(metered).filter((u) =>
                u.usageType.includes('estimated_'),
            ),
        ).toHaveLength(2);
    });

    it('leaves a provider-reported stream alone', async () => {
        const metered = vi.spyOn(server.services.metering, 'batchIncrementUsages');

        vi.spyOn(FakeChatProvider.prototype, 'complete').mockResolvedValueOnce(
            streamOf(async ({ chatStream }) => {
                const message = chatStream.message();
                const block = message.contentBlock({ type: 'text' });
                block.addText('z'.repeat(2000));
                chatStream.end({ input_tokens: 10, output_tokens: 500 });
            }) as never,
        );

        const result = await startStream(driver);
        await drain(result.stream);

        expect(
            meteredUsages(metered).filter((u) =>
                u.usageType.includes('estimated_'),
            ),
        ).toHaveLength(0);
    });
});

const freeUser = () => ({
    user: {
        uuid: `chat-gate-${Math.random().toString(36).slice(2)}`,
        username: 'chat-gate-user',
        email: 'chat-gate@test.com',
    },
});

// The gate against the real MeteringService, no mocks: a free account whose
// month has already outrun its allowance must not reach a provider again.
describe('ChatCompletionDriver credit gate against real metering', () => {

    it('rejects a free account that has already spent its allowance', async () => {
        const actor = freeUser() as never;
        const metering = server.services.metering;
        const allowance = (await metering.getActorSubscription(actor))
            .monthUsageAllowance;

        await metering.incrementUsage(
            actor,
            'test:prior-spend',
            1,
            allowance + 1,
        );
        expect(await metering.getRemainingUsage(actor)).toBe(0);

        const completeSpy = vi.spyOn(FakeChatProvider.prototype, 'complete');

        await expect(
            withTestActor(
                () =>
                    driver.complete({
                        model: 'priced',
                        messages: [{ role: 'user', content: 'one more' }],
                    }),
                actor,
            ),
        ).rejects.toMatchObject({
            statusCode: 402,
            legacyCode: 'insufficient_funds',
        });
        expect(completeSpy).not.toHaveBeenCalled();
    });

    // The incident this exists for: usage is recorded when a completion
    // finishes, so a second request that starts while the first is still
    // running used to read a balance that had nothing in flight subtracted
    // from it, and was told it could spend the whole thing too. Concurrency,
    // not budget, was what bounded the spend.
    it('does not let a second request spend a balance the first already has in flight', async () => {
        const actor = freeUser() as never;
        const metering = server.services.metering;
        // Spent down to where one completion's worst case is the whole of
        // what's left — the shape of an expensive model against a small
        // allowance, which is when parallel requests overshoot.
        const allowance = (await metering.getActorSubscription(actor))
            .monthUsageAllowance;
        await metering.incrementUsage(
            actor,
            'test:prior-spend',
            1,
            Math.floor(allowance * 0.9),
        );

        let releaseFirst: (v: unknown) => void = () => {};
        const firstInFlight = new Promise((r) => {
            releaseFirst = r;
        });
        const completeSpy = vi
            .spyOn(FakeChatProvider.prototype, 'complete')
            .mockImplementationOnce(
                async () =>
                    firstInFlight.then(() => ({
                        message: {
                            role: 'assistant',
                            content: [{ type: 'text', text: 'ok' }],
                        },
                        usage: { input_tokens: 1, output_tokens: 1 },
                        finish_reason: 'stop',
                    })) as never,
            );

        const first = withTestActor(
            () =>
                driver.complete({
                    model: 'priced',
                    messages: [{ role: 'user', content: 'first request' }],
                }),
            actor,
        );
        // Let the first request clear the gate and take its hold.
        await vi.waitFor(() => expect(completeSpy).toHaveBeenCalledTimes(1));

        // Nothing is spent yet, only held: a retry once the first finishes is
        // the remedy, not a top-up.
        await expect(
            withTestActor(
                () =>
                    driver.complete({
                        model: 'priced',
                        messages: [{ role: 'user', content: 'second request' }],
                    }),
                actor,
            ),
        ).rejects.toMatchObject({
            statusCode: 429,
            legacyCode: 'too_many_requests',
            code: 'credits_reserved',
        });
        // The second request never reached a provider.
        expect(completeSpy).toHaveBeenCalledTimes(1);

        releaseFirst(undefined);
        await first;

        // And the hold is given back, so the account can spend again.
        expect(
            await server.services.metering.getRemainingUsage(actor),
        ).toBeGreaterThan(0);
    });

    it('caps output to the balance left, so one call cannot run away with the month', async () => {
        const actor = freeUser() as never;
        const metering = server.services.metering;
        const allowance = (await metering.getActorSubscription(actor))
            .monthUsageAllowance;

        // Nine tenths spent — a tenth of the allowance is left to bound the
        // next completion's output.
        await metering.incrementUsage(
            actor,
            'test:prior-spend',
            1,
            Math.floor(allowance * 0.9),
        );
        const remaining = await metering.getRemainingUsage(actor);

        const completeSpy = vi
            .spyOn(FakeChatProvider.prototype, 'complete')
            .mockResolvedValueOnce({
                message: {
                    role: 'assistant',
                    content: [{ type: 'text', text: 'ok' }],
                },
                usage: { input_tokens: 1, output_tokens: 1 },
                finish_reason: 'stop',
            } as never);

        await withTestActor(
            () =>
                driver.complete({
                    model: 'priced',
                    messages: [{ role: 'user', content: 'go' }],
                    max_tokens: 100_000,
                }),
            actor,
        );

        const passed = completeSpy.mock.calls[0]![0] as { max_tokens?: number };
        // 2000 ucents per output token — the cap has to fit what's left.
        expect(passed.max_tokens).toBeDefined();
        expect(passed.max_tokens! * 2000).toBeLessThanOrEqual(remaining);
    });
});

describe('ChatCompletionDriver credit gate with an AI cost factor', () => {
    const FACTOR = 1.3;
    let seenKeys: string[];
    const listener = (key: string, event: { factor: number }) => {
        seenKeys.push(key);
        event.factor = FACTOR;
    };

    beforeEach(() => {
        seenKeys = [];
        server.clients.event.on('ai.cost.factor.*', listener as never);
    });

    afterEach(() => {
        server.clients.event.off('ai.cost.factor.*', listener as never);
    });

    const okResult = {
        message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
        usage: { input_tokens: 1, output_tokens: 1 },
        finish_reason: 'stop',
    } as never;

    // Usage is recorded at cost × factor, so a cap sized at the bare cost
    // lets a completion spend past what's left.
    it('caps output at the factored price', async () => {
        const actor = freeUser() as never;
        const metering = server.services.metering;
        const allowance = (await metering.getActorSubscription(actor))
            .monthUsageAllowance;
        await metering.incrementUsage(
            actor,
            'test:prior-spend',
            1,
            Math.floor(allowance * 0.9),
        );
        const remaining = await metering.getRemainingUsage(actor);
        const completeSpy = vi
            .spyOn(FakeChatProvider.prototype, 'complete')
            .mockResolvedValueOnce(okResult);

        await withTestActor(
            () =>
                driver.complete({
                    model: 'priced',
                    messages: [{ role: 'user', content: 'go' }],
                    max_tokens: 100_000,
                }),
            actor,
        );

        const passed = completeSpy.mock.calls[0]![0] as { max_tokens: number };
        expect(passed.max_tokens * 2000 * FACTOR).toBeLessThanOrEqual(
            remaining,
        );
        expect(passed.max_tokens).toBeGreaterThan(
            remaining / (2000 * FACTOR) - 10,
        );
    });

    it('reserves the factored worst case', async () => {
        const actor = freeUser() as never;
        const reserve = vi.spyOn(server.services.metering, 'reserveCredits');
        const completeSpy = vi
            .spyOn(FakeChatProvider.prototype, 'complete')
            .mockResolvedValueOnce(okResult);

        await withTestActor(
            () =>
                driver.complete({
                    model: 'priced',
                    messages: [{ role: 'user', content: 'go' }],
                    max_tokens: 10,
                }),
            actor,
        );

        const passed = completeSpy.mock.calls[0]![0] as { max_tokens: number };
        expect(passed.max_tokens).toBe(10);
        const [, held] = reserve.mock.calls[0]!;
        // At least the 10 capped output tokens at 2000 × factor.
        expect(held).toBeGreaterThanOrEqual(10 * 2000 * FACTOR);
    });

    // The factor is looked up by the key the provider records under, or a
    // per-model factor would price the gate and the charge differently.
    it('asks for the factor under the metering key the provider records with', async () => {
        const proto = FakeChatProvider.prototype as unknown as {
            meteringModelKey?: (id: string) => string;
        };
        proto.meteringModelKey = (id) => `fake-recorded:${id}`;
        try {
            vi.spyOn(
                FakeChatProvider.prototype,
                'complete',
            ).mockResolvedValueOnce(okResult);
            await withTestActor(
                () =>
                    driver.complete({
                        model: 'priced',
                        messages: [{ role: 'user', content: 'go' }],
                    }),
                freeUser() as never,
            );
            expect(seenKeys).toContain(
                'ai.cost.factor.ai-chat.fake-recorded:priced',
            );
        } finally {
            delete proto.meteringModelKey;
        }
    });
});

describe('ChatCompletionDriver credit gate on multimodal prompts', () => {
    it('prices attachments into the pre-flight affordability check', async () => {
        const actor = freeUser() as never;
        const metering = server.services.metering;
        const allowance = (await metering.getActorSubscription(actor))
            .monthUsageAllowance;

        // Leave half of what the frame below estimates to: a plain-text
        // prompt is still affordable, the same prompt carrying the frame is
        // not. (~150KB of base64 payload ≈ 1000 tokens at 1000 ucents each.)
        await metering.incrementUsage(
            actor,
            'test:prior-spend',
            1,
            allowance - 500_000,
        );

        const completeSpy = vi
            .spyOn(FakeChatProvider.prototype, 'complete')
            .mockResolvedValue({
                message: {
                    role: 'assistant',
                    content: [{ type: 'text', text: 'ok' }],
                },
                usage: { input_tokens: 1, output_tokens: 1 },
                finish_reason: 'stop',
            } as never);

        // Text alone clears the gate...
        await withTestActor(
            () =>
                driver.complete({
                    model: 'priced',
                    messages: [{ role: 'user', content: 'describe' }],
                    max_tokens: 10,
                }),
            actor,
        );
        expect(completeSpy).toHaveBeenCalledTimes(1);

        // ...the same prompt carrying a frame that used to price as ~nothing
        // does not.
        await expect(
            withTestActor(
                () =>
                    driver.complete({
                        model: 'priced',
                        messages: [
                            {
                                role: 'user',
                                content: [
                                    { type: 'text', text: 'describe' },
                                    {
                                        type: 'image_url',
                                        image_url: {
                                            url: `data:image/jpeg;base64,${'A'.repeat(200_000)}`,
                                        },
                                    },
                                ],
                            },
                        ],
                        max_tokens: 10,
                    }),
                actor,
            ),
        ).rejects.toMatchObject({
            statusCode: 402,
            legacyCode: 'insufficient_funds',
        });
        expect(completeSpy).toHaveBeenCalledTimes(1);
    });
});

// `max_tokens` is a model's output limit and `context` its whole window; the
// cap is the lesser of the limit and what the window leaves after the prompt.
describe('ChatCompletionDriver output ceiling', () => {
    // ~15k estimated tokens: past an 8192-token output limit.
    const longPrompt = [{ role: 'user', content: 'x '.repeat(20_000) }];

    const withModel = async (model: Record<string, unknown>) => {
        vi.spyOn(FakeChatProvider.prototype, 'models').mockResolvedValue([
            { ...PRICED_MODEL, ...model },
        ] as never);
        vi.spyOn(server.services.metering, 'getUsageHeadroom').mockResolvedValue({ balance: Number.MAX_SAFE_INTEGER, held: 0 });
        const completeSpy = vi
            .spyOn(FakeChatProvider.prototype, 'complete')
            .mockResolvedValue({
                message: { role: 'assistant', content: 'ok' },
                usage: { input_tokens: 1, output_tokens: 1 },
                finish_reason: 'stop',
            } as never);
        const d = await makeDriver();
        await withTestActor(() =>
            d.complete({ model: 'priced', messages: longPrompt }),
        );
        return (completeSpy.mock.calls[0]![0] as { max_tokens: number })
            .max_tokens;
    };

    it('serves a prompt longer than the output limit when the window fits it', async () => {
        expect(await withModel({ max_tokens: 8192, context: 200_000 })).toBe(
            8192,
        );
    });

    it('caps output at what the window leaves after the prompt', async () => {
        const maxTokens = await withModel({
            max_tokens: 32_000,
            context: 32_000,
        });
        expect(maxTokens).toBeGreaterThan(0);
        expect(maxTokens).toBeLessThan(32_000 - 10_000);
    });

    it('leaves a prompt estimated past the window for the provider to refuse', async () => {
        expect(await withModel({ max_tokens: 8192, context: 10_000 })).toBe(
            8192,
        );
    });
});

describe('ChatCompletionDriver when the balance runs out', () => {
    const spentToATenth = async () => {
        const actor = freeUser() as never;
        const metering = server.services.metering;
        const allowance = (await metering.getActorSubscription(actor))
            .monthUsageAllowance;
        await metering.incrementUsage(
            actor,
            'test:prior-spend',
            1,
            Math.floor(allowance * 0.9),
        );
        return actor;
    };

    /** A non-stream completion that reports `output(cap)` output tokens. */
    const completeWithOutput = async (
        actor: never,
        output: (cap: number) => number,
    ) => {
        vi.spyOn(FakeChatProvider.prototype, 'complete').mockImplementationOnce(
            async (args) =>
                ({
                    message: { role: 'assistant', content: 'cut' },
                    usage: {
                        input_tokens: 1,
                        output_tokens: output(
                            (args as { max_tokens: number }).max_tokens,
                        ),
                    },
                    finish_reason: 'length',
                }) as never,
        );
        return withTestActor(async () => {
            await driver.complete({
                model: 'priced',
                messages: [{ role: 'user', content: 'go' }],
            });
            return Context.get('driverMetadata') as Record<string, unknown>;
        }, actor);
    };

    it('flags a completion that used all of a balance-bound cap', async () => {
        const metadata = await completeWithOutput(
            await spentToATenth(),
            (cap) => cap,
        );
        expect(metadata.usage_limited).toBe(true);
    });

    it('leaves a completion that stopped short of the cap alone', async () => {
        const metadata = await completeWithOutput(
            await spentToATenth(),
            (cap) => cap - 1,
        );
        expect(metadata.usage_limited).toBeUndefined();
    });

    it('does not flag a cap that only the account’s own holds shrank', async () => {
        const actor = freeUser() as never;
        const metering = server.services.metering;
        const allowance = (await metering.getActorSubscription(actor))
            .monthUsageAllowance;
        // The whole 8192-token limit is affordable from the balance...
        expect(allowance - 1000).toBeGreaterThan(8192 * 2000);
        // ...but a request in flight holds most of it.
        const hold = await metering.reserveCredits(
            actor,
            allowance - 8192 * 1000,
        );
        try {
            const metadata = await completeWithOutput(actor, (cap) => cap);
            expect(metadata.usage_limited).toBeUndefined();
        } finally {
            await hold.release();
        }
    });

    it('does not flag a held cap when the unreserved balance also limits output', async () => {
        const actor = await spentToATenth();
        const metering = server.services.metering;
        const { balance } = await metering.getUsageHeadroom(actor);
        const hold = await metering.reserveCredits(actor, balance / 2);
        try {
            const metadata = await completeWithOutput(actor, (cap) => cap);
            expect(metadata.usage_limited).toBeUndefined();
        } finally {
            await hold.release();
        }
    });

    it('marks the usage line of a stream that ran the balance out', async () => {
        const actor = await spentToATenth();
        vi.spyOn(FakeChatProvider.prototype, 'complete').mockImplementationOnce(
            async (args) =>
                streamOf(async ({ chatStream }) => {
                    chatStream
                        .message()
                        .contentBlock({ type: 'text' })
                        .addText('cut');
                    chatStream.end({
                        input_tokens: 1,
                        output_tokens: (args as { max_tokens: number })
                            .max_tokens,
                    });
                }) as never,
        );
        const { stream } = (await withTestActor(
            () =>
                driver.complete({
                    model: 'priced',
                    messages: [{ role: 'user', content: 'go' }],
                    stream: true,
                }),
            actor,
        )) as unknown as { stream: Readable };

        let body = '';
        for await (const chunk of stream as AsyncIterable<Buffer>) {
            body += chunk.toString();
        }
        const usageLine = body
            .trim()
            .split('\n')
            .map((l) => JSON.parse(l))
            .find((l) => l.type === 'usage');
        expect(usageLine.metadata).toEqual({ usage_limited: true });
    });

    it('refuses with 402, not the retryable 429, when nothing is held', async () => {
        const actor = freeUser() as never;
        const metering = server.services.metering;
        const allowance = (await metering.getActorSubscription(actor))
            .monthUsageAllowance;
        await metering.incrementUsage(actor, 'test:prior-spend', 1, allowance);
        await expect(
            withTestActor(
                () =>
                    driver.complete({
                        model: 'priced',
                        messages: [{ role: 'user', content: 'go' }],
                    }),
                actor,
            ),
        ).rejects.toMatchObject({
            statusCode: 402,
            legacyCode: 'insufficient_funds',
        });
    });
});

describe('ChatCompletionDriver when the caller hangs up', () => {
    it('does not start a provider request after cancellation', async () => {
        const abort = new AbortController();
        abort.abort();
        const complete = vi.spyOn(FakeChatProvider.prototype, 'complete');
        await expect(
            withTestActor(() => {
                Context.set('abortSignal', abort.signal);
                return driver.complete({
                    model: 'priced',
                    messages: [{ role: 'user', content: 'go' }],
                });
            }, freeUser() as never),
        ).rejects.toBe(abort.signal.reason);
        expect(complete).not.toHaveBeenCalled();
    });

    it('releases the hold without treating cancellation as a provider failure', async () => {
        clearUnhealthyRoutes();
        const actor = freeUser() as never;
        const abort = new AbortController();
        const reason = new DOMException('Cancelled', 'AbortError');
        const complete = vi
            .spyOn(FakeChatProvider.prototype, 'complete')
            .mockImplementationOnce(async () => {
                abort.abort(reason);
                throw abort.signal.reason;
            });
        try {
            await expect(
                withTestActor(() => {
                    Context.set('abortSignal', abort.signal);
                    return driver.complete({
                        model: 'priced',
                        messages: [{ role: 'user', content: 'go' }],
                    });
                }, actor),
            ).rejects.toBe(reason);
            expect(complete).toHaveBeenCalledTimes(1);
            expect(isRouteUnhealthy('fake-chat', 'priced')).toBe(false);
            expect(
                await server.services.metering.getOutstandingHolds(actor),
            ).toBe(0);
        } finally {
            clearUnhealthyRoutes();
        }
    });

    it('records the cost of a cancelled stream without announcing a completion', async () => {
        const abort = new AbortController();
        let resume!: () => void;
        const paused = new Promise<void>((resolve) => {
            resume = resolve;
        });
        vi.spyOn(FakeChatProvider.prototype, 'complete').mockResolvedValueOnce(
            streamOf(async ({ chatStream }) => {
                chatStream
                    .message()
                    .contentBlock({ type: 'text' })
                    .addText('partial');
                await paused;
                chatStream.end({ input_tokens: 1, output_tokens: 1 });
            }) as never,
        );
        const events = vi.spyOn(server.clients.event, 'emit');
        const { stream } = (await withTestActor(() => {
            Context.set('abortSignal', abort.signal);
            return driver.complete({
                model: 'priced',
                messages: [{ role: 'user', content: 'hi' }],
                stream: true,
            });
        }, freeUser() as never)) as unknown as { stream: Readable };
        abort.abort();
        resume();
        await drain(stream);
        expect(
            events.mock.calls.some(([key]) => key === 'ai.prompt.complete'),
        ).toBe(false);
        expect(
            events.mock.calls.some(
                ([key]) => key === 'ai.prompt.cost-calculated',
            ),
        ).toBe(true);
    });

    it('stops the generation and gives the hold back', async () => {
        const actor = freeUser() as never;
        const metering = server.services.metering;
        const abort = new AbortController();
        let resume: () => void = () => {};
        const paused = new Promise<void>((r) => {
            resume = r;
        });
        let providerError: unknown;

        vi.spyOn(FakeChatProvider.prototype, 'complete').mockResolvedValueOnce(
            streamOf(async ({ chatStream }) => {
                const block = chatStream.message().contentBlock({ type: 'text' });
                block.addText('first');
                await paused;
                try {
                    // An upstream still generating: keeps writing until told.
                    for (let i = 0; i < 1000; i++) block.addText('more');
                } catch (e) {
                    providerError = e;
                    throw e;
                }
            }) as never,
        );
        const metered = vi.spyOn(metering, 'batchIncrementUsages');

        const { stream } = (await withTestActor(() => {
            Context.set('abortSignal', abort.signal);
            return driver.complete({
                model: 'priced',
                messages: [{ role: 'user', content: 'go' }],
                stream: true,
            });
        }, actor)) as unknown as { stream: Readable };
        expect(await metering.getOutstandingHolds(actor)).toBeGreaterThan(0);

        abort.abort();
        resume();

        let body = '';
        for await (const chunk of stream as AsyncIterable<Buffer>) {
            body += chunk.toString();
        }
        await new Promise((r) => setTimeout(r, 20));

        expect(providerError).toBeInstanceOf(ChatStreamAbortedError);
        // Nobody is listening, so no error line is written for the abort.
        expect(body).not.toContain('"type":"error"');
        expect(await metering.getOutstandingHolds(actor)).toBe(0);
        // What was generated before the hang-up is still charged.
        expect(metered).toHaveBeenCalled();
    });
});


describe('stream pump termination', () => {
    it('ends with an error if a provider returns without finishing its stream', async () => {
        vi.spyOn(FakeChatProvider.prototype, 'complete').mockResolvedValueOnce(
            streamOf(async ({ chatStream }) => {
                chatStream.message().contentBlock({ type: 'text' }).addText('partial');
            }) as never,
        );
        const result = await startStream(driver);
        let body = '';
        for await (const chunk of result.stream) body += chunk.toString();
        expect(body).toContain('Stream ended before completion');
        expect(body).not.toContain('"type":"usage"');
    });
    it('releases the hold even if final provider cleanup throws', async () => {
        const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(FakeChatProvider.prototype, 'complete').mockResolvedValueOnce({
            ...streamOf(async ({ chatStream }) => chatStream.end({})),
            finally_fn: async () => { throw new Error('cleanup failed'); },
        } as never);
        const actor = freeUser() as never;
        const result = await withTestActor(() => driver.complete({
            model: 'priced', messages: [{ role: 'user', content: 'hi' }], stream: true,
        }), actor) as unknown as { stream: Readable };
        await drain(result.stream);
        expect(await server.services.metering.getOutstandingHolds(actor)).toBe(0);
        expect(warning).toHaveBeenCalledWith('Chat stream cleanup failed:', 'cleanup failed');
    });
});
