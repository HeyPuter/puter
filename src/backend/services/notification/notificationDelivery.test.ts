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

import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
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
import type { EventMap } from '../../clients/event/types.js';
import type { PuterServer } from '../../server.js';
import { SocketService } from '../socket/SocketService.js';
import {
    allocateEphemeralPort,
    createTestUser,
    setupTestServer,
    type TestUserCredentials,
} from '../../testUtil.js';

type Settled = EventMap['notif.delivery.settled'];
type Written = EventMap['notif.written'];

const ACK_TIMEOUT_MS = 300;

interface ClusterAdapter {
    serverCount: () => Promise<number>;
    fetchSockets: (opts: unknown) => Promise<unknown[]>;
    doPublish: (message: unknown) => Promise<string>;
}

/** A booted server, one user, and what the bus reported for them. */
const withServer = (opts: { cluster: boolean }) => {
    const state = {
        server: null as unknown as PuterServer,
        origin: '',
        user: null as unknown as TestUserCredentials,
        userId: 0,
        adapter: null as unknown as ClusterAdapter,
        openSockets: [] as ClientSocket[],
        settled: [] as Settled[],
        written: [] as Written[],
    };
    const onSettled = (_key: string, data: unknown) => {
        state.settled.push(data as Settled);
    };
    const onWritten = (_key: string, data: unknown) => {
        state.written.push(data as Written);
    };

    const connect = (auth: Record<string, unknown>): Promise<ClientSocket> =>
        new Promise((resolve, reject) => {
            const socket = ioClient(state.origin, {
                auth: { auth_token: state.user.token, ...auth },
                transports: ['websocket'],
                reconnection: false,
            });
            state.openSockets.push(socket);
            socket.on('connect', () => resolve(socket));
            socket.on('connect_error', reject);
        });

    const emptyRoom = () =>
        vi.waitFor(() =>
            expect(
                state.server.services.socket.has({ room: state.userId }),
            ).toBe(false),
        );

    beforeAll(async () => {
        const port = await allocateEphemeralPort();
        state.server = await setupTestServer(
            { port, notificationAckTimeoutMs: ACK_TIMEOUT_MS } as never,
            { listen: true },
        );
        state.origin = `http://puter.localhost:${port}`;
        state.user = await createTestUser(state.server, {
            username: `receipt-${opts.cluster ? 'c' : 'l'}`,
            password: 'receipt-user-password',
        });
        state.userId = (await state.server.stores.user.getByUsername(
            state.user.username,
        ))!.id;
        const seen = new Promise<ClusterAdapter>((resolve) => {
            state.server.clients.event.on(
                'web.socket.connected',
                (_k, data) => {
                    resolve(
                        (data as { socket: { nsp: { adapter: never } } }).socket
                            .nsp.adapter,
                    );
                },
            );
        });
        const first = await connect({});
        state.adapter = await seen;
        first.disconnect();
        state.openSockets.length = 0;
        await emptyRoom();
        if (opts.cluster) await takeClusterPath();
        state.server.clients.event.on('notif.delivery.settled', onSettled);
        state.server.clients.event.on('notif.written', onWritten);
    }, 60_000);

    // One node counted, nothing published: the mock is shared across servers.
    const stubCluster = () => {
        vi.spyOn(
            Object.getPrototypeOf(state.adapter) as ClusterAdapter,
            'serverCount',
        ).mockResolvedValue(1);
        vi.spyOn(state.adapter, 'doPublish').mockResolvedValue('');
    };

    /** Once a count succeeds, the cluster path stays in use. */
    const takeClusterPath = async () => {
        const retryMs = SocketService.COUNT_RETRY_MS;
        SocketService.COUNT_RETRY_MS = 0;
        stubCluster();
        try {
            await vi.waitFor(async () =>
                expect(
                    (
                        await state.server.services.socket.sendWithAck(
                            { room: 'nobody-here' },
                            'demo.ack',
                            {},
                            { timeoutMs: 100 },
                        )
                    ).complete,
                ).toBe(true),
            );
        } finally {
            SocketService.COUNT_RETRY_MS = retryMs;
            vi.restoreAllMocks();
        }
    };

    beforeEach(() => {
        if (opts.cluster) stubCluster();
    });

    afterEach(async () => {
        vi.restoreAllMocks();
        for (const socket of state.openSockets.splice(0)) socket.disconnect();
        await emptyRoom();
        state.settled.length = 0;
        state.written.length = 0;
    });

    afterAll(async () => {
        state.server?.clients.event.off('notif.delivery.settled', onSettled);
        state.server?.clients.event.off('notif.written', onWritten);
        await state.server?.shutdown();
    }, 60_000);

    const notify = async (
        type: 'share.received' | 'app.message' = 'share.received',
    ): Promise<string> =>
        (await state.server.services.notification.notify(
            [state.userId],
            { title: 'hello' },
            type === 'app.message'
                ? { type, appUid: 'app-receipts' }
                : { type },
        ))!;

    const settledFor = async (uid: string): Promise<Settled> => {
        await vi.waitFor(
            () => expect(state.settled.some((s) => s.uid === uid)).toBe(true),
            { timeout: 3_000 },
        );
        return state.settled.find((s) => s.uid === uid)!;
    };

    const peerRegionHolds = () => {
        const eventForward = state.server.services.eventForward;
        vi.spyOn(eventForward, 'active', 'get').mockReturnValue(true);
        vi.spyOn(eventForward, 'regionsFor').mockResolvedValue(['peer-a']);
        return eventForward;
    };

    return { state, connect, notify, settledFor, peerRegionHolds };
};

describe('live notification delivery receipts', () => {
    const { state, connect, notify, settledFor, peerRegionHolds } = withServer({
        cluster: true,
    });

    it('settles as received once a tab acknowledges, with its visibility', async () => {
        const tab = await connect({ acks: ['notif.message'] });
        const got: unknown[] = [];
        tab.on('notif.message', (msg: unknown, ack: (r: unknown) => void) => {
            got.push(msg);
            ack({ visibilityState: 'hidden' });
        });

        const uid = await notify();

        const [written] = state.written;
        expect(await settledFor(uid)).toEqual({
            sendId: written.sendId,
            uid,
            userId: state.userId,
            type: 'share.received',
            outcome: 'received',
            ackCapable: true,
            complete: true,
            peerRegions: false,
            responders: [{ visibilityState: 'hidden' }],
        });
        expect(written.sendId).toEqual(expect.any(String));
        expect(got).toEqual([
            {
                uid,
                notification: { title: 'hello', type: 'share.received' },
            },
        ]);
    });

    it('settles as unreceived when no tab acknowledges within the window', async () => {
        const tab = await connect({ acks: ['notif.message'] });
        const got = new Promise((resolve) =>
            tab.once('notif.message', resolve),
        );

        const started = Date.now();
        const uid = await notify();
        const result = await settledFor(uid);

        expect(Date.now() - started).toBeGreaterThanOrEqual(
            ACK_TIMEOUT_MS - 50,
        );
        expect(result).toMatchObject({
            outcome: 'unreceived',
            ackCapable: true,
            complete: true,
            peerRegions: false,
            responders: [],
        });
        await expect(got).resolves.toMatchObject({ uid });
    });

    it('reports a socket that never offered to acknowledge as not ack-capable', async () => {
        const tab = await connect({});
        const got = new Promise((resolve) =>
            tab.once('notif.message', resolve),
        );

        const uid = await notify();

        expect(await settledFor(uid)).toMatchObject({
            outcome: 'unreceived',
            ackCapable: false,
            responders: [],
        });
        await expect(got).resolves.toMatchObject({ uid });
    });

    it('settles as no-socket when the user has no connection anywhere', async () => {
        const uid = await notify();
        expect(await settledFor(uid)).toMatchObject({
            outcome: 'no-socket',
            ackCapable: false,
            complete: true,
            peerRegions: false,
        });
    });

    it('settles as remote-only when only a peer region holds a socket', async () => {
        const eventForward = peerRegionHolds();

        const uid = await notify();

        expect(await settledFor(uid)).toMatchObject({
            outcome: 'remote-only',
            ackCapable: false,
            peerRegions: true,
        });
        expect(eventForward.regionsFor).toHaveBeenCalledWith(
            state.userId,
            null,
        );
    });

    it('says a peer region holds the user beside an unacknowledged tab here', async () => {
        await connect({ acks: ['notif.message'] });
        peerRegionHolds();

        const uid = await notify();

        expect(await settledFor(uid)).toMatchObject({
            outcome: 'unreceived',
            ackCapable: true,
            peerRegions: true,
        });
    });

    it('never reads an incomplete count as nobody being here', async () => {
        vi.spyOn(state.adapter, 'fetchSockets').mockRejectedValue(
            new Error('timeout reached'),
        );
        vi.spyOn(console, 'warn').mockImplementation(() => {});

        const uid = await notify();

        expect(await settledFor(uid)).toMatchObject({
            outcome: 'unreceived',
            ackCapable: false,
            complete: false,
        });
    });

    it('settles an app message on the desktop wire with its type', async () => {
        const tab = await connect({ acks: ['notif.message'] });
        tab.on('notif.message', (_m: unknown, ack: (r: unknown) => void) =>
            ack({ visibilityState: 'visible' }),
        );

        const uid = await notify('app.message');

        expect(await settledFor(uid)).toMatchObject({
            type: 'app.message',
            outcome: 'received',
            responders: [{ visibilityState: 'visible' }],
        });
    });

    it('settles a rewritten notification under a send id of its own', async () => {
        const tab = await connect({ acks: ['notif.message'] });
        tab.on('notif.message', (_m: unknown, ack: (r: unknown) => void) =>
            ack({ visibilityState: 'visible' }),
        );
        const uid = await notify();
        const first = await settledFor(uid);
        state.settled.length = 0;

        await state.server.services.notification.notifyUpdate(
            uid,
            state.userId,
            { title: 'hello again' },
            { type: 'share.received' },
        );

        const again = await settledFor(uid);
        expect(again).toMatchObject({ outcome: 'received' });
        expect(again.sendId).toEqual(expect.any(String));
        expect(again.sendId).not.toBe(first.sendId);
        await vi.waitFor(() => expect(state.written).toHaveLength(2));
        expect(state.written[1].sendId).toBe(again.sendId);
    });

    it('sends nothing and settles nothing for a silent notification', async () => {
        await state.server.services.notification.notify(
            [state.userId],
            { title: 'quiet' },
            { type: 'share.received', silent: true },
        );
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(state.settled).toEqual([]);
    });
});

describe('live notification receipts where the adapter cannot count servers', () => {
    const { connect, notify, settledFor } = withServer({ cluster: false });

    it('still collects this node’s acknowledgements', async () => {
        const tab = await connect({ acks: ['notif.message'] });
        tab.on('notif.message', (_m: unknown, ack: (r: unknown) => void) =>
            ack({ visibilityState: 'visible' }),
        );

        const uid = await notify();

        expect(await settledFor(uid)).toMatchObject({
            outcome: 'received',
            complete: false,
        });
    });

    it('reports no socket here as unreceived, not as nobody anywhere', async () => {
        const uid = await notify();
        expect(await settledFor(uid)).toMatchObject({
            outcome: 'unreceived',
            ackCapable: false,
            complete: false,
        });
    });
});
