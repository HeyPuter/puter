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

import type { UsageInput } from '../../services/metering/types.js';
import { PuterServer } from '../../server.js';
import { setupTestServer } from '../../testUtil.js';
import { withTestActor } from '../integrationTestUtil.js';
import { ChatCompletionDriver } from './ChatCompletionDriver.js';
import { FakeChatProvider } from './providers/FakeChatProvider.js';
import type { IChatCompleteResult } from './types.js';
import type { AIChatStream } from './utils/Streaming.js';

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
            statusCode: 402,
            legacyCode: 'insufficient_funds',
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
