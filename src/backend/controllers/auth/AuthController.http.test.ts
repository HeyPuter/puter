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

import { TOTP } from 'otpauth';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeActor } from '../../core/actor.js';
import { runWithContext } from '../../core/context.js';
import { createSecret as otpCreateSecret } from '../../services/auth/OTPUtil.js';
import { FULL_API_ACCESS } from '../../services/permission/consts.js';
import {
    createTestUser,
    setupPuterTestEnv,
    type PuterTestEnv,
} from '../../testUtil.js';
import type { IConfig } from '../../types';

/**
 * HTTP-level coverage for `/auth/revoke-own-access-token` — the route that
 * lets an app revoke a read-URL token it minted itself, without touching the
 * account-only `/auth/revoke-access-token`.
 */
describe('revoke-own-access-token over HTTP', () => {
    let env: PuterTestEnv;

    beforeAll(async () => {
        env = await setupPuterTestEnv();
    }, 120_000);

    afterAll(async () => {
        await env?.shutdown();
    });

    const call = (
        method: string,
        path: string,
        token: string,
        body?: unknown,
    ) =>
        fetch(new URL(path, env.apiOrigin), {
            method,
            headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${token}`,
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });

    const tokenReadStatus = async (fileUid: string, token: string) => {
        const url = new URL('/token-read', env.apiOrigin);
        url.searchParams.set('uid', fileUid);
        url.searchParams.set('token', token);
        return (await fetch(url)).status;
    };

    /** A file with real content in `owner`'s home, readable by uid. */
    const makeFile = async (owner: { username: string }) => {
        const user = await env.server.stores.user.getByUsername(
            owner.username,
        );
        const content = Buffer.from(`revoke-http-${crypto.randomUUID()}`);
        const path = `/${owner.username}/Documents/${crypto.randomUUID()}.txt`;
        await env.server.services.fs.write(user!.id, {
            fileMetadata: {
                path,
                size: content.byteLength,
                contentType: 'text/plain',
            },
            fileContent: content,
        });
        const entry = await env.server.stores.fsEntry.getEntryByPath(path);
        return { uid: entry!.uid };
    };

    /** An app of `owner`'s, with a token and read reach over `file`. */
    const makeApp = async (
        owner: { username: string },
        file: { uid: string },
    ) => {
        const user = await env.server.stores.user.getByUsername(
            owner.username,
        );
        const actor = makeActor({ user: user! });
        const app = await env.server.stores.app.create(
            {
                name: `auth-http-app-${crypto.randomUUID()}`,
                title: 'Auth app',
                index_url: `https://auth-${crypto.randomUUID()}.test/`,
            },
            { ownerUserId: actor.user.id! },
        );
        await runWithContext({ actor }, () =>
            env.server.services.permission.grantUserAppPermission(
                actor,
                app.uid,
                `fs:${file.uid}:read`,
            ),
        );
        const token = await env.server.services.auth.getUserAppToken(
            actor,
            app.uid,
        );
        return { ...app, token };
    };

    /** A scoped (non-full-access) access token for `owner`, carrying no app. */
    const makeScopedToken = async (owner: {
        username: string;
        token: string;
    }) => {
        const res = await call(
            'POST',
            '/auth/create-access-token',
            owner.token,
            { permissions: ['service:foo:ii:read'], expiresIn: '1h' },
        );
        expect(res.status).toBe(200);
        return ((await res.json()) as { token: string }).token;
    };

    /** Mints a read-URL token the way `getReadURL()` does. */
    const mintReadToken = async (callerToken: string, fileUid: string) => {
        const res = await call(
            'POST',
            '/auth/create-access-token',
            callerToken,
            { permissions: [`fs:${fileUid}:read`], expiresIn: '1h' },
        );
        expect(res.status).toBe(200);
        return ((await res.json()) as { token: string }).token;
    };

    it('lets an app revoke a read token it minted itself', async () => {
        const owner = env.users.user;
        const file = await makeFile(owner);
        const app = await makeApp(owner, file);
        const readToken = await mintReadToken(app.token, file.uid);

        expect(await tokenReadStatus(file.uid, readToken)).toBe(200);

        const res = await call(
            'POST',
            '/auth/revoke-own-access-token',
            app.token,
            { token: readToken },
        );
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ok: true });

        expect(await tokenReadStatus(file.uid, readToken)).not.toBe(200);
    });

    it('404s a second app of the same user, and the URL still works', async () => {
        const owner = env.users.user;
        const file = await makeFile(owner);
        const app = await makeApp(owner, file);
        const otherApp = await makeApp(owner, file);
        const readToken = await mintReadToken(app.token, file.uid);

        const res = await call(
            'POST',
            '/auth/revoke-own-access-token',
            otherApp.token,
            { token: readToken },
        );
        expect(res.status).toBe(404);
        expect(await res.json()).toMatchObject({ code: 'not_found' });

        expect(await tokenReadStatus(file.uid, readToken)).toBe(200);
    });

    it('lets the account session revoke an app-minted token', async () => {
        const owner = env.users.user;
        const file = await makeFile(owner);
        const app = await makeApp(owner, file);
        const readToken = await mintReadToken(app.token, file.uid);

        const res = await call(
            'POST',
            '/auth/revoke-own-access-token',
            owner.token,
            { token: readToken },
        );
        expect(res.status).toBe(200);
        expect(await tokenReadStatus(file.uid, readToken)).not.toBe(200);
    });

    it('404s another user entirely', async () => {
        const owner = env.users.user;
        const file = await makeFile(owner);
        const app = await makeApp(owner, file);
        const readToken = await mintReadToken(app.token, file.uid);

        const res = await call(
            'POST',
            '/auth/revoke-own-access-token',
            env.users.other.token,
            { token: readToken },
        );
        expect(res.status).toBe(404);
        expect(await res.json()).toMatchObject({ code: 'not_found' });
        expect(await tokenReadStatus(file.uid, readToken)).toBe(200);
    });

    it('404s an app presenting an account-issued token', async () => {
        const owner = env.users.user;
        const file = await makeFile(owner);
        const app = await makeApp(owner, file);
        // Minted with the owner's own session, so it carries no `app_uid`.
        const accountToken = await mintReadToken(owner.token, file.uid);

        const res = await call(
            'POST',
            '/auth/revoke-own-access-token',
            app.token,
            { token: accountToken },
        );
        expect(res.status).toBe(404);
        expect(await res.json()).toMatchObject({ code: 'not_found' });
        expect(await tokenReadStatus(file.uid, accountToken)).toBe(200);
    });

    it('refuses a scoped access token as caller', async () => {
        const owner = env.users.user;
        const scoped = await makeScopedToken(owner);

        const res = await call(
            'POST',
            '/auth/revoke-own-access-token',
            scoped,
            { token: scoped },
        );
        expect(res.status).toBe(403);
        expect(await res.json()).toMatchObject({ code: 'forbidden' });
    });

    it('rejects a non-JWT string with token_invalid', async () => {
        const owner = env.users.user;
        const res = await call(
            'POST',
            '/auth/revoke-own-access-token',
            owner.token,
            { token: 'not-a-jwt' },
        );
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({ code: 'token_invalid' });
    });

    it('still requires `token` in the body', async () => {
        const owner = env.users.user;
        const res = await call(
            'POST',
            '/auth/revoke-own-access-token',
            owner.token,
            {},
        );
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({ code: 'bad_request' });
    });

    /** A second personal API token for `owner`, minted the way the dashboard does. */
    const mintPersonalToken = async (owner: { token: string }) => {
        const { actor } = await env.server.services.auth.authenticate(
            owner.token,
        );
        return env.server.services.auth.createAccessToken(actor!, [
            [FULL_API_ACCESS],
        ]);
    };

    const whoamiStatus = async (token: string) =>
        (await call('GET', '/whoami', token)).status;

    it('refuses to revoke a personal API token, even for its own account', async () => {
        const owner = env.users.user;
        const pat = await mintPersonalToken(owner);

        const res = await call(
            'POST',
            '/auth/revoke-own-access-token',
            owner.token,
            { token: pat },
        );
        expect(res.status).toBe(403);
        expect(await res.json()).toMatchObject({ code: 'forbidden' });
        expect(await whoamiStatus(pat)).toBe(200);
    });

    it('keeps a personal API token from revoking a sibling one', async () => {
        const owner = env.users.user;
        const sibling = await mintPersonalToken(owner);

        const res = await call(
            'POST',
            '/auth/revoke-own-access-token',
            owner.apiToken,
            { token: sibling },
        );
        expect(res.status).toBe(403);
        expect(await res.json()).toMatchObject({ code: 'forbidden' });
        expect(await whoamiStatus(sibling)).toBe(200);
    });

    it('lets a personal API token revoke its account`s read token', async () => {
        const owner = env.users.user;
        const file = await makeFile(owner);
        // Access tokens can't mint, so the account session creates the URL.
        const readToken = await mintReadToken(owner.token, file.uid);
        expect(await tokenReadStatus(file.uid, readToken)).toBe(200);

        const res = await call(
            'POST',
            '/auth/revoke-own-access-token',
            owner.apiToken,
            { token: readToken },
        );
        expect(res.status).toBe(200);
        expect(await tokenReadStatus(file.uid, readToken)).not.toBe(200);
    });

    it('resolves a second revoke of the same token', async () => {
        const owner = env.users.user;
        const file = await makeFile(owner);
        const app = await makeApp(owner, file);
        const readToken = await mintReadToken(app.token, file.uid);

        for (let i = 0; i < 2; i++) {
            const res = await call(
                'POST',
                '/auth/revoke-own-access-token',
                app.token,
                { token: readToken },
            );
            expect(res.status).toBe(200);
        }
        expect(await tokenReadStatus(file.uid, readToken)).not.toBe(200);
    });

    // These three run last in the file's shared `env.users.user`: each one
    // revokes a session belonging to `owner.token` / `owner.workerToken`, so
    // later tests can't rely on those credentials still being live.

    it('a revoked access token yields 401 with no reauth_token or auth_id', async () => {
        const owner = env.users.user;
        const file = await makeFile(owner);
        const readToken = await mintReadToken(owner.token, file.uid);

        const revoke = await call(
            'POST',
            '/auth/revoke-own-access-token',
            owner.token,
            { token: readToken },
        );
        expect(revoke.status).toBe(200);

        const res = await call('GET', '/whoami', readToken);
        expect(res.status).toBe(401);
        const body = (await res.json()) as Record<string, unknown>;
        expect(body.code).toBe('reauth_required');
        expect(body.reauth_token).toBeUndefined();
        expect(body.auth_id).toBeUndefined();
    });

    it('a revoked worker session gets no reauth_token even though it rides the session token type', async () => {
        const owner = env.users.user;
        const decoded = env.server.services.token.verify(
            'auth',
            owner.workerToken,
        ) as { session_uid: string };
        await env.server.stores.session.removeByUuid(decoded.session_uid);

        const res = await call('GET', '/whoami', owner.workerToken);
        expect(res.status).toBe(401);
        const body = (await res.json()) as Record<string, unknown>;
        expect(body.code).toBe('reauth_required');
        expect(body.reauth_token).toBeUndefined();
        expect(body.auth_id).toBeUndefined();
    });

    it('a revoked GUI session still gets a reauth_token', async () => {
        const owner = env.users.user;
        const decoded = env.server.services.token.verify('auth', owner.token) as {
            session_uid: string;
        };
        await env.server.stores.session.removeByUuid(decoded.session_uid);

        const res = await call('GET', '/whoami', owner.token);
        expect(res.status).toBe(401);
        const body = (await res.json()) as Record<string, unknown>;
        expect(body.code).toBe('reauth_required');
        expect(typeof body.reauth_token).toBe('string');

        const user = await env.server.stores.user.getByUsername(
            owner.username,
        );
        expect(
            env.server.services.auth.verifyReauthToken(
                body.reauth_token as string,
            ).authId,
        ).toBe(user!.uuid);
    });
});

/**
 * Enrolling a second factor: setup sits behind the user-protected gate, and
 * enable needs a live code for the secret setup issued.
 */
describe('2FA enrollment over HTTP', () => {
    let env: PuterTestEnv;

    beforeAll(async () => {
        env = await setupPuterTestEnv({ teams_enabled: true } as IConfig);
    }, 120_000);

    afterAll(async () => {
        await env?.shutdown();
    });

    const PASSWORD = 'tfa-http-password';

    const uniq = () => Math.random().toString(36).slice(2, 10);

    /** A signed-in password account with a confirmed address. */
    const makeAccount = async () => {
        const username = `tfa_${uniq()}`;
        const { token } = await createTestUser(env.server, {
            username,
            password: PASSWORD,
        });
        const row = (await env.server.stores.user.getByUsername(username))!;
        await env.server.stores.user.update(row.id, {
            email: `${username}@test.local`,
            email_confirmed: 1,
        });
        await env.server.stores.user.invalidateById(row.id);
        return { username, token, userId: row.id };
    };

    /** The user-protected gate takes the session cookie on the GUI origin. */
    const protectedPost = (
        path: string,
        token: string,
        body: Record<string, unknown>,
        credential: 'cookie' | 'bearer' = 'cookie',
    ) =>
        fetch(new URL(path, env.origin), {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                ...(credential === 'cookie'
                    ? { cookie: `puter_auth_token=${token}` }
                    : { authorization: `Bearer ${token}` }),
            },
            body: JSON.stringify(body),
        });

    const setup = (
        token: string,
        body: Record<string, unknown>,
        credential: 'cookie' | 'bearer' = 'cookie',
    ) => protectedPost('/user-protected/setup-2fa', token, body, credential);

    const configure = (
        token: string,
        action: string,
        body: Record<string, unknown> = {},
    ) =>
        fetch(new URL(`/auth/configure-2fa/${action}`, env.apiOrigin), {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(body),
        });

    const otpState = async (userId: number) => {
        const row = await env.server.stores.user.getByProperty('id', userId, {
            force: true,
        });
        return {
            secret: row?.otp_secret ?? null,
            enabled: Boolean(row?.otp_enabled),
        };
    };

    const liveTotp = (username: string, secret: string) =>
        new TOTP({
            issuer: 'puter.com',
            label: username,
            algorithm: 'SHA1',
            digits: 6,
            secret,
        }).generate();

    it('refuses setup to a session that has not re-proved the password', async () => {
        const account = await makeAccount();

        const noPassword = await setup(account.token, {});
        expect(noPassword.status).toBe(403);
        expect(await noPassword.text()).toContain('password_required');

        const wrongPassword = await setup(account.token, { password: 'nope' });
        expect(wrongPassword.status).toBe(400);
        expect(await wrongPassword.text()).toContain('password_mismatch');

        // Right password, but a bearer token is not the session cookie.
        const bearer = await setup(
            account.token,
            { password: PASSWORD },
            'bearer',
        );
        expect(bearer.status).toBe(401);

        // The old ungated path no longer hands out a secret.
        expect((await configure(account.token, 'setup')).status).toBe(400);

        expect((await otpState(account.userId)).secret).toBeNull();
    });

    it('enrolls after the password, and enables only on a live code', async () => {
        const account = await makeAccount();

        const res = await setup(account.token, { password: PASSWORD });
        expect(res.status).toBe(200);
        const { secret, codes } = (await res.json()) as {
            secret: string;
            codes: string[];
        };
        expect(codes).toHaveLength(10);
        expect((await otpState(account.userId)).secret).toBe(secret);

        expect((await configure(account.token, 'enable')).status).toBe(400);
        const foreign = otpCreateSecret(account.username).secret;
        const wrong = await configure(account.token, 'enable', {
            code: liveTotp(account.username, foreign),
        });
        expect(wrong.status).toBe(400);
        expect(await wrong.text()).toContain('code_mismatch');
        expect((await otpState(account.userId)).enabled).toBe(false);

        const enabled = await configure(account.token, 'enable', {
            code: liveTotp(account.username, secret),
        });
        expect(enabled.status).toBe(200);
        expect((await otpState(account.userId)).enabled).toBe(true);
    });

    it('lets a seat its team holds for 2FA enroll through the same gate', async () => {
        const owner = await makeAccount();
        // The rule can only be turned on by an owner who has 2FA.
        await env.server.stores.user.update(owner.userId, { otp_enabled: 1 });
        await env.server.stores.user.invalidateById(owner.userId);
        const team = await env.server.services.team.createTeam(owner.userId, {
            name: 'Acme',
        });
        const seatName = `seat_${uniq()}`;
        const { userId, temporaryPassword } =
            await env.server.services.team.provisionAccount(
                team.uid,
                owner.userId,
                { username: seatName },
            );
        await env.server.services.team.updateTeam(team.uid, owner.userId, {
            require2fa: true,
        });
        const { token } = await env.server.services.auth.createSessionToken(
            (await env.server.stores.user.getById(userId))!,
        );

        // First sign-in replaces the temporary password.
        const changed = await protectedPost(
            '/user-protected/change-password',
            token,
            { password: temporaryPassword, new_pass: 'seat-own-password' },
        );
        expect(changed.status).toBe(200);

        const held = await fetch(new URL('/teams', env.apiOrigin), {
            headers: { authorization: `Bearer ${token}` },
        });
        expect(held.status).toBe(403);
        expect(await held.text()).toContain('two_factor_required');

        const res = await setup(token, { password: 'seat-own-password' });
        expect(res.status).toBe(200);
        const { secret } = (await res.json()) as { secret: string };
        const enabled = await configure(token, 'enable', {
            code: liveTotp(seatName, secret),
        });
        expect(enabled.status).toBe(200);
        expect((await otpState(userId)).enabled).toBe(true);

        const released = await fetch(new URL('/teams', env.apiOrigin), {
            headers: { authorization: `Bearer ${token}` },
        });
        expect(released.status).toBe(200);
    });
});

/**
 * A temp account re-attaches through `/signup` only from a session that ran
 * out, not from one that was revoked.
 */
describe('temp-account reauth over HTTP', () => {
    let env: PuterTestEnv;

    beforeAll(async () => {
        env = await setupPuterTestEnv();
    }, 120_000);

    afterAll(async () => {
        await env?.shutdown();
    }, 120_000);

    const signup = (body: Record<string, unknown>) =>
        fetch(new URL('/signup', env.origin), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
        });

    it('a revoked temp session cannot be revived with its reauth_token', async () => {
        const first = await signup({ is_temp: true });
        expect(first.status).toBe(200);
        const { token } = (await first.json()) as { token: string };

        const decoded = env.server.services.token.verify('auth', token) as {
            session_uid: string;
        };
        await env.server.services.auth.revokeSession(decoded.session_uid);

        const who = await fetch(new URL('/whoami', env.apiOrigin), {
            headers: { authorization: `Bearer ${token}` },
        });
        expect(who.status).toBe(401);
        const { reauth_token } = (await who.json()) as {
            reauth_token?: string;
        };
        expect(typeof reauth_token).toBe('string');

        const revive = await signup({ is_temp: true, reauth_token });
        expect(revive.status).toBe(401);
    });

    it('an expired temp session re-attaches to the same account', async () => {
        const first = await signup({ is_temp: true });
        expect(first.status).toBe(200);
        const { user } = (await first.json()) as { user: { uuid: string } };

        const reauth_token = env.server.services.auth.signReauthToken(
            user.uuid,
            'session_expired',
        );
        const again = await signup({ is_temp: true, reauth_token });
        expect(again.status).toBe(200);
        const body = (await again.json()) as {
            token: string;
            user: { uuid: string };
        };
        expect(body.user.uuid).toBe(user.uuid);
        const who = await fetch(new URL('/whoami', env.apiOrigin), {
            headers: { authorization: `Bearer ${body.token}` },
        });
        expect(who.status).toBe(200);
    });
});
