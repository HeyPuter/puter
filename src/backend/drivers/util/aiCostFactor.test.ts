import { Readable } from 'node:stream';
import {
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import type { Actor } from '../../core/actor.ts';
import { runWithContext } from '../../core/context.ts';
import type { AiCostFactorEvent } from '../../clients/event/types.ts';
import { PuterServer } from '../../server.ts';
import { setupTestServer } from '../../testUtil.ts';
import type { MeteringService } from '../../services/metering/MeteringService.ts';
import {
    type AiMeteringService,
    aiModelKey,
    factoredTotal,
    requestAiCosts,
    withAiCostFactor,
    withAiCreditHold,
    withStreamedAiCharge,
} from './aiCostFactor.ts';

type Listener = (
    key: `ai.cost.factor.${string}`,
    data: AiCostFactorEvent,
) => void;

describe('AI cost factor', () => {
    let server: PuterServer;
    let metering: MeteringService;
    let scoped: AiMeteringService;
    let actor: Actor;
    let listeners: Listener[];

    beforeAll(async () => {
        server = await setupTestServer();
        metering = server.services.metering;
        scoped = withAiCostFactor(metering, server.clients.event, 'ai-chat');
        // Counters buffer before they're written onward; stop the drain loop
        // so nothing fires mid-assertion.
        await server.stores.meteringBuffer.onServerShutdown();
    });

    beforeEach(() => {
        listeners = [];
        actor = {
            user: {
                uuid: `ai-mult-${Math.random().toString(36).slice(2)}`,
                username: 'ai-mult',
                email: 'ai-mult@test.com',
            },
        } as Actor;
    });

    afterEach(() => {
        for (const listener of listeners) {
            server.clients.event.off('ai.cost.factor.*', listener);
        }
    });

    /** Subscribe for the duration of one test, recording what it was asked. */
    const listen = (factor: number | undefined) => {
        const seen: Array<{ key: string; event: AiCostFactorEvent }> = [];
        const listener: Listener = (key, event) => {
            seen.push({ key, event: { ...event } });
            if (factor !== undefined) event.factor = factor;
        };
        server.clients.event.on('ai.cost.factor.*', listener);
        listeners.push(listener);
        return seen;
    };

    describe('aiModelKey', () => {
        it.each([
            [
                'claude:claude-sonnet-4-5:input_tokens',
                'claude:claude-sonnet-4-5',
            ],
            ['gemini:gemini-2.5-flash:output:audio', 'gemini:gemini-2.5-flash'],
            ['xai:stt:second', 'xai:stt'],
            ['mistral-ocr', 'mistral-ocr'],
        ])('reads the provider and model out of %s', (usageType, expected) => {
            expect(aiModelKey(usageType)).toBe(expected);
        });
    });

    it('records the provider cost when nothing is listening', async () => {
        const result = await scoped.incrementUsage(
            actor,
            'claude:sonnet:input_tokens',
            10,
            1000,
        );
        expect(result.total).toBe(1000);
    });

    // Drivers fire metering off unawaited. With no hook in play the record
    // must still be issued in the same call, not a tick later — a request that
    // ends in between would otherwise leave it settling behind the response.
    it('records without waiting on the hook when nothing is listening', async () => {
        const recorded: unknown[] = [];
        const spy = vi
            .spyOn(metering, 'incrementUsage')
            .mockImplementation(async (...args) => {
                recorded.push(args);
                return { total: 0 };
            });
        try {
            void scoped.incrementUsage(
                actor,
                'claude:sonnet:input_tokens',
                1,
                1000,
            );
            expect(recorded).toHaveLength(1);
        } finally {
            spy.mockRestore();
        }
    });

    it('multiplies the recorded cost and reports the driver and model', async () => {
        const seen = listen(1.04);

        const result = await scoped.incrementUsage(
            actor,
            'claude:sonnet:input_tokens',
            10,
            1000,
        );

        expect(result.total).toBe(1040);
        expect(seen).toHaveLength(1);
        expect(seen[0].key).toBe('ai.cost.factor.ai-chat.claude:sonnet');
        expect(seen[0].event).toMatchObject({
            driver: 'ai-chat',
            model: 'claude:sonnet',
            factor: 1,
        });
        expect(seen[0].event.actor.user.uuid).toBe(actor.user.uuid);
    });

    it('scales the cost overrides of a recorded usage object', async () => {
        listen(1.04);

        const result = await scoped.utilRecordUsageObject(
            { input_tokens: 100, output_tokens: 50 },
            actor,
            'claude:sonnet',
            { input_tokens: 1000, output_tokens: 2000 },
        );

        expect(result.total).toBe(1040 + 2080);
    });

    it('records a usage object as it stood when recording began', async () => {
        listen(2);
        const recorded = vi.spyOn(metering, 'batchIncrementUsages');
        const usage: Record<string, number> = { input_tokens: 100 };

        try {
            const done = scoped.utilRecordUsageObject(
                usage,
                actor,
                'claude:sonnet',
                { input_tokens: 1000 },
            );
            // The driver decorates the usage it reports once metering is called.
            usage.usd_cents = 0.1;
            await done;

            expect(
                recorded.mock.calls[0]![1].map((entry) => entry.usageType),
            ).toEqual(['claude:sonnet:input_tokens']);
        } finally {
            recorded.mockRestore();
        }
    });

    it("tracks a request's charges before the factor, as the ledger counts them", async () => {
        listen(1.6);
        const recorded = vi.spyOn(metering, 'batchIncrementUsages');

        try {
            const costs = await runWithContext({ actor }, async () => {
                await scoped.utilRecordUsageObject(
                    { input_tokens: 100, output_tokens: 0, reasoning: 3 },
                    actor,
                    'claude:sonnet',
                    { input_tokens: 1001, output_tokens: 7 },
                );
                await scoped.incrementUsage(actor, 'xai:stt:second', 3, 333);
                return requestAiCosts();
            });

            // Zero-amount and unpriced entries charge nothing.
            expect(costs).toEqual([1001, 333]);
            // The service skips zero-amount entries.
            const ledger = recorded.mock.calls
                .flatMap(([, usages]) => usages)
                .filter((usage) => usage.usageAmount !== 0)
                .reduce((total, usage) => total + (usage.costOverride ?? 0), 0);
            expect(factoredTotal(costs, 1.6)).toBe(ledger);
            expect(ledger).toBe(1602 + 533);
        } finally {
            recorded.mockRestore();
        }
    });

    it('tracks no charges outside a request', async () => {
        await scoped.incrementUsage(actor, 'xai:stt:second', 3, 333);
        expect(requestAiCosts()).toEqual([]);
    });

    it('asks once per model in a batch', async () => {
        const seen = listen(2);

        const result = await scoped.batchIncrementUsages(actor, [
            {
                usageType: 'claude:sonnet:input_tokens',
                usageAmount: 1,
                costOverride: 100,
            },
            {
                usageType: 'claude:sonnet:output_tokens',
                usageAmount: 1,
                costOverride: 200,
            },
            {
                usageType: 'openai:gpt-5:input_tokens',
                usageAmount: 1,
                costOverride: 400,
            },
        ]);

        expect(result.total).toBe(1400);
        expect(seen.map((s) => s.key)).toEqual([
            'ai.cost.factor.ai-chat.claude:sonnet',
            'ai.cost.factor.ai-chat.openai:gpt-5',
        ]);
    });

    // An entry with no cost is recorded unpriced, and multiplying "unpriced"
    // would invent a price of zero.
    it('leaves an unpriced entry alone', async () => {
        const seen = listen(1.04);

        const result = await scoped.batchIncrementUsages(actor, [
            { usageType: 'claude:sonnet:input_tokens', usageAmount: 3 },
        ]);

        expect(result.total).toBe(0);
        expect(result['claude:sonnet:input_tokens']).toMatchObject({
            units: 3,
        });
        expect(seen).toHaveLength(0);
    });

    it.each([
        ['zero', 0],
        ['negative', -2],
        ['past the ceiling', 1000],
        ['not a number', Number.NaN],
    ])('ignores a %s factor', async (_label, factor) => {
        listen(factor);

        const result = await scoped.incrementUsage(
            actor,
            'claude:sonnet:input_tokens',
            1,
            1000,
        );

        expect(result.total).toBe(1000);
    });

    it('does not multiply usage recorded through the unscoped service', async () => {
        listen(1.04);

        const result = await metering.incrementUsage(
            actor,
            'claude:sonnet:input_tokens',
            1,
            1000,
        );

        expect(result.total).toBe(1000);
    });

    // Providers hold the scoped service and call all of it, not just the
    // recording methods.
    it('passes everything else through to the service', async () => {
        const [scopedSub, realSub] = await Promise.all([
            scoped.getActorSubscription(actor),
            metering.getActorSubscription(actor),
        ]);
        expect(scopedSub).toEqual(realSub);
        expect(scoped.getRegisteredPolicy(realSub.id)?.id).toBe(realSub.id);
    });

    it('re-scoping returns the same view rather than stacking factors', async () => {
        listen(1.04);
        const again = withAiCostFactor(scoped, server.clients.event, 'ai-chat');
        expect(again).toBe(scoped);

        const result = await again.incrementUsage(
            actor,
            'claude:sonnet:input_tokens',
            1,
            1000,
        );
        expect(result.total).toBe(1040);
    });

    it('reports the factor a model is priced at', async () => {
        listen(1.3);
        expect(await scoped.costFactor(actor, 'claude:sonnet')).toBe(1.3);
    });

    describe('reserveAiCredits', () => {
        it('gates and holds at the factored cost', async () => {
            listen(1.3);
            const check = vi
                .spyOn(metering, 'hasEnoughCredits')
                .mockResolvedValue(true);
            const reserve = vi.spyOn(metering, 'reserveCredits');
            try {
                const hold = await scoped.reserveAiCredits(
                    actor,
                    'openai:tts-1:character',
                    1000,
                );
                await hold?.release();
                expect(check).toHaveBeenCalledWith(actor, 1300);
                expect(reserve).toHaveBeenCalledWith(actor, 1300, undefined);
            } finally {
                check.mockRestore();
                reserve.mockRestore();
            }
        });

        it('passes a hold lifetime through to the service', async () => {
            const check = vi
                .spyOn(metering, 'hasEnoughCredits')
                .mockResolvedValue(true);
            const reserve = vi.spyOn(metering, 'reserveCredits');
            try {
                const hold = await scoped.reserveAiCredits(
                    actor,
                    'openai:tts-1:character',
                    1000,
                    { ttlMs: 60_000 },
                );
                await hold?.release();
                expect(reserve).toHaveBeenCalledWith(actor, 1000, {
                    ttlMs: 60_000,
                });
            } finally {
                check.mockRestore();
                reserve.mockRestore();
            }
        });

        it('takes no hold when the factored cost is unaffordable', async () => {
            listen(1.3);
            const check = vi
                .spyOn(metering, 'hasEnoughCredits')
                .mockImplementation(async (_actor, amount) => amount <= 1000);
            const reserve = vi.spyOn(metering, 'reserveCredits');
            try {
                const hold = await scoped.reserveAiCredits(
                    actor,
                    'openai:tts-1:character',
                    1000,
                );
                expect(hold).toBeNull();
                expect(reserve).not.toHaveBeenCalled();
            } finally {
                check.mockRestore();
                reserve.mockRestore();
            }
        });
    });

    it('survives a listener that throws', async () => {
        const boom = vi.fn(() => {
            throw new Error('nope');
        }) as unknown as Listener;
        server.clients.event.on('ai.cost.factor.*', boom);
        listeners.push(boom);

        const result = await scoped.incrementUsage(
            actor,
            'claude:sonnet:input_tokens',
            1,
            1000,
        );

        expect(boom).toHaveBeenCalled();
        expect(result.total).toBe(1000);
    });

    describe('withAiCreditHold', () => {
        const usageType = 'openai:tts-1:character';

        it('holds the factored cost while run executes, then releases it', async () => {
            listen(1.3);
            const check = vi
                .spyOn(metering, 'hasEnoughCredits')
                .mockResolvedValue(true);
            try {
                let heldDuringRun = 0;
                const result = await withAiCreditHold(
                    scoped,
                    actor,
                    usageType,
                    1000,
                    async () => {
                        heldDuringRun =
                            await metering.getOutstandingHolds(actor);
                        return 'done';
                    },
                );
                expect(result).toBe('done');
                expect(heldDuringRun).toBe(1300);
                expect(await metering.getOutstandingHolds(actor)).toBe(0);
            } finally {
                check.mockRestore();
            }
        });

        it('keeps the hold until the usage it stands for is recorded', async () => {
            // The second lookup is the recording's; hold it back.
            let lookups = 0;
            let landRecording = () => {};
            const recordingHeld = new Promise<void>((resolve) => {
                landRecording = resolve;
            });
            const slowFactor = async (
                _key: string,
                event: AiCostFactorEvent,
            ) => {
                if (++lookups === 2) await recordingHeld;
                event.factor = 1.3;
            };
            server.clients.event.on('ai.cost.factor.*', slowFactor as never);
            const check = vi
                .spyOn(metering, 'hasEnoughCredits')
                .mockResolvedValue(true);
            try {
                await runWithContext({ actor }, () =>
                    withAiCreditHold(
                        scoped,
                        actor,
                        usageType,
                        1000,
                        async () => {
                            void scoped.incrementUsage(
                                actor,
                                usageType,
                                1,
                                1000,
                            );
                            return 'done';
                        },
                    ),
                );
                expect(await metering.getOutstandingHolds(actor)).toBe(1300);

                landRecording();
                await vi.waitFor(async () =>
                    expect(await metering.getOutstandingHolds(actor)).toBe(0),
                );
            } finally {
                server.clients.event.off(
                    'ai.cost.factor.*',
                    slowFactor as never,
                );
                check.mockRestore();
            }
        });

        it('releases the hold when the usage write fails', async () => {
            const check = vi
                .spyOn(metering, 'hasEnoughCredits')
                .mockResolvedValue(true);
            const write = vi
                .spyOn(metering, 'incrementUsage')
                .mockRejectedValueOnce(new Error('ledger down'));
            try {
                await runWithContext({ actor }, () =>
                    withAiCreditHold(
                        scoped,
                        actor,
                        usageType,
                        1000,
                        async () => {
                            scoped
                                .incrementUsage(actor, usageType, 1, 1000)
                                .catch(() => {});
                        },
                    ),
                );
                await vi.waitFor(async () =>
                    expect(await metering.getOutstandingHolds(actor)).toBe(0),
                );
            } finally {
                check.mockRestore();
                write.mockRestore();
            }
        });

        it('releases at once when nothing was recorded', async () => {
            const check = vi
                .spyOn(metering, 'hasEnoughCredits')
                .mockResolvedValue(true);
            try {
                await runWithContext({ actor }, () =>
                    withAiCreditHold(
                        scoped,
                        actor,
                        usageType,
                        1000,
                        async () => {},
                    ),
                );
                expect(await metering.getOutstandingHolds(actor)).toBe(0);
            } finally {
                check.mockRestore();
            }
        });

        it('releases the hold when run throws', async () => {
            const check = vi
                .spyOn(metering, 'hasEnoughCredits')
                .mockResolvedValue(true);
            const boom = new Error('upstream down');
            try {
                await expect(
                    withAiCreditHold(scoped, actor, usageType, 1000, () =>
                        Promise.reject(boom),
                    ),
                ).rejects.toBe(boom);
                expect(await metering.getOutstandingHolds(actor)).toBe(0);
            } finally {
                check.mockRestore();
            }
        });

        it('refuses with a 402 and never runs when the cost is unaffordable', async () => {
            const check = vi
                .spyOn(metering, 'hasEnoughCredits')
                .mockResolvedValue(false);
            const run = vi.fn();
            try {
                await expect(
                    withAiCreditHold(scoped, actor, usageType, 1000, run),
                ).rejects.toMatchObject({
                    statusCode: 402,
                    legacyCode: 'insufficient_funds',
                });
                expect(run).not.toHaveBeenCalled();
            } finally {
                check.mockRestore();
            }
        });
    });
    describe('withStreamedAiCharge', () => {
        const usageType = 'elevenlabs:eleven_v3:character';

        /** Streams `source` through the charge and reads it to the end. */
        const relay = async (source: Readable) => {
            const record = vi.fn();
            const check = vi
                .spyOn(metering, 'hasEnoughCredits')
                .mockResolvedValue(true);
            try {
                const result = await withStreamedAiCharge(
                    scoped,
                    actor,
                    usageType,
                    1000,
                    async () => ({
                        dataType: 'stream',
                        content_type: 'audio/mpeg',
                        stream: source,
                    }),
                    record,
                );
                return { record, stream: result.stream };
            } finally {
                check.mockRestore();
            }
        };

        const read = async (stream: Readable): Promise<Error | undefined> => {
            try {
                for await (const _chunk of stream) void _chunk;
            } catch (e) {
                return e as Error;
            }
            return undefined;
        };

        it('charges once the first byte arrives and releases the hold', async () => {
            const { record, stream } = await relay(
                Readable.from([Buffer.from('ab'), Buffer.from('cd')]),
            );
            expect(record).not.toHaveBeenCalled();

            expect(await read(stream)).toBeUndefined();
            expect(record).toHaveBeenCalledOnce();
            await vi.waitFor(async () =>
                expect(await metering.getOutstandingHolds(actor)).toBe(0),
            );
        });

        it('keeps the hold until the charge is recorded', async () => {
            let landCharge = () => {};
            const charge = new Promise<void>((resolve) => {
                landCharge = resolve;
            });
            const check = vi
                .spyOn(metering, 'hasEnoughCredits')
                .mockResolvedValue(true);
            try {
                const result = await withStreamedAiCharge(
                    scoped,
                    actor,
                    usageType,
                    1000,
                    async () => ({
                        dataType: 'stream',
                        content_type: 'audio/mpeg',
                        stream: Readable.from([Buffer.from('ab')]),
                    }),
                    () => charge,
                );
                expect(await read(result.stream)).toBeUndefined();
                expect(await metering.getOutstandingHolds(actor)).toBe(1000);

                landCharge();
                await vi.waitFor(async () =>
                    expect(await metering.getOutstandingHolds(actor)).toBe(0),
                );
            } finally {
                check.mockRestore();
            }
        });

        it('charges nothing when the upstream fails before its first byte', async () => {
            const { record, stream } = await relay(
                new Readable({
                    read() {
                        this.destroy(new Error('upstream reset'));
                    },
                }),
            );

            expect((await read(stream))?.message).toBe('upstream reset');
            expect(record).not.toHaveBeenCalled();
            await vi.waitFor(async () =>
                expect(await metering.getOutstandingHolds(actor)).toBe(0),
            );
        });

        it('charges in full when the upstream fails after its first byte', async () => {
            let sent = false;
            const { record, stream } = await relay(
                new Readable({
                    read() {
                        if (sent) {
                            this.destroy(new Error('upstream reset'));
                            return;
                        }
                        sent = true;
                        this.push(Buffer.from('ab'));
                    },
                }),
            );

            expect((await read(stream))?.message).toBe('upstream reset');
            expect(record).toHaveBeenCalledOnce();
        });

        it('charges in full when the caller hangs up before the first byte', async () => {
            const source = new Readable({ read() {} });
            const { record, stream } = await relay(source);

            stream.destroy();
            await vi.waitFor(() => expect(source.destroyed).toBe(true));

            expect(record).toHaveBeenCalledOnce();
            await vi.waitFor(async () =>
                expect(await metering.getOutstandingHolds(actor)).toBe(0),
            );
        });
    });
});
