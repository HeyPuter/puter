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
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import type { EventMap } from '../../clients/event/types.js';
import type { PuterServer } from '../../server.js';
import {
    allocateEphemeralPort,
    createTestUser,
    setupTestServer,
    type TestUserCredentials,
} from '../../testUtil.js';

type Settled = EventMap['notif.delivery.settled'];

const ACK_TIMEOUT_MS = 300;

describe('live notification delivery receipts', () => {
    let server: PuterServer;
    let origin: string;
    let user: TestUserCredentials;
    let userId: number;
    const openSockets: ClientSocket[] = [];
    const settled: Settled[] = [];
    const onSettled = (_key: string, data: unknown) => {
        settled.push(data as Settled);
    };

    beforeAll(async () => {
        const port = await allocateEphemeralPort();
        server = await setupTestServer(
            { port, notificationAckTimeoutMs: ACK_TIMEOUT_MS } as never,
            { listen: true },
        );
        origin = `http://puter.localhost:${port}`;
        user = await createTestUser(server, {
            username: 'receipt-user',
            password: 'receipt-user-password',
        });
        userId = (await server.stores.user.getByUsername(user.username))!.id;
        server.clients.event.on('notif.delivery.settled', onSettled);
    }, 60_000);

    afterEach(async () => {
        vi.restoreAllMocks();
        for (const socket of openSockets.splice(0)) socket.disconnect();
        await vi.waitFor(() =>
            expect(server.services.socket.has({ room: userId })).toBe(false),
        );
        settled.length = 0;
    });

    afterAll(async () => {
        server?.clients.event.off('notif.delivery.settled', onSettled);
        await server?.shutdown();
    }, 60_000);

    const connect = (auth: Record<string, unknown>): Promise<ClientSocket> =>
        new Promise((resolve, reject) => {
            const socket = ioClient(origin, {
                auth: { auth_token: user.token, ...auth },
                transports: ['websocket'],
                reconnection: false,
            });
            openSockets.push(socket);
            socket.on('connect', () => resolve(socket));
            socket.on('connect_error', reject);
        });

    const notify = async (
        type: 'share.received' | 'app.message' = 'share.received',
    ): Promise<string> => {
        const uid = await server.services.notification.notify(
            [userId],
            { title: 'hello' },
            type === 'app.message'
                ? { type, appUid: 'app-receipts' }
                : { type },
        );
        return uid!;
    };

    const settledFor = async (uid: string): Promise<Settled> => {
        await vi.waitFor(
            () => expect(settled.some((s) => s.uid === uid)).toBe(true),
            { timeout: 3_000 },
        );
        return settled.find((s) => s.uid === uid)!;
    };

    it('settles as received once a tab acknowledges, with its visibility', async () => {
        const tab = await connect({ acks: ['notif.message'] });
        const got: unknown[] = [];
        tab.on('notif.message', (msg: unknown, ack: (r: unknown) => void) => {
            got.push(msg);
            ack({ visibilityState: 'hidden' });
        });

        const uid = await notify();

        expect(await settledFor(uid)).toEqual({
            uid,
            userId,
            outcome: 'received',
            ackCapable: true,
            responders: [{ visibilityState: 'hidden' }],
        });
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
        expect(await settledFor(uid)).toEqual({
            uid,
            userId,
            outcome: 'no-socket',
            ackCapable: false,
            responders: [],
        });
    });

    it('settles as remote-only when only a peer region holds a socket', async () => {
        const eventForward = server.services.eventForward;
        vi.spyOn(eventForward, 'active', 'get').mockReturnValue(true);
        vi.spyOn(eventForward, 'regionsFor').mockResolvedValue(['peer-a']);

        const uid = await notify();

        expect(await settledFor(uid)).toMatchObject({
            outcome: 'remote-only',
            ackCapable: false,
        });
        expect(eventForward.regionsFor).toHaveBeenCalledWith(userId, null);
    });

    it('settles an app message on the desktop wire the same way', async () => {
        const tab = await connect({ acks: ['notif.message'] });
        tab.on('notif.message', (_m: unknown, ack: (r: unknown) => void) =>
            ack({ visibilityState: 'visible' }),
        );

        const uid = await notify('app.message');

        expect(await settledFor(uid)).toMatchObject({
            outcome: 'received',
            responders: [{ visibilityState: 'visible' }],
        });
    });

    it('settles a rewritten notification as it is delivered again', async () => {
        const tab = await connect({ acks: ['notif.message'] });
        tab.on('notif.message', (_m: unknown, ack: (r: unknown) => void) =>
            ack({ visibilityState: 'visible' }),
        );
        const uid = await notify();
        await settledFor(uid);
        settled.length = 0;

        await server.services.notification.notifyUpdate(
            uid,
            userId,
            { title: 'hello again' },
            { type: 'share.received' },
        );

        expect(await settledFor(uid)).toMatchObject({ outcome: 'received' });
    });

    it('sends nothing and settles nothing for a silent notification', async () => {
        await server.services.notification.notify(
            [userId],
            { title: 'quiet' },
            { type: 'share.received', silent: true },
        );
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(settled).toEqual([]);
    });
});
