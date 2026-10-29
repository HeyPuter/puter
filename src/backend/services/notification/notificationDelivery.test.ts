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
import { v4 as uuidv4 } from 'uuid';
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
import { accountSocketRoom, SocketService } from '../socket/SocketService.js';
import { NOTIF_RECEIPT_EVENT } from './notificationSocket.js';
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

const APP_UID = 'app-receipts';
// App tokens carry an app uid only in the `app-<uuid>` shape.
const OWN_APP = `app-${uuidv4()}`;

/** A booted server, one user, and what the bus reported for them. */
const withServer = (opts: {
    cluster: boolean;
    events?: boolean;
    appUid?: string;
}) => {
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

    const connect = (
        auth: Record<string, unknown>,
        token = state.user.token,
    ): Promise<ClientSocket> =>
        new Promise((resolve, reject) => {
            const socket = ioClient(state.origin, {
                auth: { auth_token: token, ...auth },
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
                state.server.services.socket.has({
                    room: accountSocketRoom(state.userId),
                }),
            ).toBe(false),
        );

    /** An app row and a token for the user acting through it. */
    const appToken = async (appUid: string): Promise<string> => {
        await state.server.clients.db.write(
            'INSERT INTO `apps` (`uid`, `name`, `title`, `index_url`, `owner_user_id`) VALUES (?, ?, ?, ?, ?)',
            [
                appUid,
                appUid,
                appUid,
                `https://${appUid}.example/`,
                state.userId,
            ],
        );
        const user = await state.server.stores.user.getById(state.userId);
        return state.server.services.auth.getUserAppToken(
            { user: user as never, effectiveApp: null } as never,
            appUid,
        );
    };

    beforeAll(async () => {
        const port = await allocateEphemeralPort();
        state.server = await setupTestServer(
            {
                port,
                notificationAckTimeoutMs: ACK_TIMEOUT_MS,
                ...(opts.events ? { events: { enabled: true } } : {}),
            } as never,
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
                ? { type, appUid: opts.appUid ?? APP_UID }
                : { type },
        ))!;

    /** The desktop's settle, or with `appUid` the app's own. */
    const settledFor = async (
        uid: string,
        appUid?: string,
    ): Promise<Settled> => {
        const match = (s: Settled) => s.uid === uid && s.appUid === appUid;
        await vi.waitFor(() => expect(state.settled.some(match)).toBe(true), {
            timeout: 3_000,
        });
        return state.settled.find(match)!;
    };

    const peerRegionHolds = () => {
        const eventForward = state.server.services.eventForward;
        vi.spyOn(eventForward, 'active', 'get').mockReturnValue(true);
        vi.spyOn(eventForward, 'regionsFor').mockResolvedValue(['peer-a']);
        return eventForward;
    };

    return { state, connect, appToken, notify, settledFor, peerRegionHolds };
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
            everySocketAcks: true,
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
            everySocketAcks: false,
            responders: [],
        });
        await expect(got).resolves.toMatchObject({ uid });
    });

    it('says an older tab beside an acknowledging one does not acknowledge', async () => {
        await connect({ acks: ['notif.message'] });
        await connect({});

        const uid = await notify();

        expect(await settledFor(uid)).toMatchObject({
            outcome: 'unreceived',
            ackCapable: true,
            everySocketAcks: false,
            complete: true,
        });
    });

    it('counts a socket that acknowledges only other events as current', async () => {
        await connect({ acks: ['notif.message'] });
        // puter.js's own socket on the desktop page, which never shows these.
        await connect({ acks: [NOTIF_RECEIPT_EVENT] });

        const uid = await notify();

        expect(await settledFor(uid)).toMatchObject({
            outcome: 'unreceived',
            ackCapable: true,
            everySocketAcks: true,
            complete: true,
        });
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

type Ack = (response: unknown) => void;

/** App receipts, asked the way a push decision asks for them. */
const withAppReceipts = (opts: { cluster: boolean }) => {
    const server = withServer({ ...opts, events: true, appUid: OWN_APP });
    const { state, connect, appToken, notify } = server;
    let token = '';

    beforeAll(async () => {
        token = await appToken(OWN_APP);
    });

    const appSocket = (auth: Record<string, unknown> = {}) =>
        connect(auth, token);

    /** A page that answers every ask, recording what it was asked. */
    const answeringPage = async (asked: unknown[] = []) => {
        const page = await appSocket({ acks: [NOTIF_RECEIPT_EVENT] });
        page.on(NOTIF_RECEIPT_EVENT, (data: unknown, ack: Ack) => {
            asked.push(data);
            ack({ visibilityState: 'visible' });
        });
        return page;
    };

    const ask = async () => {
        const uid = await notify('app.message');
        const settled = await state.server.services.notification.appReceipt({
            userId: state.userId,
            appUid: OWN_APP,
            uid,
            type: 'app.message',
            sendId: state.written.at(-1)!.sendId,
        });
        return { uid, settled: settled! };
    };

    return { ...server, appSocket, answeringPage, ask };
};

describe('live receipts from an app’s own sockets', () => {
    const {
        state,
        connect,
        appToken,
        notify,
        settledFor,
        peerRegionHolds,
        appSocket,
        answeringPage,
        ask,
    } = withAppReceipts({ cluster: true });

    it('settles as received once a page of the app acknowledges', async () => {
        const asked: unknown[] = [];
        await answeringPage(asked);

        const { uid, settled } = await ask();

        const expected = {
            sendId: state.written[0].sendId,
            uid,
            userId: state.userId,
            type: 'app.message',
            appUid: OWN_APP,
            outcome: 'received',
            ackCapable: true,
            everySocketAcks: true,
            complete: true,
            peerRegions: false,
            responders: [{ visibilityState: 'visible' }],
        };
        expect(settled).toEqual(expected);
        expect(await settledFor(uid, OWN_APP)).toEqual(expected);
        expect(asked).toEqual([{ uid }]);
        // The desktop settles its own copy apart from the app's.
        expect(await settledFor(uid)).toMatchObject({ outcome: 'no-socket' });
    });

    it('settles as unreceived when the app’s page never acknowledges', async () => {
        await appSocket({ acks: [NOTIF_RECEIPT_EVENT] });

        const { settled } = await ask();

        expect(settled).toMatchObject({
            outcome: 'unreceived',
            ackCapable: true,
            everySocketAcks: true,
            complete: true,
            responders: [],
        });
    });

    it('reports an app socket that never offered to acknowledge as not ack-capable', async () => {
        await appSocket();

        const { settled } = await ask();

        expect(settled).toMatchObject({
            outcome: 'unreceived',
            ackCapable: false,
            everySocketAcks: false,
            complete: true,
        });
    });

    it('says an older page beside an acknowledging one does not acknowledge', async () => {
        await answeringPage();
        await appSocket();

        expect((await ask()).settled).toMatchObject({
            outcome: 'received',
            ackCapable: true,
            everySocketAcks: false,
        });
    });

    it('says an older page beside a silent one does not acknowledge', async () => {
        await appSocket({ acks: [NOTIF_RECEIPT_EVENT] });
        await appSocket();

        expect((await ask()).settled).toMatchObject({
            outcome: 'unreceived',
            ackCapable: true,
            everySocketAcks: false,
            complete: true,
        });
    });

    it('settles as no-socket with no page of the app open', async () => {
        expect((await ask()).settled).toMatchObject({
            outcome: 'no-socket',
            ackCapable: false,
            everySocketAcks: true,
            complete: true,
        });
    });

    it('does not ask the desktop or another app', async () => {
        const desktop = await connect({ acks: [NOTIF_RECEIPT_EVENT] });
        const other = await connect(
            { acks: [NOTIF_RECEIPT_EVENT] },
            await appToken(`app-${uuidv4()}`),
        );
        const asked: unknown[] = [];
        for (const socket of [desktop, other]) {
            socket.on(NOTIF_RECEIPT_EVENT, (data: unknown, ack: Ack) => {
                asked.push(data);
                ack({ visibilityState: 'visible' });
            });
        }

        expect((await ask()).settled).toMatchObject({ outcome: 'no-socket' });
        expect(asked).toEqual([]);
    });

    it('settles as remote-only when only a peer region holds the app', async () => {
        const eventForward = peerRegionHolds();

        expect((await ask()).settled).toMatchObject({
            outcome: 'remote-only',
            peerRegions: true,
        });
        expect(eventForward.regionsFor).toHaveBeenCalledWith(
            state.userId,
            OWN_APP,
        );
    });

    it('asks nothing of the app when nobody asks for a receipt', async () => {
        const asked: unknown[] = [];
        await answeringPage(asked);

        const uid = await notify('app.message');

        await settledFor(uid);
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(state.settled.filter((s) => s.appUid)).toEqual([]);
        expect(asked).toEqual([]);
    });
});

describe('app receipts where the adapter cannot count servers', () => {
    const { appSocket, answeringPage, ask } = withAppReceipts({
        cluster: false,
    });

    it('still collects this node’s acknowledgements', async () => {
        await answeringPage();

        expect((await ask()).settled).toMatchObject({
            outcome: 'received',
            everySocketAcks: true,
            complete: false,
        });
    });

    it('says an older page here does not acknowledge', async () => {
        await appSocket({ acks: [NOTIF_RECEIPT_EVENT] });
        await appSocket();

        expect((await ask()).settled).toMatchObject({
            outcome: 'unreceived',
            ackCapable: true,
            everySocketAcks: false,
            complete: false,
        });
    });
});
