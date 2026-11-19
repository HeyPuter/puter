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

import bcrypt from 'bcrypt';
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
import {
    checkRateLimit,
    configureRateLimit,
    peekRateLimit,
} from '../../core/http/middleware/rateLimit.js';
import {
    createTestUser,
    setupPuterTestEnv,
    type PuterTestEnv,
} from '../../testUtil.js';
import type { IConfig } from '../../types.js';
import { passwordTag } from '../../util/userDetails.js';
import { KNOWN_DEVICE_COOKIE_NAME } from './knownDevice.js';

/** `name=value` of the device cookie a response sets, if it sets one. */
const deviceCookieOf = (response: Response): string | undefined => {
    const match = response.headers
        .getSetCookie()
        .join(', ')
        .match(new RegExp(`(?:^|,\\s*)(${KNOWN_DEVICE_COOKIE_NAME}=[^;]+)`));
    return match?.[1];
};

// The account budget in this region (Redis) and as every region sees it
// (system KV).
const HOUR = 'login-password-failure';
const DAY = 'login-password-failure-day';
const GLOBAL_HOUR = 'login-password-failure-global';
const GLOBAL_DAY = 'login-password-failure-global-day';
const HOUR_MS = 60 * 60_000;

/** A budget's key under the account's current password. */
const budgetKey = (
    scope: string,
    user: { uuid: string; password?: unknown },
) => `${scope}:${user.uuid}:${passwordTag(user)}`;

describe('per-account wrong-password budget on /login', () => {
    let env: PuterTestEnv;
    const password = 'lockout-correct-password';
    const sent: Array<{ to: string; template: string; values: unknown }> = [];
    let nextAddress = 0;

    beforeAll(async () => {
        // Trusting the proxy header lets each request come from its own
        // address, the way a caller rotating proxies would.
        env = await setupPuterTestEnv({ trust_proxy: true } as IConfig);
    }, 120_000);
    afterAll(async () => {
        await env?.shutdown();
    });
    afterEach(() => {
        vi.restoreAllMocks();
        sent.length = 0;
    });

    const captureEmail = () =>
        vi
            .spyOn(env.server.clients.email, 'send')
            .mockImplementation(async (to, template, values) => {
                sent.push({ to, template, values });
                return null;
            });

    const freshAddress = () => {
        nextAddress++;
        return `10.${(nextAddress >> 16) & 255}.${(nextAddress >> 8) & 255}.${nextAddress & 255}`;
    };

    const login = async (
        username: string,
        attempt: string,
        cookie?: string,
    ) => {
        const response = await fetch(new URL('/login', env.origin), {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-forwarded-for': freshAddress(),
                ...(cookie ? { cookie } : {}),
            },
            body: JSON.stringify({ username, password: attempt }),
        });
        const deviceCookie = deviceCookieOf(response);
        return {
            status: response.status,
            body: (await response.json()) as Record<string, unknown>,
            deviceCookie,
            // The session cookie is set first.
            sessionCookie: response.headers.getSetCookie()[0]?.split(';')[0],
        };
    };

    const account = async () => {
        const username = `lockout_${uuidv4().slice(0, 8)}`;
        await createTestUser(env.server, { username, password });
        const user = (await env.server.stores.user.getByUsername(username))!;
        await env.server.stores.user.update(user.id, {
            email: `${username}@example.com`,
            email_confirmed: true,
        });
        return { username, user };
    };

    const missPassword = async (username: string, times: number) => {
        for (let i = 0; i < times; i++) {
            const { status, body } = await login(username, `wrong-${i}-guess`);
            expect(status).toBe(401);
            expect(body.code).toBe('password_mismatch');
        }
    };

    it('locks on the attempt after the twentieth wrong password, not before', async () => {
        const { username } = await account();
        await missPassword(username, 19);
        expect((await login(username, password)).status).toBe(200);

        // The correct password spent nothing, so twenty more wrong ones fit.
        await missPassword(username, 1);
        const locked = await login(username, 'wrong-again');
        expect(locked.status).toBe(429);
        expect(locked.body).toMatchObject({
            code: 'too_many_requests',
            errorCode: 'login_locked',
            action: 'reset_password',
        });
    });

    it('refuses the correct password while locked, from a device the account has not seen', async () => {
        const { username } = await account();
        await missPassword(username, 20);
        const refused = await login(username, password);
        expect(refused.status).toBe(429);
        expect(refused.body.errorCode).toBe('login_locked');
        expect(refused.body.token).toBeUndefined();
        expect(refused.deviceCookie).toBeUndefined();
    });

    it('a spent day window locks the account too', async () => {
        const { username, user } = await account();
        for (let i = 0; i < 50; i++) {
            await checkRateLimit(
                budgetKey(DAY, user),
                50,
                24 * 60 * 60_000,
            );
        }
        expect((await login(username, password)).status).toBe(429);
    });

    it('admits only the guesses that fit, however many arrive at once', async () => {
        const { username } = await account();
        await missPassword(username, 18);
        const burst = await Promise.all(
            Array.from({ length: 6 }, (_, i) =>
                login(username, `burst-${i}-guess`),
            ),
        );
        const statuses = burst.map((r) => r.status);
        expect(statuses.filter((s) => s === 401)).toHaveLength(2);
        expect(statuses.filter((s) => s === 429)).toHaveLength(4);
    });

    it('locks on wrong passwords counted in another region', async () => {
        const { username, user } = await account();
        for (let i = 0; i < 20; i++) {
            await checkRateLimit(
                budgetKey(GLOBAL_HOUR, user),
                20,
                60 * 60_000,
                'kv',
            );
        }
        const locked = await login(username, password);
        expect(locked.status).toBe(429);
        expect(locked.body.errorCode).toBe('login_locked');
    });

    it('counts each wrong password where every region reads it, and a right one nowhere', async () => {
        const { username, user } = await account();
        await missPassword(username, 2);
        expect((await login(username, password)).status).toBe(200);
        for (const scope of [GLOBAL_HOUR, GLOBAL_DAY]) {
            const key = budgetKey(scope, user);
            expect(await peekRateLimit(key, 2, 60 * 60_000, 'kv')).toBe(false);
            expect(await peekRateLimit(key, 3, 60 * 60_000, 'kv')).toBe(true);
        }
    });

    it('lets a device that signed in before through the lockout', async () => {
        const { username } = await account();
        const first = await login(username, password);
        expect(first.status).toBe(200);
        expect(first.deviceCookie).toBeDefined();
        const device = first.deviceCookie!;

        await missPassword(username, 20);
        expect((await login(username, password)).status).toBe(429);

        // Its wrong guesses still answer as wrong, and its right one signs in.
        const miss = await login(username, 'wrong-from-device', device);
        expect(miss.status).toBe(401);
        const signedIn = await login(username, password, device);
        expect(signedIn.status).toBe(200);
        expect(signedIn.body.next_step).toBe('complete');
    });

    it("doesn't take another account's device as known", async () => {
        const owner = await account();
        const stranger = await account();
        const device = (await login(stranger.username, password)).deviceCookie!;
        await missPassword(owner.username, 20);
        expect((await login(owner.username, password, device)).status).toBe(
            429,
        );
    });

    it('alarms and emails the owner once when the lock trips', async () => {
        captureEmail();
        const alarm = vi.spyOn(env.server.clients.alarm, 'create');
        const { username, user } = await account();
        const device = (await login(username, password)).deviceCookie!;

        await missPassword(username, 19);
        expect(
            alarm.mock.calls.filter(([id]) => id.includes(user.uuid)),
        ).toHaveLength(0);
        await missPassword(username, 1);
        // A known device keeps failing past the lock; nothing new goes out.
        expect(
            (await login(username, 'wrong-from-device', device)).status,
        ).toBe(401);

        const raised = alarm.mock.calls.filter(
            ([id]) => id === `auth:login-locked:${user.uuid}`,
        );
        expect(raised).toHaveLength(1);
        expect(raised[0]![2]).toEqual({
            username,
            user_uuid: user.uuid,
            ip: expect.any(String),
        });
        expect(raised[0]![3]).toBe('warning');
        const notices = sent.filter(
            (m) => m.template === 'login_locked_notification',
        );
        expect(notices).toHaveLength(1);
        expect(notices[0]).toMatchObject({
            to: `${username}@example.com`,
            values: {
                username,
                reset_link: `${env.origin}/action/password-recovery`,
                sessions_link: `${env.origin}/dashboard#security`,
            },
        });
    });

    it('keeps the suspended-account answer while locked', async () => {
        const { username, user } = await account();
        await missPassword(username, 20);
        await env.server.stores.user.update(user.id, { suspended: true });
        const response = await login(username, password);
        expect(response.status).toBe(401);
        expect(response.body.code).toBe('account_suspended');
    });

    it('a completed password reset lifts the lock in every region and tells the owner', async () => {
        captureEmail();
        const { username, user } = await account();
        await missPassword(username, 20);
        expect((await login(username, password)).status).toBe(429);
        for (let i = 0; i < 30; i++) {
            await checkRateLimit(
                budgetKey(GLOBAL_DAY, user),
                50,
                24 * 60 * 60_000,
                'kv',
            );
        }

        const recoveryToken = uuidv4();
        await env.server.stores.user.update(user.id, {
            pass_recovery_token: recoveryToken,
        });
        const token = env.server.services.token.sign(
            'otp',
            {
                token: recoveryToken,
                user_uid: user.uuid,
                email: `${username}@example.com`,
                purpose: 'pass-recovery',
            },
            { expiresIn: '1h' },
        );
        const reset = await fetch(
            new URL('/set-pass-using-token', env.origin),
            {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ token, password: 'a-new-password' }),
            },
        );
        expect(reset.status).toBe(200);

        expect((await login(username, 'a-new-password')).status).toBe(200);
        expect(
            sent.filter(
                (m) =>
                    m.template === 'password_change_notification' &&
                    m.to === `${username}@example.com`,
            ),
        ).toHaveLength(1);
    });

    it('a password change from a signed-in session lifts the lock', async () => {
        const { username } = await account();
        const { sessionCookie } = await login(username, password);
        await missPassword(username, 20);
        expect((await login(username, password)).status).toBe(429);

        const change = await fetch(
            new URL('/user-protected/change-password', env.origin),
            {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    cookie: sessionCookie!,
                },
                body: JSON.stringify({ password, new_pass: 'a-changed-password' }),
            },
        );
        expect(change.status).toBe(200);
        expect((await login(username, 'a-changed-password')).status).toBe(200);
    });

    it('a password set outside the sign-in routes (a team reset) lifts the lock, and a new lock notifies again', async () => {
        captureEmail();
        const { username, user } = await account();
        await missPassword(username, 20);
        expect((await login(username, password)).status).toBe(429);

        await env.server.stores.user.update(user.id, {
            password: await bcrypt.hash('a-team-reset-password', 8),
        });
        expect((await login(username, 'a-team-reset-password')).status).toBe(
            200,
        );

        await missPassword(username, 20);
        expect(
            sent.filter((m) => m.template === 'login_locked_notification'),
        ).toHaveLength(2);
    });

    it('gives the reservation back when the password check fails', async () => {
        const { username, user } = await account();
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(bcrypt, 'compare').mockRejectedValueOnce(
            new Error('bcrypt failed') as never,
        );
        expect((await login(username, password)).status).toBe(500);
        expect(
            await peekRateLimit(budgetKey(HOUR, user), 1, HOUR_MS, 'redis'),
        ).toBe(true);
    });

    it('reserves on Redis even where the limiter defaults to the KV store', async () => {
        const { redis } = env.server.clients;
        const { kv } = env.server.stores;
        configureRateLimit({ default: 'kv', redis, kv });
        try {
            const { username, user } = await account();
            await missPassword(username, 1);
            const key = budgetKey(HOUR, user);
            expect(await peekRateLimit(key, 1, HOUR_MS, 'redis')).toBe(false);
            expect(await peekRateLimit(key, 1, HOUR_MS, 'kv')).toBe(true);
        } finally {
            configureRateLimit({
                default: 'redis',
                redis,
                kv,
                metering: env.server.services.metering,
            });
        }
    });
});
