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
 * Presence bookkeeping is written on connect and never again, so a socket left
 * open for days — the normal case for a desktop — would lapse both the region's
 * connection count and its own row item while the connection is still live. The
 * fix piggybacks on the concurrency-slot renew timer that already keeps
 * `acquireConcurrent`'s slot alive (`SocketService#admitConnection`), so this
 * exercises a real timer rather than a call graph read off the source.
 *
 * What the timer must reach is `EventForwardService#touchPresence`, not the
 * store directly: the claim-gated item refresh lives behind it, and a call that
 * stops at the counter leaves the item to age out exactly as before.
 *
 * The renew interval is a third of `CONCURRENT_SLOT_TTL_MS`, which is an hour
 * in production — too long to wait out in a test. This file's own module is
 * the only thing that needs a shorter one, so the mock is file-scoped rather
 * than touching the constant everyone else relies on.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import type { PuterServer } from '../../server.js';
import {
    allocateEphemeralPort,
    createTestUser,
    setupTestServer,
} from '../../testUtil.js';
import { PRESENCE_NO_APP } from '../../stores/events/PresenceStore.js';

vi.mock(
    '../../core/http/middleware/rateLimit.js',
    async (importOriginal) => {
        const actual =
            await importOriginal<
                typeof import('../../core/http/middleware/rateLimit.js')
            >();
        // A third of this is the renew cadence — short enough for a test to
        // actually observe a couple of cycles.
        return { ...actual, CONCURRENT_SLOT_TTL_MS: 300 };
    },
);

const broadcastConfig = {
    webhook: { peerId: 'touch-self', secret: 'touch-self-secret' },
    // `EventForwardService#active` requires at least one addressable peer;
    // it never has to answer for this test to observe the touch.
    peers: [
        {
            peerId: 'touch-peer',
            webhook: true,
            webhook_url: 'http://presence-touch-peer.invalid/broadcast/webhook',
            webhook_secret: 'touch-peer-secret',
        },
    ],
};

describe('the concurrency-slot renew timer touching presence', () => {
    let server: PuterServer;
    let port: number;
    let origin: string;
    const openSockets: ClientSocket[] = [];

    beforeAll(async () => {
        port = await allocateEphemeralPort();
        server = await setupTestServer({
            port,
            broadcast: broadcastConfig,
            events: { enabled: true },
        } as never, { listen: true });
        origin = `http://puter.localhost:${port}`;
    }, 60_000);

    afterAll(async () => {
        for (const s of openSockets) s.disconnect();
        await server?.shutdown();
    }, 60_000);

    const connect = (authToken: string): Promise<ClientSocket> =>
        new Promise((resolve, reject) => {
            const socket = ioClient(origin, {
                auth: { auth_token: `Bearer ${authToken}` },
                transports: ['websocket'],
                reconnection: false,
            });
            openSockets.push(socket);
            socket.on('connect', () => resolve(socket));
            socket.on('connect_error', reject);
        });

    it('keeps refreshing the presence connection count for as long as the socket lives', async () => {
        const user = await createTestUser(server, {
            username: 'sock-presence-touch',
            password: 'sock-presence-touch-password',
        });
        const row = await server.stores.user.getByUsername(user.username);
        const userId = row!.id;

        const touch = vi.spyOn(server.stores.presence, 'touchConnection');

        const socket = await connect(user.token);
        // The desktop connection carries no app of its own.
        await vi.waitFor(() =>
            expect(
                server.stores.presence.holdsConnection(userId, PRESENCE_NO_APP),
            ).resolves.toBe(true),
        );

        // Two renew cycles' worth: one alone could be a fluke of connect-time
        // scheduling rather than the timer actually firing more than once.
        await vi.waitFor(
            () =>
                expect(
                    touch.mock.calls.filter(
                        ([id, app]) => id === userId && app === PRESENCE_NO_APP,
                    ).length,
                ).toBeGreaterThanOrEqual(2),
            { timeout: 5_000, interval: 50 },
        );

        // Not just the counter: the third argument is what carries the item
        // refresh, and a timer wired straight at the store would omit it.
        const refreshing = touch.mock.calls.find(
            ([id, app]) => id === userId && app === PRESENCE_NO_APP,
        );
        expect(refreshing?.[2]).toEqual({
            userUuid: row!.uuid,
            region: broadcastConfig.webhook.peerId,
        });

        socket.disconnect();
        touch.mockRestore();
    });

    it('asks the forward service, so a no-peer deployment touches nothing', async () => {
        // `touchPresence` is where the `active` gate lives. Reaching the store
        // from the timer instead would put a Redis write behind every renewal
        // on a deployment that takes no part in presence at all.
        const user = await createTestUser(server, {
            username: 'sock-presence-touch-gate',
            password: 'sock-presence-touch-gate-password',
        });
        const row = await server.stores.user.getByUsername(user.username);

        const touchPresence = vi.spyOn(
            server.services.eventForward,
            'touchPresence',
        );

        const socket = await connect(user.token);
        await vi.waitFor(
            () =>
                expect(
                    touchPresence.mock.calls.filter(
                        ([id]) => id === row!.id,
                    ).length,
                ).toBeGreaterThanOrEqual(1),
            { timeout: 5_000, interval: 50 },
        );

        socket.disconnect();
        touchPresence.mockRestore();
    });
});
