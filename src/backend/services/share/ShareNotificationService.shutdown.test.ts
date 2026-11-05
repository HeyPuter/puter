import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Actor } from '../../core/actor.js';
import type { PuterServer } from '../../server.js';
import { setupTestServer } from '../../testUtil.js';
import type { ResolvedShare } from './ShareService.js';

describe('ShareNotificationService shutdown drain', () => {
    let server: PuterServer;
    beforeEach(async () => {
        server = await setupTestServer({
            email: { from: 'test@puter.localhost', host: '127.0.0.1', port: 1 },
            share_notify_limits: { emailBatchSeconds: 0.01 },
        } as never);
    });
    afterEach(async () => {
        vi.useRealTimers();
        await server.services.shareNotification.onServerPrepareShutdown();
        await server.services.shareNotification.onServerShutdown();
        await server.shutdown();
        vi.restoreAllMocks();
    });

    const queueInvite = async (email: string, issuerId = 7) => {
        await server.services.shareNotification.notifyShared(
            {
                user: { id: issuerId, username: 'sender' },
                effectiveApp: null,
            } as Actor,
            [
                {
                    pending: true,
                    isNew: true,
                    recipientEmail: email,
                    name: 'shared.txt',
                } as ResolvedShare,
            ],
        );
    };

    it.each([false, true])(
        'awaits an active timer send and its failure requeue %s',
        async (failSend) => {
            const email = `active-${failSend}@puter.local`;
            let release!: () => void;
            const held = new Promise<void>((resolve) => {
                release = resolve;
            });
            const send = vi
                .spyOn(server.clients.email, 'sendRaw')
                .mockImplementation(async () => {
                    await held;
                    if (failSend) throw new Error('transport unavailable');
                    return null;
                });
            await queueInvite(email);
            await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
            const list = async () =>
                server.stores.kv.list({
                    as: 'keys',
                    pattern: `share:digest:invite:${email}:`,
                });
            expect((await list()).res).toEqual([]);
            let finished = false;
            const draining = server.services.shareNotification
                .onServerPrepareShutdown()
                .then(() => {
                    finished = true;
                });
            try {
                await new Promise((resolve) => setTimeout(resolve, 20));
                expect(finished).toBe(false);
            } finally {
                release();
                await draining;
            }
            expect((await list()).res).toHaveLength(failSend ? 1 : 0);
        },
    );

    it('waits for an active send before draining entries queued meanwhile', async () => {
        let releaseFirst!: () => void;
        let releaseTail!: () => void;
        const first = new Promise<void>((resolve) => {
            releaseFirst = resolve;
        });
        const tail = new Promise<void>((resolve) => {
            releaseTail = resolve;
        });
        const send = vi
            .spyOn(server.clients.email, 'sendRaw')
            .mockImplementationOnce(async () => {
                await first;
                return null;
            })
            .mockImplementationOnce(async () => {
                await tail;
                return null;
            });
        await queueInvite('meanwhile@puter.local');
        await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
        (
            server.services.shareNotification.config.share_notify_limits as {
                emailBatchSeconds: number;
            }
        ).emailBatchSeconds = 600;
        await queueInvite('meanwhile@puter.local', 8);
        let finished = false;
        const draining = server.services.shareNotification
            .onServerPrepareShutdown()
            .then(() => {
                finished = true;
            });
        try {
            releaseFirst();
            await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
            expect(finished).toBe(false);
        } finally {
            releaseFirst();
            releaseTail();
            await draining;
        }
        expect(send).toHaveBeenCalledTimes(2);
    });
    it.each(['onServerPrepareShutdown', 'onServerShutdown'] as const)(
        'bounds %s while an active send is hung',
        async (hook) => {
            let release!: () => void;
            const held = new Promise<void>((resolve) => {
                release = resolve;
            });
            const send = vi
                .spyOn(server.clients.email, 'sendRaw')
                .mockImplementationOnce(async () => {
                    await held;
                    return null;
                });
            await queueInvite(`hung-${hook}@puter.local`);
            await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
            vi.useFakeTimers();
            try {
                let finished = false;
                const draining = server.services.shareNotification[hook]().then(
                    () => {
                        finished = true;
                    },
                );
                await vi.advanceTimersByTimeAsync(4_999);
                expect(finished).toBe(false);
                await vi.advanceTimersByTimeAsync(1);
                await draining;
            } finally {
                release();
                vi.useRealTimers();
            }
        },
    );

    it('drains a digest queued after prepare at shutdown', async () => {
        await server.services.shareNotification.onServerPrepareShutdown();
        const send = vi
            .spyOn(server.clients.email, 'sendRaw')
            .mockResolvedValue(null);
        (
            server.services.shareNotification.config.share_notify_limits as {
                emailBatchSeconds: number;
            }
        ).emailBatchSeconds = 600;
        await queueInvite('tail@puter.local');
        await server.services.shareNotification.onServerShutdown();
        expect(send).toHaveBeenCalledTimes(1);
        expect(send.mock.calls[0][0].to).toBe('tail@puter.local');
        await new Promise((resolve) => setTimeout(resolve, 30));
        expect(send).toHaveBeenCalledTimes(1);
    });
});
