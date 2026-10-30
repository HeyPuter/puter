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
                        await state.server.services.socket.askWithAck(
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

    /** Notify, then ask for the receipt the way a push decision does. */
    const ask = async (
        appUid: string | null = null,
        type: 'share.received' | 'app.message' = appUid
            ? 'app.message'
            : 'share.received',
    ) => {
        const uid = await notify(type);
        const settled = await state.server.services.notification.receipt({
            userId: state.userId,
            appUid,
            uid,
            type,
            sendId: state.written.at(-1)!.sendId,
        });
        return { uid, settled: settled! };
    };

    const peerRegionHolds = () => {
        const eventForward = state.server.services.eventForward;
        vi.spyOn(eventForward, 'active', 'get').mockReturnValue(true);
        vi.spyOn(eventForward, 'regionsFor').mockResolvedValue(['peer-a']);
        return eventForward;
    };

    return { state, connect, appToken, notify, ask, peerRegionHolds };
};

type Ack = (response: unknown) => void;

/** A desktop tab: notes each live `notif.message`, answers receipts for those. */
const desktopTab = (socket: ClientSocket, visibilityState: string | null) => {
    const got: unknown[] = [];
    socket.on('notif.message', (msg: unknown, ...rest: unknown[]) => {
        got.push([msg, ...rest]);
    });
    socket.on(NOTIF_RECEIPT_EVENT, (_data: unknown, ack: Ack) => {
        if (visibilityState) ack({ visibilityState });
    });
    return got;
};

describe('live notification delivery receipts', () => {
    const { state, connect, ask, peerRegionHolds } = withServer({
        cluster: true,
    });

    it('sends notif.message plainly and settles nothing until asked', async () => {
        const got = desktopTab(
            await connect({ acks: [NOTIF_RECEIPT_EVENT] }),
            'visible',
        );

        const uid = (await state.server.services.notification.notify(
            [state.userId],
            { title: 'hello' },
            { type: 'share.received' },
        ))!;
        await vi.waitFor(() => expect(got).toHaveLength(1));
        await new Promise((resolve) => setTimeout(resolve, 100));

        expect(got).toEqual([
            [
                {
                    uid,
                    notification: { title: 'hello', type: 'share.received' },
                },
            ],
        ]);
        expect(state.settled).toEqual([]);
    });

    it('settles as received once a tab acknowledges, with its visibility', async () => {
        desktopTab(await connect({ acks: [NOTIF_RECEIPT_EVENT] }), 'hidden');

        const { uid, settled } = await ask();

        const expected = {
            sendId: state.written[0].sendId,
            uid,
            userId: state.userId,
            type: 'share.received',
            outcome: 'received',
            ackCapable: true,
            everySocketAcks: true,
            complete: true,
            peerRegions: false,
            responders: [{ visibilityState: 'hidden' }],
        };
        expect(settled).toEqual(expected);
        expect(state.settled).toEqual([expected]);
    });

    it('passes a tab`s focus and own display through, typed strictly', async () => {
        const answers = [
            {
                received: true,
                visibilityState: 'hidden',
                focused: false,
                showsOwn: true,
            },
            {
                received: true,
                visibilityState: 'nope',
                focused: 1,
                showsOwn: 'yes',
            },
        ];
        for (const answer of answers) {
            const tab = await connect({ acks: [NOTIF_RECEIPT_EVENT] });
            tab.on(NOTIF_RECEIPT_EVENT, (_data: unknown, ack: Ack) =>
                ack(answer),
            );
        }

        const { settled } = await ask();

        expect(settled.outcome).toBe('received');
        expect(settled.responders).toEqual(
            expect.arrayContaining([
                { visibilityState: 'hidden', focused: false, showsOwn: true },
                { visibilityState: 'unknown' },
            ]),
        );
        expect(settled.responders).toHaveLength(2);
    });

    it('settles as unreceived when every tab answers that it never got it', async () => {
        const tab = await connect({ acks: [NOTIF_RECEIPT_EVENT] });
        tab.on(NOTIF_RECEIPT_EVENT, (_data: unknown, ack: Ack) =>
            ack({ received: false }),
        );

        const { settled } = await ask();

        expect(settled).toMatchObject({
            outcome: 'unreceived',
            ackCapable: true,
            everySocketAcks: true,
            complete: true,
            responders: [],
        });
    });

    it('counts only the tabs that got it as responders', async () => {
        desktopTab(await connect({ acks: [NOTIF_RECEIPT_EVENT] }), 'visible');
        const missed = await connect({ acks: [NOTIF_RECEIPT_EVENT] });
        missed.on(NOTIF_RECEIPT_EVENT, (_data: unknown, ack: Ack) =>
            ack({ received: false }),
        );

        expect((await ask()).settled).toMatchObject({
            outcome: 'received',
            responders: [{ visibilityState: 'visible' }],
        });
    });

    it('settles as unreceived when no tab acknowledges within the window', async () => {
        desktopTab(await connect({ acks: [NOTIF_RECEIPT_EVENT] }), null);

        const started = Date.now();
        const { settled } = await ask();

        expect(Date.now() - started).toBeGreaterThanOrEqual(
            ACK_TIMEOUT_MS - 50,
        );
        expect(settled).toMatchObject({
            outcome: 'unreceived',
            ackCapable: true,
            everySocketAcks: true,
            complete: true,
            peerRegions: false,
            responders: [],
        });
    });

    it('reports a socket that never offered to acknowledge as not ack-capable', async () => {
        await connect({});

        expect((await ask()).settled).toMatchObject({
            outcome: 'unreceived',
            ackCapable: false,
            everySocketAcks: false,
            responders: [],
        });
    });

    it('says an older tab beside an acknowledging one does not acknowledge', async () => {
        desktopTab(await connect({ acks: [NOTIF_RECEIPT_EVENT] }), 'visible');
        await connect({});

        expect((await ask()).settled).toMatchObject({
            outcome: 'received',
            ackCapable: true,
            everySocketAcks: false,
            complete: true,
        });
    });

    it('settles as no-socket when the user has no connection anywhere', async () => {
        expect((await ask()).settled).toMatchObject({
            outcome: 'no-socket',
            ackCapable: false,
            complete: true,
            peerRegions: false,
        });
    });

    it('settles as remote-only when only a peer region holds a socket', async () => {
        const eventForward = peerRegionHolds();

        expect((await ask()).settled).toMatchObject({
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
        desktopTab(await connect({ acks: [NOTIF_RECEIPT_EVENT] }), null);
        peerRegionHolds();

        expect((await ask()).settled).toMatchObject({
            outcome: 'unreceived',
            ackCapable: true,
            peerRegions: true,
        });
    });

    it('sends nothing for a silent notification', async () => {
        const got = desktopTab(
            await connect({ acks: [NOTIF_RECEIPT_EVENT] }),
            'visible',
        );
        await state.server.services.notification.notify(
            [state.userId],
            { title: 'quiet' },
            { type: 'share.received', silent: true },
        );
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(got).toEqual([]);
        expect(state.written).toEqual([]);
    });
});

describe('live notification receipts where the adapter cannot count servers', () => {
    const { connect, ask } = withServer({ cluster: false });

    it('still collects this node’s acknowledgements', async () => {
        desktopTab(await connect({ acks: [NOTIF_RECEIPT_EVENT] }), 'visible');

        expect((await ask()).settled).toMatchObject({
            outcome: 'received',
            complete: false,
        });
    });

    it('reports no socket here as unreceived, not as nobody anywhere', async () => {
        expect((await ask()).settled).toMatchObject({
            outcome: 'unreceived',
            ackCapable: false,
            complete: false,
        });
    });
});

/** App receipts, asked the way a push decision asks for them. */
const withAppReceipts = (opts: { cluster: boolean }) => {
    const server = withServer({ ...opts, events: true, appUid: OWN_APP });
    const { connect, appToken } = server;
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

    const askApp = () => server.ask(OWN_APP);

    return { ...server, appSocket, answeringPage, ask: askApp };
};

describe('live receipts from an app’s own sockets', () => {
    const {
        state,
        connect,
        appToken,
        notify,
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
        expect(state.settled).toEqual([expected]);
        expect(asked).toEqual([{ uid }]);
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

        await notify('app.message');

        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(state.settled).toEqual([]);
        expect(asked).toEqual([]);
    });

    it('does not ask the app’s pages about the desktop’s copy', async () => {
        const asked: unknown[] = [];
        await answeringPage(asked);

        expect(
            (await state.server.services.notification.receipt({
                userId: state.userId,
                appUid: null,
                uid: await notify('app.message'),
                type: 'app.message',
            }))!,
        ).toMatchObject({ outcome: 'no-socket' });
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
