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

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeActor } from '../../core/actor.js';
import { runWithContext } from '../../core/context.js';
import { FULL_API_ACCESS } from '../../services/permission/consts.js';
import { setupPuterTestEnv, type PuterTestEnv } from '../../testUtil.js';

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
});
