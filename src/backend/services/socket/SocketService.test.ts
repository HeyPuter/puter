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
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Actor } from '../../core/actor.js';
import type { PuterServer } from '../../server.js';
import {
    allocateEphemeralPort,
    createTestUser,
    setupTestServer,
    type TestUserCredentials,
} from '../../testUtil.js';
import type { AuthResult } from '../auth/AuthService.js';
import {
    buildSocketReauthError,
    decideSocketAuth,
    SocketService,
    type SocketReauthError,
} from './SocketService.js';

// ── buildSocketReauthError ──────────────────────────────────────────

describe('buildSocketReauthError', () => {
    it('packs reason + auth_id into error.data matching the HTTP shape', () => {
        const err = buildSocketReauthError({
            reason: 'token_v1',
            auth_id: 'u-1',
        });
        expect(err.message).toBe('reauth_required');
        expect(err.data).toEqual({
            code: 'reauth_required',
            reason: 'token_v1',
            auth_id: 'u-1',
        });
    });

    it('omits auth_id when none was supplied', () => {
        const err = buildSocketReauthError({ reason: 'session_expired' });
        expect(err.data).toEqual({
            code: 'reauth_required',
            reason: 'session_expired',
        });
        expect(err.data.auth_id).toBeUndefined();
    });
});

// ── decideSocketAuth ────────────────────────────────────────────────

describe('decideSocketAuth', () => {
    const userActor: Actor = {
        user: { id: 1, uuid: 'u-1', username: 'u' },
    };
    const appActor: Actor = {
        user: { id: 1, uuid: 'u-1', username: 'u' },
        app: { uid: 'app-1', id: 2 },
    };
    const accessTokenActor: Actor = {
        user: { id: 1, uuid: 'u-1', username: 'u' },
        accessToken: {
            uid: 'tok-1',
            issuer: { user: { id: 1, uuid: 'u-1', username: 'u' } },
            authorized: null,
        },
    };

    it('accepts a plain user actor', () => {
        const decision = decideSocketAuth({ actor: userActor } as AuthResult);
        expect(decision).toEqual({ accept: userActor });
    });

    it('rejects with a structured reauth error when result carries reauth', () => {
        const decision = decideSocketAuth({
            reauth: { reason: 'session_revoked', auth_id: 'u-1' },
        } as AuthResult);
        if (!('reject' in decision)) throw new Error('expected reject');
        expect(decision.reject.message).toBe('reauth_required');
        expect((decision.reject as SocketReauthError).data).toEqual({
            code: 'reauth_required',
            reason: 'session_revoked',
            auth_id: 'u-1',
        });
    });

    it('rejects an app-under-user actor with a specific message', () => {
        const decision = decideSocketAuth({ actor: appActor } as AuthResult);
        if (!('reject' in decision)) throw new Error('expected reject');
        expect(decision.reject.message).toMatch(/only user tokens/);
        // Plain Error — no structured `data` payload.
        expect((decision.reject as { data?: unknown }).data).toBeUndefined();
    });

    it('rejects an access-token actor with a specific message', () => {
        const decision = decideSocketAuth({
            actor: accessTokenActor,
        } as AuthResult);
        if (!('reject' in decision)) throw new Error('expected reject');
        expect(decision.reject.message).toMatch(/only user tokens/);
    });

    it('rejects when AuthService returned no actor at all', () => {
        const decision = decideSocketAuth({ invalid: true } as AuthResult);
        if (!('reject' in decision)) throw new Error('expected reject');
        expect(decision.reject.message).toBe('socket auth failed');
    });

    it('reauth wins over a usable actor (legacy v1 path)', () => {
        // Legacy v1 tokens may lazy-backfill a valid actor AND emit a
        // reauth signal — the socket must still reject so the client
        // migrates. Mirrors the HTTP gate's priority.
        const decision = decideSocketAuth({
            actor: userActor,
            reauth: { reason: 'token_v1', auth_id: 'u-1' },
        } as AuthResult);
        if (!('reject' in decision)) throw new Error('expected reject');
        expect((decision.reject as SocketReauthError).data.reason).toBe(
            'token_v1',
        );
    });
});

// -- Live socket.io integration --------------------------------------

describe('SocketService (live socket.io)', () => {
    let server: PuterServer;
    let socketService: SocketService;
    let origin: string;
    let port: number;
    let user: TestUserCredentials;
    let appUser: TestUserCredentials;
    const openSockets: ClientSocket[] = [];

    beforeAll(async () => {
        port = await allocateEphemeralPort();
        server = await setupTestServer({ port } as never, { listen: true });
        socketService = server.services.socket as unknown as SocketService;
        origin = `http://puter.localhost:${port}`;
        user = await createTestUser(server, {
            username: 'sock-user',
            password: 'sock-user-password',
        });
        appUser = await createTestUser(server, {
            username: 'sock-other',
            password: 'sock-other-password',
        });
    }, 60_000);

    afterAll(async () => {
        for (const s of openSockets) s.disconnect();
        await server?.shutdown();
    }, 60_000);

    /**
     * Connect a client and resolve once connected, or reject with the auth
     * error.
     */
    const connect = (
        auth: Record<string, unknown>,
        opts: Partial<Parameters<typeof ioClient>[1]> = {},
    ): Promise<ClientSocket> =>
        new Promise((resolve, reject) => {
            const socket = ioClient(origin, {
                auth,
                transports: ['websocket'],
                reconnection: false,
                ...opts,
            });
            openSockets.push(socket);
            socket.on('connect', () => resolve(socket));
            socket.on('connect_error', (err: Error) => reject(err));
        });

    it('rejects a handshake with no auth token', async () => {
        await expect(connect({})).rejects.toThrow('socket auth token missing');
    });

    it('rejects a handshake whose token is only the Bearer prefix', async () => {
        await expect(connect({ auth_token: 'Bearer   ' })).rejects.toThrow(
            'socket auth token empty',
        );
    });

    it('rejects a garbage token', async () => {
        await expect(connect({ auth_token: 'not-a-token' })).rejects.toThrow();
    });

    it('rejects an app-scoped credential — sockets take user tokens only', async () => {
        // A full-access API token is an access-token actor, which the socket
        // handshake refuses even though it authenticates fine over HTTP.
        await expect(connect({ auth_token: user.apiToken })).rejects.toThrow(
            /only user tokens/,
        );
    });

    it('accepts a user session token, joins the per-user room, and announces the connect', async () => {
        const row = await server.stores.user.getByUsername(user.username);
        const userId = row!.id;

        const connected = new Promise<{ user?: { id?: number } }>((resolve) => {
            const handler = (_k: string, data: unknown) => {
                const d = data as { user?: { id?: number } };
                if (d?.user?.id === userId) {
                    server.clients.event.off('web.socket.connected', handler);
                    resolve(d);
                }
            };
            server.clients.event.on('web.socket.connected', handler);
        });

        const socket = await connect({ auth_token: `Bearer ${user.token}` });
        await connected;

        // Room membership is what `send({ room: userId })` targets.
        expect(socketService.has({ room: userId })).toBe(true);
        expect(socketService.has({ socket: socket.id! })).toBe(true);
        expect(socketService.hasIO()).toBe(true);

        const received = new Promise<unknown>((resolve) =>
            socket.once('demo.event', resolve),
        );
        await socketService.send({ room: userId }, 'demo.event', { a: 1 });
        expect(await received).toEqual({ a: 1 });

        // Targeted send by socket id reaches the same client.
        const direct = new Promise<unknown>((resolve) =>
            socket.once('direct.event', resolve),
        );
        await socketService.send({ socket: socket.id! }, 'direct.event', {
            b: 2,
        });
        expect(await direct).toEqual({ b: 2 });

        socket.disconnect();
        await vi.waitFor(() =>
            expect(socketService.has({ room: userId })).toBe(false),
        );
    });

    it('reports no live socket for an absent room, an unknown socket id, and an empty specifier', () => {
        expect(socketService.has({ room: 'nobody-here' })).toBe(false);
        expect(socketService.has({ socket: 'no-such-socket' })).toBe(false);
        expect(socketService.has({})).toBe(false);
    });

    it('drops an emit to an absent room without throwing', async () => {
        await expect(
            socketService.send({ room: 'nobody-here' }, 'demo.event', {}),
        ).resolves.toBeUndefined();
        // An empty specifier matches neither branch and is simply skipped.
        await expect(
            socketService.send([{}], 'demo.event', {}),
        ).resolves.toBeUndefined();
    });

    it("echoes trash.is_empty to the user's other tabs but not the sender", async () => {
        const tabA = await connect({ auth_token: user.token });
        const tabB = await connect({ auth_token: user.token });

        const onB = new Promise<unknown>((resolve) =>
            tabB.once('trash.is_empty', resolve),
        );
        let sawOnA = false;
        tabA.on('trash.is_empty', () => {
            sawOnA = true;
        });

        tabA.emit('trash.is_empty', { is_empty: true });
        expect(await onB).toEqual({ is_empty: true });
        expect(sawOnA).toBe(false);

        tabA.disconnect();
        tabB.disconnect();
    });

    it('emits web.socket.user-connected when the GUI signals it is really open', async () => {
        const row = await server.stores.user.getByUsername(appUser.username);
        const userId = row!.id;
        const socket = await connect({ auth_token: appUser.token });

        const announced = new Promise<void>((resolve) => {
            const handler = (_k: string, data: unknown) => {
                if ((data as { user?: { id?: number } })?.user?.id === userId) {
                    server.clients.event.off(
                        'web.socket.user-connected',
                        handler,
                    );
                    resolve();
                }
            };
            server.clients.event.on('web.socket.user-connected', handler);
        });

        socket.emit('puter_is_actually_open');
        await announced;
        socket.disconnect();
    });

    it('rejects an upgrade from a host outside the configured domain', async () => {
        // Wildcard-served hostnames (user sites) reach the same backend;
        // socket.io only answers on `<domain>` and `api.<domain>`.
        await expect(
            new Promise<void>((resolve, reject) => {
                const socket = ioClient(`http://127.0.0.1:${port}`, {
                    auth: { auth_token: user.token },
                    transports: ['websocket'],
                    reconnection: false,
                });
                openSockets.push(socket);
                socket.on('connect', () => resolve(void socket.disconnect()));
                socket.on('connect_error', reject);
            }),
        ).rejects.toThrow();
    });

    // -- Connection caps ----------------------------------------------
    //
    // The handshake succeeds and the cap is applied after, so an over-cap
    // client sees `connect` followed by a server-side `disconnect`.

    /**
     * Whether the server dropped this socket shortly after connect. Settled by
     * polling `connected` rather than by listening for `disconnect`: the
     * rejection can land before a listener attached post-`connect()` is in
     * place, and a missed event would read as "admitted".
     */
    const wasDropped = async (socket: ClientSocket): Promise<boolean> => {
        await new Promise((r) => setTimeout(r, 500));
        return !socket.connected;
    };

    const withLimits = async (
        limits: { perOrigin: number; perUser: number },
        body: () => Promise<void>,
    ) => {
        const prevOrigin = SocketService.MAX_SOCKETS_PER_ORIGIN;
        const prevUser = SocketService.MAX_SOCKETS_PER_USER;
        const prevTiers = SocketService.MAX_SOCKETS_BY_SUBSCRIPTION;
        SocketService.MAX_SOCKETS_PER_ORIGIN = limits.perOrigin;
        SocketService.MAX_SOCKETS_PER_USER = limits.perUser;
        // Empty the tier map so the base above applies whatever tier the
        // test user resolves to.
        SocketService.MAX_SOCKETS_BY_SUBSCRIPTION = {};
        try {
            await body();
        } finally {
            SocketService.MAX_SOCKETS_PER_ORIGIN = prevOrigin;
            SocketService.MAX_SOCKETS_PER_USER = prevUser;
            SocketService.MAX_SOCKETS_BY_SUBSCRIPTION = prevTiers;
        }
    };

    const connectFrom = (origin: string | undefined) =>
        connect(
            { auth_token: `Bearer ${user.token}` },
            origin ? { extraHeaders: { Origin: origin } } : {},
        );

    it('caps connections per origin', async () => {
        await withLimits({ perOrigin: 1, perUser: 100 }, async () => {
            const first = await connectFrom('https://one.example');
            expect(await wasDropped(first)).toBe(false);

            const second = await connectFrom('https://one.example');
            expect(await wasDropped(second)).toBe(true);

            first.disconnect();
        });
    });

    it('lets a second origin through while the account has room', async () => {
        await withLimits({ perOrigin: 1, perUser: 100 }, async () => {
            const first = await connectFrom('https://a.example');
            const second = await connectFrom('https://b.example');

            expect(await wasDropped(first)).toBe(false);
            expect(await wasDropped(second)).toBe(false);

            first.disconnect();
            second.disconnect();
        });
    });

    it('still bounds the account once origins are exhausted', async () => {
        await withLimits({ perOrigin: 5, perUser: 1 }, async () => {
            const first = await connectFrom('https://c.example');
            expect(await wasDropped(first)).toBe(false);

            // Fresh origin, so the per-origin bucket is empty — the account
            // total is the only thing left to say no.
            const second = await connectFrom('https://d.example');
            expect(await wasDropped(second)).toBe(true);

            first.disconnect();
        });
    });

    it('gives a slot back when the connection closes', async () => {
        await withLimits({ perOrigin: 1, perUser: 100 }, async () => {
            const first = await connectFrom('https://e.example');
            expect(await wasDropped(first)).toBe(false);
            first.disconnect();

            await vi.waitFor(async () => {
                const next = await connectFrom('https://e.example');
                const dropped = await wasDropped(next);
                next.disconnect();
                expect(dropped).toBe(false);
            });
        });
    });
});

// -- Event-bus fan-out ------------------------------------------------

describe('SocketService — outer.gui fan-out', () => {
    let server: PuterServer;
    let socketService: SocketService;

    beforeAll(async () => {
        server = await setupTestServer();
        socketService = server.services.socket as unknown as SocketService;
    }, 60_000);

    afterAll(async () => {
        await server?.shutdown();
    }, 60_000);

    const sends: Array<{ spec: unknown; key: string; data: unknown }> = [];
    const captureSends = () => {
        sends.length = 0;
        return vi
            .spyOn(
                socketService as unknown as {
                    send: SocketService['send'];
                },
                'send',
            )
            .mockImplementation(async (spec, key, data) => {
                sends.push({ spec, key, data });
            });
    };

    it('strips the outer.gui prefix, bumps the change stamp, and follows with cache.updated', async () => {
        const spy = captureSends();
        const before = await socketService.getLastChangeTimestamp(4242);

        await server.clients.event.emitAndWait(
            'outer.gui.item.added',
            {
                user_id_list: [4242],
                response: { original_client_socket_id: 'sock-1' },
            },
            {},
        );
        await vi.waitFor(() => expect(sends).toHaveLength(2));

        expect(sends[0]).toMatchObject({
            spec: { room: 4242 },
            key: 'item.added',
        });
        expect(sends[1].key).toBe('cache.updated');
        expect(
            (sends[1].data as { original_client_socket_id: string })
                .original_client_socket_id,
        ).toBe('sock-1');

        const after = await socketService.getLastChangeTimestamp(4242);
        expect(after).toBeGreaterThan(before);
        expect(after).toBe((sends[1].data as { timestamp: number }).timestamp);
        spy.mockRestore();
    });

    it('does not re-bump the change stamp for non-item events', async () => {
        const spy = captureSends();
        await server.clients.event.emitAndWait(
            'outer.gui.notif.message',
            { user_id_list: [4343], response: { uid: 'n-1' } },
            {},
        );
        await vi.waitFor(() => expect(sends).toHaveLength(1));
        expect(sends[0].key).toBe('notif.message');
        // `cache.updated` is itself a notification about the stamp.
        expect(await socketService.getLastChangeTimestamp(4343)).toBe(0);
        spy.mockRestore();
    });

    it('ignores an event with no recipients', async () => {
        const spy = captureSends();
        await server.clients.event.emitAndWait(
            'outer.gui.item.removed',
            { response: {} },
            {},
        );
        expect(sends).toHaveLength(0);
        spy.mockRestore();
    });

    it('reports 0 for a user with no recorded change and for a corrupt value', async () => {
        expect(await socketService.getLastChangeTimestamp(999999)).toBe(0);
        await server.clients.redis.set('fs:last-change:999998', 'not-a-number');
        expect(await socketService.getLastChangeTimestamp(999998)).toBe(0);
    });

    it('forwards upload progress deltas to the uploading user', async () => {
        const spy = captureSends();
        const callbacks: Array<(delta: number) => void> = [];
        const tracker = {
            total_: 100,
            progress_: 40,
            sub: (cb: (delta: number) => void) => callbacks.push(cb),
        };

        server.clients.event.emit(
            'fs.storage.upload-progress',
            { upload_tracker: tracker, meta: { user_id: 77, op: 'write' } },
            {},
        );
        expect(callbacks).toHaveLength(1);
        callbacks[0](10);
        await vi.waitFor(() => expect(sends).toHaveLength(1));
        expect(sends[0]).toMatchObject({
            spec: { room: 77 },
            key: 'upload.progress',
            data: { total: 100, loaded: 40, loaded_diff: 10, op: 'write' },
        });
        spy.mockRestore();
    });

    it('labels a flagged transfer as a download and accepts the camelCase user id', async () => {
        const spy = captureSends();
        const callbacks: Array<(delta: number) => void> = [];
        server.clients.event.emit(
            'fs.storage.upload-progress',
            {
                upload_tracker: {
                    total_: 10,
                    progress_: 10,
                    sub: (cb: (d: number) => void) => callbacks.push(cb),
                },
                meta: { userId: 78, call_it_download: true },
            },
            {},
        );
        callbacks[0](10);
        await vi.waitFor(() => expect(sends).toHaveLength(1));
        expect(sends[0].key).toBe('download.progress');
        expect(sends[0].spec).toEqual({ room: 78 });
        spy.mockRestore();
    });

    it('skips upload progress with no user in its metadata', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        let subscribed = false;
        server.clients.event.emit(
            'fs.storage.upload-progress',
            {
                upload_tracker: {
                    total_: 1,
                    progress_: 1,
                    sub: () => {
                        subscribed = true;
                    },
                },
            },
            {},
        );
        expect(subscribed).toBe(false);
        expect(warn).toHaveBeenCalledWith(
            '[socket] upload-progress missing user_id',
            expect.anything(),
        );
        warn.mockRestore();
    });
});

// -- Detached service (no http server attached) -----------------------

describe('SocketService — before attachHttpServer', () => {
    const makeDetached = () => {
        const args = [
            { domain: 'puter.localhost' },
            { redis: { get: async () => null } },
            {},
            {},
        ] as unknown as ConstructorParameters<typeof SocketService>;
        return new SocketService(...args);
    };

    it('reports no io, sends nowhere, and has nothing', async () => {
        const service = makeDetached();
        expect(service.hasIO()).toBe(false);
        expect(service.has({ room: 1 })).toBe(false);
        await expect(
            service.send({ room: 1 }, 'k', {}),
        ).resolves.toBeUndefined();
    });

    it('resolves prepare-shutdown immediately with nothing attached', async () => {
        await expect(
            makeDetached().onServerPrepareShutdown(),
        ).resolves.toBeUndefined();
    });

    it('returns 0 when the redis read throws', async () => {
        const args = [
            {},
            {
                redis: {
                    get: async () => {
                        throw new Error('redis down');
                    },
                },
            },
            {},
            {},
        ] as unknown as ConstructorParameters<typeof SocketService>;
        const service = new SocketService(...args);
        expect(await service.getLastChangeTimestamp(1)).toBe(0);
    });
});
