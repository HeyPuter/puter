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

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { makeActor } from '../../core/actor.js';
import type { IConfig } from '../../types.js';
import {
    createTestUser,
    setupPuterTestEnv,
    type PuterTestEnv,
    type TestUserCredentials,
} from '../../testUtil.js';
import type { PublicPushDevice } from './PushController.js';

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
            token: 'fcm-token-register',
            label: '  Pixel  ',
        });

        expect(res.status).toBe(200);
        const text = await res.text();
        expect(text).not.toContain('fcm-token-register');
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
