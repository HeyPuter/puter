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
import type { AiCostFactorEvent } from '../../clients/event/types.ts';
import { PuterServer } from '../../server.ts';
import { setupTestServer } from '../../testUtil.ts';
import { aiModelKey } from './aiCostFactor.ts';
import type { MeteringService } from './MeteringService.ts';

type Listener = (
    key: `ai.cost.factor.${string}`,
    data: AiCostFactorEvent,
) => void;

describe('AI cost factor', () => {
    let server: PuterServer;
    let metering: MeteringService;
    let scoped: MeteringService;
    let actor: Actor;
    let listeners: Listener[];

    beforeAll(async () => {
        server = await setupTestServer();
        metering = server.services.metering;
        scoped = metering.withAiCostFactor('ai-chat');
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
        const again = scoped.withAiCostFactor('ai-chat');
        expect(again).toBe(scoped);

        const result = await again.incrementUsage(
            actor,
            'claude:sonnet:input_tokens',
            1,
            1000,
        );
        expect(result.total).toBe(1040);
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
});
