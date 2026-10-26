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
import { makeActor } from '../../core/actor.js';
import type { PermissionService } from '../../services/permission/PermissionService.js';
import {
    hasPushConsent,
    NOTIFICATIONS_PUSH_PERMISSION,
} from '../../services/push/pushConsent.js';
import {
    PUSH_TEST_GROUP,
    PUTER_PUSH_PREFERENCE_KEY,
} from '../../services/push/PushService.js';
import { isConnectedHere } from '../../services/push/pushPresence.js';
import type {
    PushBatch,
    PushProvider,
    PushResult,
} from '../../services/push/types.js';
import type { IConfig } from '../../types.js';
import {
    createTestUser,
    setupPuterTestEnv,
    type PuterTestEnv,
    type TestUserCredentials,
} from '../../testUtil.js';
import type { PublicPushDevice, PushApp } from './PushController.js';

type DeviceBody = { device: PublicPushDevice };
type ListBody = { devices: PublicPushDevice[] };

const call = (
    env: PuterTestEnv,
    method: string,
    path: string,
    token?: string,
    body?: unknown,
) =>
    fetch(new URL(path, env.apiOrigin), {
        method,
        headers: {
            'content-type': 'application/json',
            'user-agent': 'push-test-agent',
            ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        ...(body === undefined || method === 'GET'
            ? {}
            : { body: JSON.stringify(body) }),
    });

let userSeq = 0;
const freshUser = (env: PuterTestEnv): Promise<TestUserCredentials> =>
    createTestUser(env.server, {
        username: `pushuser${Date.now().toString(36)}${userSeq++}`,
        password: 'push-test-password',
    });

describe('push device routes over HTTP', () => {
    let env: PuterTestEnv;

    beforeAll(async () => {
        env = await setupPuterTestEnv({
            push: { enabled: true },
        } as IConfig);
    }, 120_000);

    afterAll(async () => {
        await env?.shutdown();
    });

    const register = async (
        token: string,
        body: Record<string, unknown>,
    ): Promise<PublicPushDevice> => {
        const res = await call(env, 'POST', '/push/devices', token, body);
        expect(res.status).toBe(200);
        return ((await res.json()) as DeviceBody).device;
    };

    const list = async (token: string): Promise<PublicPushDevice[]> => {
        const res = await call(env, 'GET', '/push/devices', token);
        expect(res.status).toBe(200);
        return ((await res.json()) as ListBody).devices;
    };

    it('registers a device and returns it without the token', async () => {
        const user = await freshUser(env);
        const res = await call(env, 'POST', '/push/devices', user.token, {
            platform: 'android',
            token: 'device-token-register',
            label: '  Pixel  ',
        });

        expect(res.status).toBe(200);
        const text = await res.text();
        expect(text).not.toContain('device-token-register');
        expect(text).not.toContain('token_hash');
        const { device } = JSON.parse(text) as DeviceBody;
        expect(Object.keys(device).sort()).toEqual(
            [
                'created_at',
                'current',
                'label',
                'last_seen_at',
                'platform',
                'uid',
                'user_agent',
            ].sort(),
        );
        expect(device).toMatchObject({
            platform: 'android',
            label: 'Pixel',
            user_agent: 'push-test-agent',
            current: true,
        });
    });

    it('updates the same device when its token is registered again', async () => {
        const user = await freshUser(env);
        const first = await register(user.token, {
            platform: 'ios',
            token: 'apns-token-again',
        });
        const second = await register(user.token, {
            platform: 'ios',
            token: 'apns-token-again',
            label: 'iPhone',
        });

        expect(second.uid).toBe(first.uid);
        const devices = await list(user.token);
        expect(devices).toHaveLength(1);
        expect(devices[0]?.label).toBe('iPhone');
    });

    it('moves a token to the user who registers it last', async () => {
        const first = await freshUser(env);
        const second = await freshUser(env);
        await register(first.token, { platform: 'web', token: 'moving-token' });
        await register(second.token, {
            platform: 'web',
            token: 'moving-token',
        });

        expect(await list(first.token)).toHaveLength(0);
        expect(await list(second.token)).toHaveLength(1);
    });

    it.each([
        ['an unknown platform', { platform: 'windows', token: 't' }],
        ['a missing platform', { token: 't' }],
        ['an empty token', { platform: 'web', token: '' }],
        ['a non-string token', { platform: 'web', token: 42 }],
        [
            'a token over 4096 characters',
            { platform: 'web', token: 'a'.repeat(4097) },
        ],
        ['a token with whitespace', { platform: 'web', token: 'abc def' }],
        [
            'a token with a control character',
            { platform: 'web', token: 'abc\u0007' },
        ],
        [
            'a label over 64 characters',
            { platform: 'web', token: 't', label: 'l'.repeat(65) },
        ],
        ['a non-string label', { platform: 'web', token: 't', label: 5 }],
    ])('rejects %s with 400', async (_name, body) => {
        const user = await freshUser(env);
        const res = await call(env, 'POST', '/push/devices', user.token, body);
        expect(res.status).toBe(400);
        expect(await list(user.token)).toHaveLength(0);
    });

    it('accepts a 4096-character token and a 64-character label', async () => {
        const user = await freshUser(env);
        const device = await register(user.token, {
            platform: 'web',
            token: 'b'.repeat(4096),
            label: 'l'.repeat(64),
        });
        expect(device.label).toHaveLength(64);
    });

    it('refuses anonymous callers with 401', async () => {
        for (const [method, path] of [
            ['POST', '/push/devices'],
            ['GET', '/push/devices'],
            ['DELETE', '/push/devices/some-uid'],
        ] as const) {
            const res = await call(env, method, path, undefined, {
                platform: 'web',
                token: 'anon',
            });
            expect(res.status).toBe(401);
        }
    });

    it('refuses access tokens and worker sessions with 403', async () => {
        const user = await freshUser(env);
        for (const token of [user.apiToken, user.workerToken]) {
            for (const [method, path] of [
                ['POST', '/push/devices'],
                ['GET', '/push/devices'],
                ['DELETE', '/push/devices/some-uid'],
            ] as const) {
                const res = await call(env, method, path, token, {
                    platform: 'web',
                    token: 'delegated',
                });
                expect(res.status).toBe(403);
            }
        }
        expect(await list(user.token)).toHaveLength(0);
    });

    it('refuses app tokens with 403', async () => {
        const user = await freshUser(env);
        const row = await env.server.stores.user.getByUsername(user.username);
        const actor = makeActor({ user: row! });
        const app = await env.server.stores.app.create(
            {
                name: `push-app-${crypto.randomUUID()}`,
                title: 'Push app',
                index_url: `https://push-${crypto.randomUUID()}.test/`,
            },
            { ownerUserId: row!.id },
        );
        const appToken = await env.server.services.auth.getUserAppToken(
            actor,
            app.uid,
        );

        for (const [method, path] of [
            ['POST', '/push/devices'],
            ['GET', '/push/devices'],
            ['DELETE', '/push/devices/some-uid'],
        ] as const) {
            const res = await call(env, method, path, appToken, {
                platform: 'web',
                token: 'from-app',
            });
            expect(res.status).toBe(403);
        }
        expect(await list(user.token)).toHaveLength(0);
    });

    it('keeps 20 devices, dropping the least recently seen for a new one', async () => {
        const user = await freshUser(env);
        const uids: string[] = [];
        for (let i = 0; i < 20; i++) {
            const d = await register(user.token, {
                platform: 'android',
                token: `cap-token-${i}`,
            });
            uids.push(d.uid);
        }
        // Device 5 is the stalest; device 0 was seen most recently.
        for (const [i, uid] of uids.entries()) {
            await env.server.clients.db.write(
                'UPDATE `push_device` SET `last_seen_at` = ? WHERE `uid` = ?',
                [i === 5 ? 1_000 : i === 0 ? 3_000 : 2_000, uid],
            );
        }

        await register(user.token, {
            platform: 'android',
            token: 'cap-token-0',
        });
        expect(await list(user.token)).toHaveLength(20);

        await register(user.token, {
            platform: 'android',
            token: 'cap-token-20',
        });
        const after = (await list(user.token)).map((d) => d.uid);
        expect(after).toHaveLength(20);
        expect(after).not.toContain(uids[5]);
        expect(after).toContain(uids[0]);
    });

    it('lists only the caller’s devices and marks the current session', async () => {
        const user = await freshUser(env);
        const other = await freshUser(env);
        const row = await env.server.stores.user.getByUsername(user.username);
        const { token: secondSession } =
            await env.server.services.auth.createSessionToken(row!, {
                user_agent: 'second-session',
            });

        const here = await register(user.token, {
            platform: 'web',
            token: 'list-a',
        });
        const there = await register(secondSession, {
            platform: 'ios',
            token: 'list-b',
        });
        await register(other.token, { platform: 'web', token: 'list-c' });

        const devices = await list(user.token);
        expect(devices.map((d) => d.uid).sort()).toEqual(
            [here.uid, there.uid].sort(),
        );
        expect(devices.find((d) => d.uid === here.uid)?.current).toBe(true);
        expect(devices.find((d) => d.uid === there.uid)?.current).toBe(false);
    });

    it('removes the caller’s own device', async () => {
        const user = await freshUser(env);
        const device = await register(user.token, {
            platform: 'web',
            token: 'remove-own',
        });

        const res = await call(
            env,
            'DELETE',
            `/push/devices/${device.uid}`,
            user.token,
        );
        expect(res.status).toBe(200);
        await expect(res.json()).resolves.toEqual({ removed: true });
        expect(await list(user.token)).toHaveLength(0);

        const again = await call(
            env,
            'DELETE',
            `/push/devices/${device.uid}`,
            user.token,
        );
        expect(again.status).toBe(404);
    });

    it('answers 404 for another user’s device and leaves it in place', async () => {
        const owner = await freshUser(env);
        const stranger = await freshUser(env);
        const device = await register(owner.token, {
            platform: 'web',
            token: 'remove-other',
        });

        const res = await call(
            env,
            'DELETE',
            `/push/devices/${device.uid}`,
            stranger.token,
        );
        const missing = await call(
            env,
            'DELETE',
            '/push/devices/no-such-uid',
            stranger.token,
        );

        expect(res.status).toBe(404);
        expect(missing.status).toBe(404);
        expect(await res.json()).toEqual(await missing.json());
        expect((await list(owner.token)).map((d) => d.uid)).toEqual([
            device.uid,
        ]);
    });

    it('answers 409 when another user keeps taking the token mid-register', async () => {
        const user = await freshUser(env);
        const other = await freshUser(env);
        const otherRow = await env.server.stores.user.getByUsername(
            other.username,
        );
        const db = env.server.clients.db;
        const pread = db.pread.bind(db);
        let busy = false;
        // The other user takes the token before each read-back.
        const spy = vi.spyOn(db, 'pread').mockImplementation(async (q, p) => {
            if (!busy && q.includes('`token_hash` = ?')) {
                busy = true;
                try {
                    await env.server.stores.pushDevice.register({
                        userId: otherRow!.id,
                        sessionUid: 'other-session',
                        platform: 'web',
                        token: 'contested-token',
                    });
                } finally {
                    busy = false;
                }
            }
            return pread(q, p);
        });
        let res: Response;
        try {
            res = await call(env, 'POST', '/push/devices', user.token, {
                platform: 'web',
                token: 'contested-token',
            });
        } finally {
            spy.mockRestore();
        }

        expect(res.status).toBe(409);
        expect(await res.json()).toMatchObject({
            code: 'push_device_conflict',
        });
        expect(await list(user.token)).toHaveLength(0);
    });

    it('drops a device when the session that registered it signs out', async () => {
        const user = await freshUser(env);
        const row = await env.server.stores.user.getByUsername(user.username);
        const { token: leaving } =
            await env.server.services.auth.createSessionToken(row!, {
                user_agent: 'leaving-session',
            });
        const gone = await register(leaving, { platform: 'ios', token: 'bye' });
        const kept = await register(user.token, {
            platform: 'web',
            token: 'hi',
        });

        await env.server.services.auth.removeSessionByToken(leaving);

        await vi.waitFor(async () => {
            const uids = (await list(user.token)).map((d) => d.uid);
            expect(uids).not.toContain(gone.uid);
            expect(uids).toContain(kept.uid);
        });
    });

    it('answers 429 past 30 registrations a minute', async () => {
        const user = await freshUser(env);
        for (let i = 0; i < 30; i++) {
            const res = await call(env, 'POST', '/push/devices', user.token, {
                platform: 'web',
                token: 'rate-token',
            });
            expect(res.status).toBe(200);
        }
        const res = await call(env, 'POST', '/push/devices', user.token, {
            platform: 'web',
            token: 'rate-token',
        });
        expect(res.status).toBe(429);
    });
});

describe('push device routes with push disabled', () => {
    let env: PuterTestEnv;

    beforeAll(async () => {
        env = await setupPuterTestEnv();
    }, 120_000);

    afterAll(async () => {
        await env?.shutdown();
    });

    it('refuses registration with 503 push_disabled', async () => {
        const res = await call(
            env,
            'POST',
            '/push/devices',
            env.users.user.token,
            {
                platform: 'web',
                token: 'disabled-token',
            },
        );
        expect(res.status).toBe(503);
        expect(await res.json()).toMatchObject({ code: 'push_disabled' });
    });

    it('refuses a test push with 503 push_disabled', async () => {
        const row = await env.server.stores.user.getByUsername(
            env.users.user.username,
        );
        const device = await env.server.services.push.registerDevice({
            userId: row!.id,
            sessionUid: 'session-for-test',
            platform: 'web',
            token: 'disabled-test-token',
            label: null,
            userAgent: null,
        });

        const res = await call(
            env,
            'POST',
            `/push/devices/${device.uid}/test`,
            env.users.user.token,
        );

        expect(res.status).toBe(503);
        expect(await res.json()).toMatchObject({ code: 'push_disabled' });
        await env.server.stores.pushDevice.removeByUid(row!.id, device.uid);
    });

    it('still lists and removes devices', async () => {
        const row = await env.server.stores.user.getByUsername(
            env.users.user.username,
        );
        const device = await env.server.services.push.registerDevice({
            userId: row!.id,
            sessionUid: 'session-from-before',
            platform: 'android',
            token: 'kept-from-before',
            label: null,
            userAgent: null,
        });

        const listed = await call(
            env,
            'GET',
            '/push/devices',
            env.users.user.token,
        );
        expect(listed.status).toBe(200);
        expect(
            ((await listed.json()) as ListBody).devices.map((d) => d.uid),
        ).toEqual([device.uid]);

        const removed = await call(
            env,
            'DELETE',
            `/push/devices/${device.uid}`,
            env.users.user.token,
        );
        expect(removed.status).toBe(200);
    });
});

/** Records each call; a token's text decides its result. */
class FakeProvider implements PushProvider {
    readonly platforms = ['web'] as const;
    readonly calls: PushBatch[] = [];
    async send(batch: PushBatch): Promise<PushResult[]> {
        this.calls.push(batch);
        return batch.tokens.map((token) => {
            if (token.includes('gone')) return { status: 'unregistered' };
            if (token.includes('bad')) {
                return { status: 'failed', code: 'invalid_token' };
            }
            return { status: 'delivered' };
        });
    }
}

describe('push test route and push settings over HTTP', () => {
    let env: PuterTestEnv;
    const provider = new FakeProvider();
    const sockets: ClientSocket[] = [];

    beforeAll(async () => {
        env = await setupPuterTestEnv({
            events: { enabled: true },
            push: { enabled: true },
        } as IConfig);
        env.server.services.push.registerProvider(provider);
    }, 120_000);

    afterAll(async () => {
        while (sockets.length) sockets.pop()?.disconnect();
        await env?.shutdown();
    });

    const register = async (
        token: string,
        body: Record<string, unknown>,
    ): Promise<PublicPushDevice> => {
        const res = await call(env, 'POST', '/push/devices', token, body);
        expect(res.status).toBe(200);
        return ((await res.json()) as DeviceBody).device;
    };

    const sendTest = (token: string, uid: string) =>
        call(env, 'POST', `/push/devices/${uid}/test`, token);

    const connect = (token: string): Promise<void> =>
        new Promise((resolve, reject) => {
            const socket = ioClient(env.origin, {
                auth: { auth_token: token },
                transports: ['websocket'],
                reconnection: false,
            });
            sockets.push(socket);
            socket.on('connect', () => resolve());
            socket.on('connect_error', (err: Error) => reject(err));
        });

    const userRow = async (user: TestUserCredentials) =>
        (await env.server.stores.user.getByUsername(user.username))!;

    const makeApp = async (ownerId: number, title: string) =>
        env.server.stores.app.create(
            {
                name: `push-app-${crypto.randomUUID()}`,
                title,
                index_url: `https://push-${crypto.randomUUID()}.test/`,
            },
            { ownerUserId: ownerId },
        );

    const grant = async (
        user: TestUserCredentials,
        appUid: string,
        permission: string,
    ) =>
        (
            env.server.services.permission as unknown as PermissionService
        ).grantUserAppPermission(
            makeActor({ user: await userRow(user) }),
            appUid,
            permission,
        );

    it('sends one fixed push to the caller’s device while they are connected', async () => {
        const user = await freshUser(env);
        const row = await userRow(user);
        await env.server.stores.user.updateMetadata(row.id, {
            [PUTER_PUSH_PREFERENCE_KEY]: false,
        });
        const device = await register(user.token, {
            platform: 'web',
            token: 'test-route-token',
        });
        await register(user.token, { platform: 'web', token: 'other-token' });
        await connect(user.token);
        expect(isConnectedHere(env.server.services.socket, row.id, null)).toBe(
            true,
        );
        provider.calls.length = 0;

        const res = await sendTest(user.token, device.uid);

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ sent: true });
        expect(provider.calls).toHaveLength(1);
        expect(provider.calls[0]?.tokens).toEqual(['test-route-token']);
        expect(provider.calls[0]?.message).toMatchObject({
            title: 'Push is on for this browser',
            group: PUSH_TEST_GROUP,
        });
    });

    it('answers 404 for another user’s device without sending', async () => {
        const owner = await freshUser(env);
        const stranger = await freshUser(env);
        const device = await register(owner.token, {
            platform: 'web',
            token: 'not-yours-token',
        });
        provider.calls.length = 0;

        const res = await sendTest(stranger.token, device.uid);
        const missing = await sendTest(stranger.token, 'no-such-uid');

        expect(res.status).toBe(404);
        expect(missing.status).toBe(404);
        expect(provider.calls).toHaveLength(0);
    });

    it.each([
        ['expired', 'UPDATE `sessions` SET `expires_at` = 1 WHERE `uuid` = ?'],
        ['revoked', 'UPDATE `sessions` SET `revoked_at` = 1 WHERE `uuid` = ?'],
    ])(
        'answers 404 for a device whose session is %s, leaving it untouched',
        async (_state, statement) => {
            const user = await freshUser(env);
            const row = await userRow(user);
            const { token: other, session } =
                await env.server.services.auth.createSessionToken(row, {
                    user_agent: 'stale-session',
                });
            const device = await register(other, {
                platform: 'web',
                token: `stale-${crypto.randomUUID()}`,
            });
            await env.server.clients.db.write(statement, [session.uuid]);
            const before = await env.server.stores.pushDevice.getByUid(
                device.uid,
            );
            provider.calls.length = 0;

            const res = await sendTest(user.token, device.uid);

            expect(res.status).toBe(404);
            expect(provider.calls).toHaveLength(0);
            expect(
                await env.server.stores.pushDevice.getByUid(device.uid),
            ).toEqual(before);
        },
    );

    it('answers 503 when no provider carries the device’s platform', async () => {
        const user = await freshUser(env);
        const device = await register(user.token, {
            platform: 'ios',
            token: 'ios-token',
        });

        const res = await sendTest(user.token, device.uid);

        expect(res.status).toBe(503);
        expect(await res.json()).toMatchObject({ code: 'push_unavailable' });
    });

    it('answers 502 when the provider reports a failure', async () => {
        const user = await freshUser(env);
        const device = await register(user.token, {
            platform: 'web',
            token: 'bad-token',
        });

        const res = await sendTest(user.token, device.uid);

        expect(res.status).toBe(502);
        expect(await res.json()).toMatchObject({ code: 'push_test_failed' });
    });

    it('removes a device the provider no longer knows and answers 410', async () => {
        const user = await freshUser(env);
        const device = await register(user.token, {
            platform: 'web',
            token: 'gone-token',
        });

        const res = await sendTest(user.token, device.uid);

        expect(res.status).toBe(410);
        expect(await res.json()).toMatchObject({
            code: 'push_device_unregistered',
        });
        const listed = await call(env, 'GET', '/push/devices', user.token);
        expect(((await listed.json()) as ListBody).devices).toEqual([]);
    });

    it('answers 429 past 3 test pushes in 10 minutes', async () => {
        const user = await freshUser(env);
        const device = await register(user.token, {
            platform: 'web',
            token: 'rate-test-token',
        });
        for (let i = 0; i < 3; i++) {
            expect((await sendTest(user.token, device.uid)).status).toBe(200);
        }
        expect((await sendTest(user.token, device.uid)).status).toBe(429);
    });

    it('refuses access tokens and app tokens with 403', async () => {
        const user = await freshUser(env);
        const row = await userRow(user);
        const app = await makeApp(row.id, 'Token app');
        const appToken = await env.server.services.auth.getUserAppToken(
            makeActor({ user: row }),
            app.uid,
        );
        for (const token of [user.apiToken, appToken]) {
            for (const [method, path] of [
                ['POST', '/push/devices/some-uid/test'],
                ['GET', '/push/apps'],
                ['GET', '/push/preferences'],
                ['POST', '/push/preferences'],
            ] as const) {
                const res = await call(env, method, path, token, {
                    puter: false,
                });
                expect(res.status).toBe(403);
            }
        }
    });

    it('lists only the apps granted push, and a revoke ends their consent', async () => {
        const user = await freshUser(env);
        const other = await freshUser(env);
        const row = await userRow(user);
        const pushing = await makeApp(row.id, 'B pushing app');
        const second = await makeApp(row.id, 'A second app');
        const quiet = await makeApp(row.id, 'Quiet app');
        await grant(user, pushing.uid, NOTIFICATIONS_PUSH_PERMISSION);
        await grant(user, second.uid, NOTIFICATIONS_PUSH_PERMISSION);
        await grant(user, quiet.uid, 'notifications:send');
        await grant(other, quiet.uid, NOTIFICATIONS_PUSH_PERMISSION);

        const res = await call(env, 'GET', '/push/apps', user.token);
        expect(res.status).toBe(200);
        const { apps } = (await res.json()) as { apps: PushApp[] };
        expect(apps.map((app) => app.uid)).toEqual([second.uid, pushing.uid]);
        expect(Object.keys(apps[0]!).sort()).toEqual(
            ['icon', 'name', 'title', 'uid'].sort(),
        );
        expect(apps[0]).toMatchObject({
            name: second.name,
            title: 'A second app',
        });

        const consentDeps = {
            stores: env.server.stores,
            services: env.server.services,
        } as unknown as Parameters<typeof hasPushConsent>[0];
        expect(await hasPushConsent(consentDeps, row.id, pushing.uid)).toBe(
            true,
        );
        const revoked = await call(
            env,
            'POST',
            '/auth/revoke-user-app',
            user.token,
            { app_uid: pushing.uid, permission: NOTIFICATIONS_PUSH_PERMISSION },
        );
        expect(revoked.status).toBe(200);

        expect(await hasPushConsent(consentDeps, row.id, pushing.uid)).toBe(
            false,
        );
        const after = await call(env, 'GET', '/push/apps', user.token);
        expect(
            ((await after.json()) as { apps: PushApp[] }).apps.map(
                (app) => app.uid,
            ),
        ).toEqual([second.uid]);
    });

    it('reads and sets the preference for Puter’s own pushes', async () => {
        const user = await freshUser(env);
        const read = async () =>
            (
                await (
                    await call(env, 'GET', '/push/preferences', user.token)
                ).json()
            ).puter;

        expect(await read()).toBe(true);
        const off = await call(env, 'POST', '/push/preferences', user.token, {
            puter: false,
        });
        expect(off.status).toBe(200);
        expect(await off.json()).toEqual({ puter: false });
        expect(await read()).toBe(false);
        const row = await userRow(user);
        expect(row.metadata?.[PUTER_PUSH_PREFERENCE_KEY]).toBe(false);

        await call(env, 'POST', '/push/preferences', user.token, {
            puter: true,
        });
        expect(await read()).toBe(true);
    });

    it('keeps other metadata written since the account was last read', async () => {
        const user = await freshUser(env);
        const row = await userRow(user);
        await env.server.stores.user.getById(row.id);
        await env.server.clients.db.write(
            'UPDATE `user` SET `metadata` = ? WHERE `id` = ?',
            [JSON.stringify({ blockAllShares: true }), row.id],
        );

        const res = await call(env, 'POST', '/push/preferences', user.token, {
            puter: false,
        });

        expect(res.status).toBe(200);
        const [stored] = await env.server.clients.db.pread(
            'SELECT `metadata` FROM `user` WHERE `id` = ?',
            [row.id],
        );
        const metadata =
            typeof stored?.metadata === 'string'
                ? JSON.parse(stored.metadata)
                : stored?.metadata;
        expect(metadata).toEqual({
            blockAllShares: true,
            [PUTER_PUSH_PREFERENCE_KEY]: false,
        });
        const cached = await env.server.stores.user.getById(row.id);
        expect(cached?.metadata).toEqual(metadata);
    });

    it('rejects a preference that is not a boolean with 400', async () => {
        const user = await freshUser(env);
        const res = await call(env, 'POST', '/push/preferences', user.token, {
            puter: 'no',
        });
        expect(res.status).toBe(400);
    });
});
