import { Readable } from 'node:stream';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Actor } from '../../../core/actor.ts';
import { PuterServer } from '../../../server.ts';
import type { MeteringService } from '../../../services/metering/MeteringService.ts';
import { setupTestServer } from '../../../testUtil.ts';
import {
    type AiMeteringService,
    withAiCostFactor,
} from '../../../util/aiCostFactor.ts';
import { withStreamedAiCharge } from './streamedAiCharge.ts';

describe('withStreamedAiCharge', () => {
    let server: PuterServer;
    let metering: MeteringService;
    let scoped: AiMeteringService;
    let actor: Actor;

    beforeAll(async () => {
        server = await setupTestServer();
        metering = server.services.metering;
        scoped = withAiCostFactor(metering, server.clients.event, 'ai-chat');
        // Counters buffer before they're written onward; stop the drain loop
        // so nothing fires mid-assertion.
        await server.stores.meteringBuffer.onServerShutdown();
    });

    beforeEach(() => {
        actor = {
            user: {
                uuid: `ai-stream-${Math.random().toString(36).slice(2)}`,
                username: 'ai-stream',
                email: 'ai-stream@test.com',
            },
        } as Actor;
    });

    const usageType = 'elevenlabs:eleven_v3:character';

    /** Streams `source` through the charge and reads it to the end. */
    const relay = async (source: Readable) => {
        const record = vi.fn();
        const check = vi
            .spyOn(metering, 'reserveCreditsIfAffordable')
            .mockImplementation((who, amount, opts) =>
                metering.reserveCredits(who, amount, opts),
            );
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
            .spyOn(metering, 'reserveCreditsIfAffordable')
            .mockImplementation((who, amount, opts) =>
                metering.reserveCredits(who, amount, opts),
            );
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

    it('renews the hold until a slow charge lands', async () => {
        vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
        const refresh = vi.spyOn(server.stores.creditHold, 'refresh');
        const check = vi
            .spyOn(metering, 'reserveCreditsIfAffordable')
            .mockImplementation((who, amount, opts) =>
                metering.reserveCredits(who, amount, opts),
            );
        let landCharge = () => {};
        const charge = new Promise<void>((resolve) => {
            landCharge = resolve;
        });
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

            await vi.advanceTimersByTimeAsync(11 * 60 * 1000);
            expect(refresh).toHaveBeenCalledTimes(2);
            expect(await metering.getOutstandingHolds(actor)).toBe(1000);

            landCharge();
            await vi.waitFor(async () =>
                expect(await metering.getOutstandingHolds(actor)).toBe(0),
            );
            await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
            expect(refresh).toHaveBeenCalledTimes(2);
        } finally {
            check.mockRestore();
            refresh.mockRestore();
            vi.useRealTimers();
        }
    });

    it('renews the hold while a slow upstream is still opening', async () => {
        vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
        const refresh = vi.spyOn(server.stores.creditHold, 'refresh');
        const check = vi
            .spyOn(metering, 'reserveCreditsIfAffordable')
            .mockImplementation((who, amount, opts) =>
                metering.reserveCredits(who, amount, opts),
            );
        let opened = () => {};
        const opening = new Promise<void>((resolve) => {
            opened = resolve;
        });
        try {
            const pending = withStreamedAiCharge(
                scoped,
                actor,
                usageType,
                1000,
                async () => {
                    await opening;
                    return {
                        dataType: 'stream',
                        content_type: 'audio/mpeg',
                        stream: Readable.from([Buffer.from('ab')]),
                    };
                },
                () => undefined,
            );
            await vi.waitFor(async () =>
                expect(await metering.getOutstandingHolds(actor)).toBe(
                    1000,
                ),
            );
            await vi.advanceTimersByTimeAsync(9 * 60 * 1000);
            expect(refresh).toHaveBeenCalledTimes(1);

            opened();
            expect(await read((await pending).stream)).toBeUndefined();
            await vi.waitFor(async () =>
                expect(await metering.getOutstandingHolds(actor)).toBe(0),
            );
        } finally {
            check.mockRestore();
            refresh.mockRestore();
            vi.useRealTimers();
        }
    });

    it('releases the hold when recording the charge throws', async () => {
        const check = vi
            .spyOn(metering, 'reserveCreditsIfAffordable')
            .mockImplementation((who, amount, opts) =>
                metering.reserveCredits(who, amount, opts),
            );
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
                () => {
                    throw new Error('metering down');
                },
            );
            expect(await read(result.stream)).toBeUndefined();
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
