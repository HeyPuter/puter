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
 * What an app connection can and cannot hear, over a real socket.
 *
 * The isolation claim is the whole point of letting an app hold one: it sees
 * its own subscriptions' deliveries and nothing else — not the desktop's
 * filesystem fan, not another app's deliveries. Only a live server can show
 * that, so this drives real socket.io clients against real HTTP writes.
 */

import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { v4 as uuidv4 } from 'uuid';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { setupPuterTestEnv, type PuterTestEnv } from '../../testUtil.js';
import type { IConfig } from '../../types.js';
import {
    appSocketRoom,
    SocketService,
} from '../socket/SocketService.js';
import {
    EVENTS_DELIVERY_CHANNEL,
    EVENTS_SUBSCRIBE_VERB,
    type DeliveryEnvelope,
} from './EventsService.js';

const BOOT_TIMEOUT_MS = 120_000;

let env: PuterTestEnv;
let userId: number;
let username: string;
let sessionToken: string;

/** Two apps, so "only its own" has something to be measured against. */
let appOne: { uid: string; token: string };
let appTwo: { uid: string; token: string };

const openSockets: ClientSocket[] = [];

const socketService = () =>
    env.server.services.socket as unknown as SocketService;

const makeApp = async (
    forUserId = userId,
    forUsername = username,
): Promise<{ uid: string; token: string }> => {
    const uid = `app-${uuidv4()}`;
    await env.server.clients.db.write(
        'INSERT INTO `apps` (`uid`, `name`, `title`, `index_url`, `owner_user_id`) VALUES (?, ?, ?, ?, ?)',
        [uid, uid, uid, `https://${uid}.example/`, forUserId],
    );
    const user = await env.server.stores.user.getByUsername(forUsername);
    const token = await env.server.services.auth.getUserAppToken(
        { user: user as never, effectiveApp: null },
        uid,
    );
    // An app's own data directory is the one place it can always list, which
    // is what makes it the honest anchor for these.
    await env.server.services.fs.mkdir(forUserId, {
        path: `/${forUsername}/AppData/${uid}`,
        createMissingParents: true,
    });
    return { uid, token };
};

const connect = (
    token: string,
    opts: Record<string, unknown> = {},
): Promise<ClientSocket> =>
    new Promise((resolve, reject) => {
        const socket = ioClient(env.origin, {
            auth: { auth_token: token },
            transports: ['websocket'],
            reconnection: false,
            ...opts,
        });
        openSockets.push(socket);
        socket.on('connect', () => resolve(socket));
        socket.on('connect_error', (err: Error) => reject(err));
    });

const subscribe = (
    socket: ClientSocket,
    subject: string,
): Promise<{ ok: boolean; sub?: { subId: string } }> =>
    new Promise((resolve) =>
        socket.emit(EVENTS_SUBSCRIBE_VERB, { subject }, resolve),
    );

/** Every message a socket saw on one channel, in arrival order. */
const collect = (socket: ClientSocket, channel: string): unknown[] => {
    const seen: unknown[] = [];
    socket.on(channel, (payload: unknown) => seen.push(payload));
    return seen;
};

const deliveries = (socket: ClientSocket): DeliveryEnvelope[] =>
    collect(socket, EVENTS_DELIVERY_CHANNEL) as DeliveryEnvelope[];

/** Create a directory the way a client does — the write that fans out. */
const mkdirOverHttp = async (path: string): Promise<void> => {
    const response = await fetch(new URL('/mkdir', env.apiOrigin), {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({ path, create_missing_parents: true }),
    });
    expect(response.status).toBe(200);
};

const settle = (seen: unknown[], count = 1) =>
    vi.waitFor(() => expect(seen.length).toBeGreaterThanOrEqual(count), {
        timeout: 5_000,
        interval: 25,
    });

beforeAll(async () => {
    env = await setupPuterTestEnv({ events: { enabled: true } } as IConfig);
    username = env.users.user.username;
    sessionToken = env.users.user.token;
    const user = await env.server.stores.user.getByUsername(username);
    userId = user!.id;

    appOne = await makeApp();
    appTwo = await makeApp();
}, BOOT_TIMEOUT_MS);

afterEach(async () => {
    while (openSockets.length) openSockets.pop()?.disconnect();
    await vi.waitFor(() => {
        for (const room of [
            String(userId),
            appSocketRoom(userId, appOne.uid),
            appSocketRoom(userId, appTwo.uid),
        ])
            expect(socketService().has({ room })).toBe(false);
    });
});

afterAll(async () => {
    await env?.shutdown();
});

describe('an app connection', () => {
    it('is admitted, and only into its own room', async () => {
        const socket = await connect(appOne.token);

        expect(socket.connected).toBe(true);
        expect(
            socketService().has({ room: appSocketRoom(userId, appOne.uid) }),
        ).toBe(true);
        // The user room is what carries the desktop's filesystem fan.
        expect(socketService().has({ room: userId })).toBe(false);
    });

    it('hears its own subscription and nothing the desktop hears', async () => {
        const app = await connect(appOne.token);
        const desktop = await connect(sessionToken);
        const appDelivered = deliveries(app);
        const appItems = collect(app, 'item.added');
        const appCache = collect(app, 'cache.updated');
        const desktopItems = collect(desktop, 'item.added');
        const desktopDelivered = deliveries(desktop);

        const anchor = `/${username}/AppData/${appOne.uid}`;
        const ack = await subscribe(app, `fs:${anchor}`);
        expect(ack.ok).toBe(true);

        const created = `${anchor}/reports-${uuidv4().slice(0, 8)}`;
        await mkdirOverHttp(created);
        await settle(appDelivered);
        await settle(desktopItems);

        expect(appDelivered).toHaveLength(1);
        expect(appDelivered[0].subId).toBe(ack.sub!.subId);
        expect(appDelivered[0].event).toMatchObject({
            op: 'add',
            path: created,
            self: true,
        });
        // The legacy channel still reaches the desktop, and only the desktop;
        // the desktop, subscribed to nothing, gains nothing new.
        expect(desktopItems.length).toBeGreaterThan(0);
        expect(appItems).toEqual([]);
        expect(appCache).toEqual([]);
        expect(desktopDelivered).toEqual([]);
    });

    it('delivers only the projected shape', async () => {
        const app = await connect(appOne.token);
        const delivered = deliveries(app);
        const anchor = `/${username}/AppData/${appOne.uid}`;
        await subscribe(app, `fs:${anchor}`);

        await mkdirOverHttp(`${anchor}/shape-${uuidv4().slice(0, 8)}`);
        await settle(delivered);

        expect(Object.keys(delivered[0]).sort()).toEqual(['event', 'subId']);
        expect(Object.keys(delivered[0].event).sort()).toEqual([
            'id',
            'op',
            'path',
            'self',
            'seq',
            'subject',
            'ts',
            'uid',
        ]);
    });

    it('never sees another app`s deliveries', async () => {
        const one = await connect(appOne.token);
        const two = await connect(appTwo.token);
        const oneDelivered = deliveries(one);
        const twoDelivered = deliveries(two);

        const oneAnchor = `/${username}/AppData/${appOne.uid}`;
        await subscribe(one, `fs:${oneAnchor}`);
        await subscribe(two, `fs:/${username}/AppData/${appTwo.uid}`);

        await mkdirOverHttp(`${oneAnchor}/private-${uuidv4().slice(0, 8)}`);
        await settle(oneDelivered);

        expect(oneDelivered).toHaveLength(1);
        expect(twoDelivered).toEqual([]);
    });

    it('works from a standalone origin', async () => {
        const app = await connect(appOne.token, {
            extraHeaders: { Origin: 'https://standalone.example' },
        });
        const delivered = deliveries(app);
        const anchor = `/${username}/AppData/${appOne.uid}`;
        await subscribe(app, `fs:${anchor}`);

        await mkdirOverHttp(`${anchor}/standalone-${uuidv4().slice(0, 8)}`);
        await settle(delivered);

        expect(delivered).toHaveLength(1);
    });

    it('spends the account`s per-origin allowance like any other socket', async () => {
        const previous = SocketService.MAX_SOCKETS_PER_ORIGIN;
        SocketService.MAX_SOCKETS_PER_ORIGIN = 1;
        try {
            const origin = { extraHeaders: { Origin: 'https://capped.example' } };
            const first = await connect(appOne.token, origin);
            const second = await connect(appTwo.token, origin);

            await new Promise((resolve) => setTimeout(resolve, 500));
            expect(first.connected).toBe(true);
            expect(second.connected).toBe(false);
        } finally {
            SocketService.MAX_SOCKETS_PER_ORIGIN = previous;
        }
    });

    it('is dropped together with the desktop when the account`s sessions are revoked', async () => {
        // A separate account: revoking sessions must not disturb the shared
        // fixtures the rest of this file connects with.
        const other = env.users.other;
        const otherRow = await env.server.stores.user.getByUsername(
            other.username,
        );
        const otherApp = await makeApp(otherRow!.id, other.username);

        const desktop = await connect(other.token);
        const app = await connect(otherApp.token);
        expect(desktop.connected).toBe(true);
        expect(app.connected).toBe(true);

        const authService = env.server.services.auth as unknown as {
            revokeAllSessionsForUserId: (id: number) => Promise<void>;
        };
        await authService.revokeAllSessionsForUserId(otherRow!.id);

        // Eviction goes by account, not by which session minted the socket —
        // the app connection is not in the desktop's room, so it has to be
        // reached the same way the desktop is.
        await vi.waitFor(
            () => {
                expect(desktop.connected).toBe(false);
                expect(app.connected).toBe(false);
            },
            { timeout: 5_000 },
        );
    });
});
