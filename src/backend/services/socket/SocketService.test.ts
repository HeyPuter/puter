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
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { makeActor, type Actor } from '../../core/actor.js';
import { runWithContext } from '../../core/context.js';
import { FULL_API_ACCESS } from '../permission/consts.js';
import type { PuterServer } from '../../server.js';
import {
    allocateEphemeralPort,
    createTestUser,
    setupTestServer,
    type TestUserCredentials,
} from '../../testUtil.js';
import { ORG_SEAT_FREE } from '../../data/subPolicies/orgSeatFreePolicy.js';
import type { AuthResult } from '../auth/AuthService.js';
import type { UploadProgressTrackerLike } from '../fs/types.js';
import {
    accountSocketRoom,
    buildSocketReauthError,
    decideSocketAuth,
    ackRoom,
    handshakeAcks,
    socketRoomsFor,
    steadyServerCount,
    SocketService,
    type SocketReauthError,
} from './SocketService.js';

// ── buildSocketReauthError ──────────────────────────────────────────

describe('buildSocketReauthError', () => {
    it('packs reason + auth_id into error.data matching the HTTP shape', () => {
        const err = buildSocketReauthError({
            reason: 'session_expired',
            auth_id: 'u-1',
        });
        expect(err.message).toBe('reauth_required');
        expect(err.data).toEqual({
            code: 'reauth_required',
            reason: 'session_expired',
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
    const appActor: Actor = makeActor({
        user: { id: 1, uuid: 'u-1', username: 'u' },
        app: { uid: 'app-1', id: 2 },
    });
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

    it('admits an app-under-user actor where app sockets are allowed', () => {
        const decision = decideSocketAuth({ actor: appActor } as AuthResult, {
            allowAppActors: true,
        });
        expect(decision).toEqual({ accept: appActor });
    });

    it('rejects an access-token actor with a specific message', () => {
        const decision = decideSocketAuth({
            actor: accessTokenActor,
        } as AuthResult);
        if (!('reject' in decision)) throw new Error('expected reject');
        expect(decision.reject.message).toMatch(/only user tokens/);
    });

    it('accepts a full-access token — the account acting as itself', () => {
        const pat = makeActor({
            user: { id: 1, uuid: 'u-1', username: 'u' },
            accessToken: {
                uid: 'tok-full',
                issuer: { user: { id: 1, uuid: 'u-1', username: 'u' } },
                authorized: null,
                fullAccess: true,
            },
        });
        expect(decideSocketAuth({ actor: pat } as AuthResult)).toEqual({
            accept: pat,
        });
    });

    it('rejects a full-access claim on a token with an app in its chain', () => {
        const issuedByApp = makeActor({
            user: { id: 1, uuid: 'u-1', username: 'u' },
            accessToken: {
                uid: 'tok-full-app',
                issuer: appActor,
                authorized: null,
                fullAccess: true,
            },
        });
        const decision = decideSocketAuth({ actor: issuedByApp } as AuthResult);
        if (!('reject' in decision)) throw new Error('expected reject');
        expect(decision.reject.message).toMatch(/only user tokens/);
    });

    it('keeps rejecting an access-token actor where app sockets are allowed', () => {
        // Including one an app issued: the allowance is for app-under-user
        // credentials, not for anything that resolves to an app.
        const issuedByApp: Actor = {
            ...accessTokenActor,
            accessToken: {
                uid: 'tok-2',
                issuer: appActor,
                authorized: null,
            },
            effectiveApp: appActor.app,
        };
        for (const actor of [accessTokenActor, issuedByApp]) {
            const decision = decideSocketAuth({ actor } as AuthResult, {
                allowAppActors: true,
            });
            if (!('reject' in decision)) throw new Error('expected reject');
            expect(decision.reject.message).toMatch(/only user tokens/);
        }
    });

    it('applies the account gates to an admitted app actor', () => {
        const decision = decideSocketAuth(
            {
                actor: {
                    ...appActor,
                    user: { ...appActor.user, suspended: 1 },
                },
            } as unknown as AuthResult,
            { allowAppActors: true },
        );
        if (!('reject' in decision)) throw new Error('expected reject');
        expect(decision.reject.message).toMatch(/suspended/i);
    });

    it('rejects a suspended user — the HTTP gate the handshake never runs', () => {
        const decision = decideSocketAuth({
            actor: {
                user: { id: 1, uuid: 'u-1', username: 'u', suspended: 1 },
            },
        } as unknown as AuthResult);
        if (!('reject' in decision)) throw new Error('expected reject');
        expect(decision.reject.message).toMatch(/suspended/i);
    });

    it.each([
        [
            'email',
            { requires_email_confirmation: 1, email_confirmed: 0 },
            /confirm your email/i,
        ],
        ['phone', { requires_phone_verification: 1 }, /verify your phone/i],
        ['card', { requires_card_verification: 1 }, /verify your card/i],
    ])('rejects an account pending %s verification', (_label, flags, match) => {
        const decision = decideSocketAuth({
            actor: { user: { id: 1, uuid: 'u-1', username: 'u', ...flags } },
        } as unknown as AuthResult);
        if (!('reject' in decision)) throw new Error('expected reject');
        expect(decision.reject.message).toMatch(match);
    });

    it('rejects when AuthService returned no actor at all', () => {
        const decision = decideSocketAuth({ invalid: true } as AuthResult);
        if (!('reject' in decision)) throw new Error('expected reject');
        expect(decision.reject.message).toBe('socket auth failed');
    });

    it('reauth wins over a usable actor', () => {
        // authenticate() may return a valid actor AND a reauth signal
        // (e.g. an expired session) — the socket must still reject so the
        // client re-auths. Mirrors the HTTP gate's priority.
        const decision = decideSocketAuth({
            actor: userActor,
            reauth: { reason: 'session_expired', auth_id: 'u-1' },
        } as AuthResult);
        if (!('reject' in decision)) throw new Error('expected reject');
        expect((decision.reject as SocketReauthError).data.reason).toBe(
            'session_expired',
        );
    });
});

// -- socketRoomsFor ----------------------------------------------------

describe('socketRoomsFor', () => {
    it('puts a session in the user room', () => {
        expect(
            socketRoomsFor({ user: { id: 7, uuid: 'u-7', username: 'u' } }),
        ).toEqual(['7', accountSocketRoom(7)]);
    });

    it('gives an access token a room of its own to be revoked by', () => {
        const rooms = socketRoomsFor(
            makeActor({
                user: { id: 7, uuid: 'u-7', username: 'u' },
                accessToken: {
                    uid: 'tok-9',
                    issuer: { user: { id: 7, uuid: 'u-7', username: 'u' } },
                    fullAccess: true,
                },
            }),
        );
        expect(rooms).toEqual(['7', accountSocketRoom(7), 'tok:tok-9']);
    });

    it('keeps an app out of the user room and in its own', () => {
        const rooms = socketRoomsFor(
            makeActor({
                user: { id: 7, uuid: 'u-7', username: 'u' },
                app: { uid: 'app-1' },
            }),
        );
        expect(rooms).toEqual(['u7:aapp-1', accountSocketRoom(7)]);
        expect(rooms).not.toContain('7');
    });
});

// -- Live socket.io integration --------------------------------------

describe('handshakeAcks', () => {
    it('keeps the event names a client lists', () => {
        expect(handshakeAcks(['notif.message', 'other'])).toEqual([
            'notif.message',
            'other',
        ]);
    });

    it('drops anything that is not a short non-empty string', () => {
        expect(
            handshakeAcks(['ok', '', 7, null, { a: 1 }, 'x'.repeat(65)]),
        ).toEqual(['ok']);
    });

    it('reads nothing from a value that is not a list', () => {
        expect(handshakeAcks(undefined)).toEqual([]);
        expect(handshakeAcks('notif.message')).toEqual([]);
        expect(handshakeAcks({ 0: 'notif.message' })).toEqual([]);
    });

    it('takes at most 16 names', () => {
        const many = Array.from({ length: 20 }, (_, i) => `e${i}`);
        expect(handshakeAcks(many)).toEqual(many.slice(0, 16));
    });
});

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

    it('rejects a scoped access token — sockets take user tokens only', async () => {
        const row = await server.stores.user.getByUsername(user.username);
        const actor = makeActor({ user: row as never });
        const scoped = await runWithContext({ actor }, () =>
            server.services.auth.createAccessToken(actor, [
                ['service:foo:ii:read'],
            ]),
        );

        await expect(connect({ auth_token: scoped })).rejects.toThrow(
            /only user tokens/,
        );
    });

    it('accepts a full-access token into the user room', async () => {
        const row = await server.stores.user.getByUsername(user.username);
        const userId = row!.id;

        const socket = await connect({ auth_token: user.apiToken });
        expect(socket.connected).toBe(true);
        expect(socketService.has({ room: String(userId) })).toBe(true);
        socket.disconnect();
    });

    it('drops a revoked token`s socket and leaves the session`s alone', async () => {
        const row = await server.stores.user.getByUsername(user.username);
        const actor = makeActor({ user: row as never });
        const doomed = await runWithContext({ actor }, () =>
            server.services.auth.createAccessToken(actor, [[FULL_API_ACCESS]], {
                label: 'revoke-probe',
            }),
        );

        const tokenSocket = await connect({ auth_token: doomed });
        const sessionSocket = await connect({ auth_token: user.token });
        expect(tokenSocket.connected).toBe(true);
        expect(sessionSocket.connected).toBe(true);

        await runWithContext({ actor }, () =>
            server.services.auth.revokeAccessToken(actor, doomed),
        );

        await vi.waitFor(() => expect(tokenSocket.connected).toBe(false), {
            timeout: 5000,
        });
        expect(sessionSocket.connected).toBe(true);
        sessionSocket.disconnect();
    });

    it('rejects an app-under-user token while events are off', async () => {
        const row = await server.stores.user.getByUsername(user.username);
        const appUid = `app-${uuidv4()}`;
        await server.clients.db.write(
            'INSERT INTO `apps` (`uid`, `name`, `title`, `index_url`, `owner_user_id`) VALUES (?, ?, ?, ?, ?)',
            [appUid, appUid, appUid, `https://${appUid}.example/`, row!.id],
        );
        const appToken = await server.services.auth.getUserAppToken(
            { user: row as never, effectiveApp: null },
            appUid,
        );

        await expect(connect({ auth_token: appToken })).rejects.toThrow(
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

    describe('sendWithAck where the adapter cannot count servers', () => {
        const userIdOf = async () =>
            (await server.stores.user.getByUsername(user.username))!.id;

        const closeAll = async (userId: number, sockets: ClientSocket[]) => {
            for (const socket of sockets) socket.disconnect();
            await vi.waitFor(() =>
                expect(socketService.has({ room: userId })).toBe(false),
            );
        };

        it('collects the acknowledgement of each socket that declared it', async () => {
            const userId = await userIdOf();
            const acking = await connect({
                auth_token: user.token,
                acks: ['demo.ack'],
            });
            const plain = await connect({ auth_token: user.token });
            acking.on('demo.ack', (data: unknown, ack: (r: unknown) => void) =>
                ack({ got: data }),
            );
            const plainGot = new Promise<unknown[]>((resolve) =>
                plain.once('demo.ack', (...args: unknown[]) => resolve(args)),
            );

            const sent = await socketService.sendWithAck(
                { room: userId },
                'demo.ack',
                { n: 1 },
                { timeoutMs: 2_000 },
            );

            expect(sent).toEqual({
                responses: [{ got: { n: 1 } }],
                timedOut: false,
                sockets: 2,
                acking: 1,
                declaring: 1,
                complete: false,
            });
            // A socket that never declared it gets the event with no callback.
            expect(await plainGot).toEqual([{ n: 1 }]);
            await closeAll(userId, [acking, plain]);
        });

        it('times out with the acknowledgements that did arrive', async () => {
            const userId = await userIdOf();
            const answers = await connect({
                auth_token: user.token,
                acks: ['demo.ack'],
            });
            const silent = await connect({
                auth_token: user.token,
                acks: ['demo.ack'],
            });
            answers.on('demo.ack', (_d: unknown, ack: (r: unknown) => void) =>
                ack('here'),
            );
            const silentGot = new Promise<unknown>((resolve) =>
                silent.once('demo.ack', resolve),
            );

            const started = Date.now();
            const sent = await socketService.sendWithAck(
                { room: userId },
                'demo.ack',
                { n: 2 },
                { timeoutMs: 300 },
            );

            expect(Date.now() - started).toBeGreaterThanOrEqual(250);
            expect(sent).toEqual({
                responses: ['here'],
                timedOut: true,
                sockets: 2,
                acking: 2,
                declaring: 2,
                complete: false,
            });
            expect(await silentGot).toEqual({ n: 2 });
            await closeAll(userId, [answers, silent]);
        });

        it('returns at once when no socket acknowledges the event', async () => {
            const userId = await userIdOf();
            const other = await connect({
                auth_token: user.token,
                acks: ['some.other.event'],
            });
            const got = new Promise<unknown>((resolve) =>
                other.once('demo.ack', resolve),
            );

            const started = Date.now();
            const sent = await socketService.sendWithAck(
                { room: userId },
                'demo.ack',
                { n: 3 },
                { timeoutMs: 10_000 },
            );

            expect(Date.now() - started).toBeLessThan(2_000);
            expect(sent).toEqual({
                responses: [],
                timedOut: false,
                sockets: 1,
                acking: 0,
                declaring: 1,
                complete: false,
            });
            expect(await got).toEqual({ n: 3 });
            await closeAll(userId, [other]);
        });

        it('reports no sockets for a room nobody is in', async () => {
            await expect(
                socketService.sendWithAck(
                    { room: 'nobody-here' },
                    'demo.ack',
                    {},
                    { timeoutMs: 10_000 },
                ),
            ).resolves.toEqual({
                responses: [],
                timedOut: false,
                sockets: 0,
                acking: 0,
                declaring: 0,
                complete: false,
            });
        });
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

    it('holds an org_seat_free actor to the free cap, not the paid base', async () => {
        // org_seat_free is unlisted; it takes the user_free entry.
        await withLimits({ perOrigin: 100, perUser: 100 }, async () => {
            SocketService.MAX_SOCKETS_BY_SUBSCRIPTION = { user_free: 1 };
            const spy = vi
                .spyOn(server.services.metering, 'getActorSubscription')
                .mockResolvedValue(ORG_SEAT_FREE);
            try {
                const first = await connectFrom('https://org-seat.example');
                expect(await wasDropped(first)).toBe(false);

                const second = await connectFrom('https://org-seat.example');
                expect(await wasDropped(second)).toBe(true);

                first.disconnect();
            } finally {
                spy.mockRestore();
            }
        });
    });

    // -- Evicting a connection whose credential is gone ---------------
    //
    // The handshake is the only place the credential was checked, so nothing
    // here is covered by the cases above: a revoke, a suspension and a new
    // verification requirement all leave a live feed open otherwise.

    it('drops the connection when its session is revoked', async () => {
        const evicted = await createTestUser(server, {
            username: 'sock-evicted',
            password: 'sock-evicted-password',
        });
        const row = await server.stores.user.getByUsername(evicted.username);
        const socket = await connect({ auth_token: `Bearer ${evicted.token}` });
        expect(socket.connected).toBe(true);

        const authService = server.services.auth as unknown as {
            revokeAllSessionsForUserId: (id: number) => Promise<void>;
        };
        await authService.revokeAllSessionsForUserId(row!.id);

        await vi.waitFor(() => expect(socket.connected).toBe(false), {
            timeout: 5_000,
        });
    });

    it('drops the connection on a revocation that reached it from elsewhere', async () => {
        const evicted = await createTestUser(server, {
            username: 'sock-fanout',
            password: 'sock-fanout-password',
        });
        const row = await server.stores.user.getByUsername(evicted.username);
        const socket = await connect({ auth_token: `Bearer ${evicted.token}` });
        expect(socket.connected).toBe(true);

        // As a peer cluster delivers it: the node holding this socket is not
        // the one that revoked the session.
        server.clients.event.emit(
            'outer.auth.sessions.revoked',
            { user_id: row!.id, session_uids: ['whatever'] },
            {},
        );

        await vi.waitFor(() => expect(socket.connected).toBe(false), {
            timeout: 5_000,
        });
    });

    it('leaves other accounts alone when one is revoked', async () => {
        const kept = await createTestUser(server, {
            username: 'sock-kept',
            password: 'sock-kept-password',
        });
        const revoked = await createTestUser(server, {
            username: 'sock-revoked',
            password: 'sock-revoked-password',
        });
        const revokedRow = await server.stores.user.getByUsername(
            revoked.username,
        );

        const keptSocket = await connect({
            auth_token: `Bearer ${kept.token}`,
        });
        const revokedSocket = await connect({
            auth_token: `Bearer ${revoked.token}`,
        });

        const authService = server.services.auth as unknown as {
            revokeAllSessionsForUserId: (id: number) => Promise<void>;
        };
        await authService.revokeAllSessionsForUserId(revokedRow!.id);

        await vi.waitFor(() => expect(revokedSocket.connected).toBe(false), {
            timeout: 5_000,
        });
        expect(keptSocket.connected).toBe(true);
        keptSocket.disconnect();
    });

    it('drops a connection whose account was suspended without a revoke', async () => {
        // A bulk suspension writes `user.suspended` and never touches
        // `sessions`, so eviction-on-revoke never fires — the periodic
        // re-check is what closes it.
        const suspended = await createTestUser(server, {
            username: 'sock-suspended',
            password: 'sock-suspended-password',
        });
        const row = await server.stores.user.getByUsername(suspended.username);
        const socket = await connect({
            auth_token: `Bearer ${suspended.token}`,
        });
        expect(socket.connected).toBe(true);

        await server.clients.db.write(
            'UPDATE user SET suspended = 1 WHERE id = ?',
            [row!.id],
        );
        await server.stores.user.invalidateById(row!.id);

        await socketService.reauthenticateSockets();
        await vi.waitFor(() => expect(socket.connected).toBe(false), {
            timeout: 5_000,
        });
    });

    it('leaves a still-valid connection up across a re-check', async () => {
        const healthy = await createTestUser(server, {
            username: 'sock-healthy',
            password: 'sock-healthy-password',
        });
        const socket = await connect({ auth_token: `Bearer ${healthy.token}` });

        await socketService.reauthenticateSockets();
        await new Promise((r) => setTimeout(r, 200));

        expect(socket.connected).toBe(true);
        socket.disconnect();
    });

    it('re-checks without recording session activity', async () => {
        const idle = await createTestUser(server, {
            username: 'sock-idle',
            password: 'sock-idle-password',
        });
        const socket = await connect({ auth_token: `Bearer ${idle.token}` });
        const touch = vi.spyOn(server.stores.session, 'touch');
        try {
            await socketService.reauthenticateSockets();
            expect(touch).not.toHaveBeenCalled();
            expect(socket.connected).toBe(true);
        } finally {
            touch.mockRestore();
            socket.disconnect();
        }
    });

    it('checks each credential once, and joins a sweep already running', async () => {
        const shared = await createTestUser(server, {
            username: 'sock-shared',
            password: 'sock-shared-password',
        });
        const tabs = await Promise.all([
            connect({ auth_token: `Bearer ${shared.token}` }),
            connect({ auth_token: `Bearer ${shared.token}` }),
        ]);
        const authenticate = vi.spyOn(server.services.auth, 'authenticate');
        try {
            await Promise.all([
                socketService.reauthenticateSockets(),
                socketService.reauthenticateSockets(),
            ]);
            const checks = authenticate.mock.calls.filter(
                ([token]) => token === shared.token,
            );
            expect(checks).toHaveLength(1);
            expect(checks[0]?.[1]).toEqual({ touch: false });
            expect(tabs.every((tab) => tab.connected)).toBe(true);
        } finally {
            authenticate.mockRestore();
            for (const tab of tabs) tab.disconnect();
        }
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

    // Restores real timers even when a fake-timer test fails early.
    afterEach(() => {
        vi.useRealTimers();
    });

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

    it('leaves this region to the emitter that already delivered to it', async () => {
        const spy = captureSends();
        await server.clients.event.emitAndWait(
            'outer.gui.notif.message',
            { user_id_list: [4344], response: { uid: 'n-2' } },
            { region_delivered: true },
        );
        expect(sends).toHaveLength(0);

        // A peer region still delivers the copy it was handed.
        await server.clients.event.emitAndWait(
            'outer.gui.notif.message',
            { user_id_list: [4344], response: { uid: 'n-2' } },
            { region_delivered: true, from_outside: true },
        );
        await vi.waitFor(() => expect(sends).toHaveLength(1));
        expect(sends[0]).toMatchObject({
            spec: { room: 4344 },
            key: 'notif.message',
        });
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

    // Mirrors the tracker FSController puts on the event bus.
    class FixtureUploadProgressTracker implements UploadProgressTrackerLike {
        total = 0;
        progress = 0;
        #listeners: Array<(delta: number) => void> = [];

        setTotal(value: number) {
            this.total = value;
        }

        add(amount: number) {
            this.progress += amount;
            for (const listener of this.#listeners) listener(amount);
        }

        subscribe(callback: (delta: number) => void) {
            this.#listeners.push(callback);
            return {
                detach: () => {
                    const idx = this.#listeners.indexOf(callback);
                    if (idx !== -1) this.#listeners.splice(idx, 1);
                },
            };
        }
    }

    const emitUploadProgress = (
        tracker: UploadProgressTrackerLike,
        meta: Record<string, unknown>,
    ) => {
        server.clients.event.emit(
            'fs.storage.upload-progress',
            { upload_tracker: tracker, meta },
            {},
        );
    };

    it('sends the delta that completes an upload immediately', async () => {
        const spy = captureSends();
        const tracker = new FixtureUploadProgressTracker();
        tracker.setTotal(100);
        tracker.progress = 40;
        emitUploadProgress(tracker, { user_id: 77, op: 'write' });

        tracker.add(60);
        await vi.waitFor(() => expect(sends).toHaveLength(1));
        expect(sends[0]).toMatchObject({
            spec: { room: 77 },
            key: 'upload.progress',
            data: { total: 100, loaded: 100, loaded_diff: 60, op: 'write' },
        });
        spy.mockRestore();
    });

    it('coalesces deltas within the flush window into a single send', async () => {
        vi.useFakeTimers();
        const spy = captureSends();
        const tracker = new FixtureUploadProgressTracker();
        tracker.setTotal(1000);
        emitUploadProgress(tracker, { user_id: 79 });

        tracker.add(10);
        tracker.add(20);
        tracker.add(30);
        expect(sends).toHaveLength(0);

        await vi.advanceTimersByTimeAsync(200);
        expect(sends).toHaveLength(1);
        expect(sends[0]).toMatchObject({
            spec: { room: 79 },
            key: 'upload.progress',
            data: { total: 1000, loaded: 60, loaded_diff: 60 },
        });
        spy.mockRestore();
    });

    it('flushes on completion and leaves no pending timer behind', async () => {
        vi.useFakeTimers();
        const spy = captureSends();
        const tracker = new FixtureUploadProgressTracker();
        tracker.setTotal(100);
        emitUploadProgress(tracker, { user_id: 80 });

        tracker.add(10);
        expect(sends).toHaveLength(0);
        tracker.add(90);
        expect(sends).toHaveLength(1);
        expect(sends[0]).toMatchObject({
            data: { total: 100, loaded: 100, loaded_diff: 100 },
        });

        await vi.advanceTimersByTimeAsync(1000);
        expect(sends).toHaveLength(1);
        spy.mockRestore();
    });

    it('keeps coalescing when the total is unknown', async () => {
        vi.useFakeTimers();
        const spy = captureSends();
        const tracker = new FixtureUploadProgressTracker();
        emitUploadProgress(tracker, { user_id: 82 });

        for (let i = 0; i < 50; i++) tracker.add(1024);
        expect(sends).toHaveLength(0);

        await vi.advanceTimersByTimeAsync(200);
        expect(sends).toHaveLength(1);
        expect(sends[0]).toMatchObject({
            data: { total: 0, loaded: 50 * 1024, loaded_diff: 50 * 1024 },
        });
        spy.mockRestore();
    });

    it('flushes past-total bytes on the window instead of per chunk', async () => {
        vi.useFakeTimers();
        const spy = captureSends();
        const tracker = new FixtureUploadProgressTracker();
        tracker.setTotal(100);
        emitUploadProgress(tracker, { user_id: 83 });

        tracker.add(100);
        tracker.add(10);
        tracker.add(15);
        expect(sends).toHaveLength(1);

        await vi.advanceTimersByTimeAsync(200);
        expect(sends).toHaveLength(2);
        expect(sends[1]).toMatchObject({
            data: { total: 100, loaded: 125, loaded_diff: 25 },
        });
        const sentDiffs = sends.map(
            (s) => (s.data as { loaded_diff: number }).loaded_diff,
        );
        expect(sentDiffs.reduce((a, b) => a + b, 0)).toBe(125);
        spy.mockRestore();
    });

    it('labels a flagged transfer as a download and accepts the camelCase user id', async () => {
        const spy = captureSends();
        const tracker = new FixtureUploadProgressTracker();
        tracker.setTotal(10);
        emitUploadProgress(tracker, { userId: 78, call_it_download: true });

        tracker.add(10);
        await vi.waitFor(() => expect(sends).toHaveLength(1));
        expect(sends[0].key).toBe('download.progress');
        expect(sends[0].spec).toEqual({ room: 78 });
        spy.mockRestore();
    });

    it('skips upload progress with no user in its metadata', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const spy = captureSends();
        const tracker = new FixtureUploadProgressTracker();
        tracker.setTotal(1);

        emitUploadProgress(tracker, {});
        tracker.add(1);

        expect(sends).toHaveLength(0);
        expect(warn).toHaveBeenCalledWith(
            '[socket] upload-progress missing user_id',
            expect.anything(),
        );
        warn.mockRestore();
        spy.mockRestore();
    });

    it('ignores a tracker without subscribe', () => {
        const error = vi.spyOn(console, 'error');
        const bareTracker: UploadProgressTrackerLike = {
            total: 5,
            progress: 0,
            setTotal() {},
            add() {},
        };

        emitUploadProgress(bareTracker, { user_id: 81 });

        expect(error).not.toHaveBeenCalled();
        error.mockRestore();
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

/** Send until a server count has succeeded and the cluster path is in use. */
const waitForClusterCounts = (socketService: SocketService) =>
    vi.waitFor(async () =>
        expect(
            (
                await socketService.sendWithAck(
                    { room: 'nobody-here' },
                    'demo.ack',
                    {},
                    { timeoutMs: 100 },
                )
            ).complete,
        ).toBe(true),
    );

describe('steadyServerCount', () => {
    class FakeAdapter {
        calls = 0;
        results: Array<number | Error> = [];
        serverCount(): Promise<number> {
            const next = this.results[this.calls++];
            return next instanceof Error
                ? Promise.reject(next)
                : Promise.resolve(next);
        }
    }

    it('reports the last good count when a later one fails', async () => {
        const adapter = new FakeAdapter();
        adapter.results = [3, new Error('down')];
        const seen: unknown[] = [];
        steadyServerCount(adapter, (err) => seen.push(err));

        await expect(adapter.serverCount()).resolves.toBe(3);
        await expect(adapter.serverCount()).resolves.toBe(3);
        expect(seen).toEqual([undefined, expect.any(Error)]);
    });

    it('reports one server when no count has succeeded yet', async () => {
        const adapter = new FakeAdapter();
        adapter.results = [new Error('down')];
        steadyServerCount(adapter, () => {});

        await expect(adapter.serverCount()).resolves.toBe(1);
    });
});

describe('SocketService.sendWithAck through the cluster adapter', () => {
    let server: PuterServer;
    let socketService: SocketService;
    let origin: string;
    let user: TestUserCredentials;
    let userId: number;
    let countSpy: ReturnType<typeof vi.spyOn>;
    let retryMs: number;
    let adapter: {
        serverCount: () => Promise<number>;
        fetchSockets: (opts: unknown) => Promise<unknown[]>;
        doPublish: (message: unknown) => Promise<string>;
    };
    const openSockets: ClientSocket[] = [];

    const connect = (acks?: string[]): Promise<ClientSocket> =>
        new Promise((resolve, reject) => {
            const socket = ioClient(origin, {
                auth: { auth_token: user.token, ...(acks ? { acks } : {}) },
                transports: ['websocket'],
                reconnection: false,
            });
            openSockets.push(socket);
            socket.on('connect', () => resolve(socket));
            socket.on('connect_error', reject);
        });

    beforeAll(async () => {
        const port = await allocateEphemeralPort();
        server = await setupTestServer({ port } as never, { listen: true });
        socketService = server.services.socket as unknown as SocketService;
        origin = `http://puter.localhost:${port}`;
        user = await createTestUser(server, {
            username: 'sock-cluster',
            password: 'sock-cluster-password',
        });
        userId = (await server.stores.user.getByUsername(user.username))!.id;

        // A one-node count stands in for a real cluster's, which the mock lacks.
        const seen = new Promise<typeof adapter>((resolve) => {
            server.clients.event.on('web.socket.connected', (_k, data) => {
                const socket = (data as { socket: { nsp: { adapter: never } } })
                    .socket;
                resolve(socket.nsp.adapter);
            });
        });
        const first = await connect();
        adapter = await seen;
        countSpy = vi
            .spyOn(Object.getPrototypeOf(adapter), 'serverCount')
            .mockResolvedValue(1);
        // Other test servers share the mock's channels and would answer too.
        vi.spyOn(adapter, 'doPublish').mockResolvedValue('');
        first.disconnect();
        await vi.waitFor(() =>
            expect(socketService.has({ room: userId })).toBe(false),
        );
        retryMs = SocketService.COUNT_RETRY_MS;
        SocketService.COUNT_RETRY_MS = 0;
        await waitForClusterCounts(socketService);
    }, 60_000);

    afterEach(async () => {
        vi.mocked(adapter.fetchSockets).mockRestore?.();
        for (const socket of openSockets.splice(0)) socket.disconnect();
        await vi.waitFor(() =>
            expect(socketService.has({ room: userId })).toBe(false),
        );
    });

    afterAll(async () => {
        SocketService.COUNT_RETRY_MS = retryMs;
        countSpy.mockRestore();
        await server?.shutdown();
    }, 60_000);

    it('keeps delivering when a later server count fails', async () => {
        const tab = await connect(['demo.ack']);
        tab.on('demo.ack', (_d: unknown, ack: (r: unknown) => void) =>
            ack('seen'),
        );
        const unhandled: unknown[] = [];
        const onUnhandled = (reason: unknown) => unhandled.push(reason);
        process.on('unhandledRejection', onUnhandled);
        countSpy.mockRejectedValue(new Error('cluster node down'));
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            const sent = await socketService.sendWithAck(
                { room: userId },
                'demo.ack',
                {},
                { timeoutMs: 2_000 },
            );
            await new Promise((resolve) => setTimeout(resolve, 50));

            expect(sent).toMatchObject({ responses: ['seen'], sockets: 1 });
            expect(unhandled).toEqual([]);
        } finally {
            process.off('unhandledRejection', onUnhandled);
            countSpy.mockResolvedValue(1);
            warn.mockRestore();
        }
    });

    it('counts every node and returns as soon as each acking socket answered', async () => {
        const tab = await connect(['demo.ack']);
        tab.on('demo.ack', (_d: unknown, ack: (r: unknown) => void) =>
            ack('seen'),
        );

        const started = Date.now();
        const sent = await socketService.sendWithAck(
            { room: userId },
            'demo.ack',
            { n: 1 },
            { timeoutMs: 5_000 },
        );

        expect(Date.now() - started).toBeLessThan(2_000);
        expect(sent).toEqual({
            responses: ['seen'],
            timedOut: false,
            sockets: 1,
            acking: 1,
            declaring: 1,
            complete: true,
        });
    });

    it('delivers before the socket listing finishes', async () => {
        const tab = await connect(['demo.ack']);
        let release: (sockets: unknown[]) => void = () => {};
        vi.spyOn(adapter, 'fetchSockets').mockImplementation(
            () =>
                new Promise((resolve) => {
                    release = resolve;
                }),
        );
        const got = new Promise<unknown>((resolve) =>
            tab.once('demo.ack', (d: unknown, ack: (r: unknown) => void) => {
                ack('seen');
                resolve(d);
            }),
        );

        const sent = socketService.sendWithAck(
            { room: userId },
            'demo.ack',
            { n: 2 },
            { timeoutMs: 5_000 },
        );

        await expect(got).resolves.toEqual({ n: 2 });
        release([]);
        await expect(sent).resolves.toMatchObject({ responses: ['seen'] });
    });

    it('says the count is this node only when the listing fails, once a minute', async () => {
        const tab = await connect(['demo.ack']);
        tab.on('demo.ack', (_d: unknown, ack: (r: unknown) => void) =>
            ack('seen'),
        );
        vi.spyOn(adapter, 'fetchSockets').mockRejectedValue(
            new Error('timeout reached'),
        );
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        for (let i = 0; i < 2; i++) {
            expect(
                await socketService.sendWithAck(
                    { room: userId },
                    'demo.ack',
                    {},
                    { timeoutMs: 2_000 },
                ),
            ).toEqual({
                responses: ['seen'],
                timedOut: false,
                sockets: 1,
                acking: 1,
                declaring: 1,
                complete: false,
            });
        }
        expect(
            warn.mock.calls.filter((c) => String(c[0]).includes('listing')),
        ).toHaveLength(1);
        warn.mockRestore();
    });

    it('asks only acking sockets, so one that never acks neither waits nor is asked', async () => {
        const tab = await connect(['demo.ack']);
        tab.on('demo.ack', (_d: unknown, ack: (r: unknown) => void) =>
            ack('seen'),
        );
        const old = await connect();
        const oldGot = new Promise<unknown[]>((resolve) =>
            old.once('demo.ack', (...args: unknown[]) => resolve(args)),
        );

        const started = Date.now();
        const sent = await socketService.sendWithAck(
            { room: userId },
            'demo.ack',
            { n: 3 },
            { timeoutMs: 5_000 },
        );

        expect(Date.now() - started).toBeLessThan(2_000);
        expect(sent).toEqual({
            responses: ['seen'],
            timedOut: false,
            sockets: 2,
            acking: 1,
            declaring: 1,
            complete: true,
        });
        expect(await oldGot).toEqual([{ n: 3 }]);
    });

    it('keeps the plain copy on the ordinary broadcast and asks only the ack room', async () => {
        await connect(['demo.split']);
        const published = vi.mocked(adapter.doPublish);
        published.mockClear();

        await socketService.sendWithAck(
            { room: userId },
            'demo.split',
            {},
            { timeoutMs: 1_000 },
        );

        type Published = {
            data?: {
                requestId?: string;
                packet?: { data?: unknown[] };
                opts?: { rooms?: string[]; except?: string[] };
            };
        };
        const ours = published.mock.calls
            .map(([message]) => message as Published)
            .filter((m) => m.data?.packet?.data?.[0] === 'demo.split');
        const room = ackRoom(String(userId), 'demo.split');
        expect(ours).toHaveLength(2);
        expect(ours.find((m) => !m.data?.requestId)?.data?.opts).toMatchObject({
            rooms: [String(userId)],
            except: [room],
        });
        expect(ours.find((m) => m.data?.requestId)?.data?.opts).toMatchObject({
            rooms: [room],
        });
    });

    it('marks counts taken while a server count failed as incomplete, and warns', async () => {
        const tab = await connect(['demo.ack']);
        tab.on('demo.ack', (_d: unknown, ack: (r: unknown) => void) =>
            ack('seen'),
        );
        countSpy.mockRejectedValue(new Error('cluster node down'));
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const later = Date.now() + 61_000;
        const clock = vi.spyOn(Date, 'now').mockReturnValue(later);
        try {
            const sent = await socketService.sendWithAck(
                { room: userId },
                'demo.ack',
                {},
                { timeoutMs: 2_000 },
            );

            expect(sent).toMatchObject({
                responses: ['seen'],
                complete: false,
            });
            expect(
                warn.mock.calls.filter((c) =>
                    String(c[0]).includes('server count failed'),
                ),
            ).toHaveLength(1);
        } finally {
            countSpy.mockResolvedValue(1);
            warn.mockRestore();
            clock.mockRestore();
        }
    });

    it('reports an empty room as complete', async () => {
        expect(
            await socketService.sendWithAck(
                { room: 'nobody-here' },
                'demo.ack',
                {},
                { timeoutMs: 1_000 },
            ),
        ).toEqual({
            responses: [],
            timedOut: false,
            sockets: 0,
            acking: 0,
            declaring: 0,
            complete: true,
        });
    });
});

describe('SocketService.sendWithAck while the server count is unsettled', () => {
    let server: PuterServer;
    let socketService: SocketService;
    let origin: string;
    let user: TestUserCredentials;
    let userId: number;
    let proto: { serverCount: () => Promise<number> };
    let retryMs: number;
    const openSockets: ClientSocket[] = [];

    const connect = (): Promise<ClientSocket> =>
        new Promise((resolve, reject) => {
            const socket = ioClient(origin, {
                auth: { auth_token: user.token, acks: ['demo.ack'] },
                transports: ['websocket'],
                reconnection: false,
            });
            openSockets.push(socket);
            socket.on('connect', () => resolve(socket));
            socket.on('connect_error', reject);
        });

    beforeAll(async () => {
        retryMs = SocketService.COUNT_RETRY_MS;
        SocketService.COUNT_RETRY_MS = 0;
        const port = await allocateEphemeralPort();
        server = await setupTestServer({ port } as never, { listen: true });
        socketService = server.services.socket as unknown as SocketService;
        origin = `http://puter.localhost:${port}`;
        user = await createTestUser(server, {
            username: 'sock-unsettled',
            password: 'sock-unsettled-password',
        });
        userId = (await server.stores.user.getByUsername(user.username))!.id;
        const seen = new Promise<object>((resolve) => {
            server.clients.event.on('web.socket.connected', (_k, data) => {
                resolve(
                    (data as { socket: { nsp: { adapter: object } } }).socket
                        .nsp.adapter,
                );
            });
        });
        await connect();
        const adapter = await seen;
        proto = Object.getPrototypeOf(adapter);
        vi.spyOn(adapter as never, 'doPublish').mockResolvedValue('' as never);
    }, 60_000);

    afterEach(() => {
        vi.mocked(proto.serverCount).mockRestore?.();
    });

    afterAll(async () => {
        SocketService.COUNT_RETRY_MS = retryMs;
        for (const socket of openSockets.splice(0)) socket.disconnect();
        await server?.shutdown();
    }, 60_000);

    it('delivers at once while a server count hangs', async () => {
        let fail: (err: Error) => void = () => {};
        vi.spyOn(proto, 'serverCount').mockImplementation(
            () =>
                new Promise((_resolve, reject) => {
                    fail = reject;
                }),
        );
        const tab = openSockets[0];
        tab.on('demo.ack', (_d: unknown, ack: (r: unknown) => void) =>
            ack('seen'),
        );
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const started = Date.now();
        const sent = await socketService.sendWithAck(
            { room: userId },
            'demo.ack',
            {},
            { timeoutMs: 5_000 },
        );

        expect(Date.now() - started).toBeLessThan(1_000);
        expect(sent).toMatchObject({ responses: ['seen'], complete: false });
        fail(new Error('gave up'));
        await new Promise((resolve) => setTimeout(resolve, 10));
        warn.mockRestore();
    });

    it('takes up cluster counts once a later server count succeeds', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const count = vi
            .spyOn(proto, 'serverCount')
            .mockRejectedValue(new Error('not ready'));
        const once = () =>
            socketService.sendWithAck(
                { room: userId },
                'demo.ack',
                {},
                { timeoutMs: 1_000 },
            );

        expect((await once()).complete).toBe(false);
        expect((await once()).complete).toBe(false);

        count.mockResolvedValue(1);
        await waitForClusterCounts(socketService);
        expect((await once()).complete).toBe(true);
        warn.mockRestore();
    });
});

describe('SocketService server count warnings before any count succeeded', () => {
    let server: PuterServer;
    let retryMs: number;

    beforeAll(async () => {
        retryMs = SocketService.COUNT_RETRY_MS;
        SocketService.COUNT_RETRY_MS = 0;
        const port = await allocateEphemeralPort();
        server = await setupTestServer({ port } as never, { listen: true });
    }, 60_000);

    afterAll(async () => {
        SocketService.COUNT_RETRY_MS = retryMs;
        vi.restoreAllMocks();
        await server?.shutdown();
    }, 60_000);

    it('warns once, not every minute, while no server count has ever succeeded', async () => {
        const socketService = server.services
            .socket as unknown as SocketService;
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        let now = Date.now();
        vi.spyOn(Date, 'now').mockImplementation(() => (now += 120_000));

        for (let i = 0; i < 3; i++) {
            await socketService.sendWithAck(
                { room: 'nobody-here' },
                'demo.ack',
                {},
                { timeoutMs: 1_000 },
            );
            await new Promise((resolve) => setTimeout(resolve, 10));
        }

        expect(
            warn.mock.calls.filter((c) =>
                String(c[0]).includes('server count failed'),
            ),
        ).toEqual([]);
    });
});
