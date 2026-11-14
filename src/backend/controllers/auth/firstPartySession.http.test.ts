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
import type { IConfig } from '../../types.js';
import { setupPuterTestEnv, type PuterTestEnv } from '../../testUtil.js';

const PAGE = 'https://desk.first-party.test';
// Seeded with godmode on.
const DEV_CENTER = 'app-0b37f054-07d4-4627-8765-11bd23e889d4';

/**
 * One of the deployment's own pages, served apart from the GUI, signs in with a
 * `web` session of its own under the user's sign-in.
 */
describe('first-party page sessions', () => {
    let env: PuterTestEnv;
    let userId = 0;

    beforeAll(async () => {
        env = await setupPuterTestEnv({
            first_party_session_origins: [`${PAGE}/`],
        } as IConfig);
        const row = await env.server.stores.user.getByUsername(
            env.users.user.username,
        );
        userId = row!.id;
    }, 120_000);

    afterAll(async () => {
        await env?.shutdown();
    });

    const call = (
        method: string,
        path: string,
        token: string,
        body?: unknown,
        headers: Record<string, string> = {},
    ) =>
        fetch(new URL(path, env.apiOrigin), {
            method,
            headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${token}`,
                ...headers,
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });

    /** A sign-in of its own, so revoking it leaves the shared one up. */
    const signIn = async () => {
        const user = await env.server.stores.user.getById(userId);
        const { gui_token, session } =
            await env.server.services.auth.createSessionToken(user!);
        return { token: gui_token, uuid: session.uuid as string };
    };

    const mint = async (token: string, origin = PAGE) => {
        const res = await call('POST', '/auth/first-party-session', token, {
            origin,
        });
        expect(res.status).toBe(200);
        return ((await res.json()) as { token: string }).token;
    };

    const actorOf = async (token: string) =>
        (await env.server.services.auth.authenticate(token)).actor;

    const sessions = async (token: string) => {
        const res = await call('GET', '/auth/list-sessions', token);
        expect(res.status).toBe(200);
        return (await res.json()) as Array<Record<string, unknown>>;
    };

    it('hands the page a session of its own under the sign-in', async () => {
        const root = await signIn();
        const token = await mint(root.token);

        const actor = await actorOf(token);
        expect(actor?.app ?? null).toBeNull();
        expect(actor?.accessToken ?? null).toBeNull();
        expect(actor?.session).toMatchObject({
            kind: 'web',
            parentUid: root.uuid,
        });
        expect(actor?.session?.uid).not.toBe(root.uuid);

        const row = (await sessions(root.token)).find(
            (s) => s.uuid === actor!.session!.uid,
        );
        expect(row).toMatchObject({
            kind: 'web',
            parent_session_id: root.uuid,
            first_party_origin: PAGE,
            current: false,
        });
    });

    it('reuses the session on a second ask', async () => {
        const root = await signIn();
        const first = await actorOf(await mint(root.token));
        const second = await actorOf(await mint(root.token));
        expect(second?.session?.uid).toBe(first?.session?.uid);
    });

    it('acts as the account: launches apps, godmode ones included', async () => {
        const root = await signIn();
        const token = await mint(root.token);

        const res = await call('POST', '/auth/get-user-app-token', token, {
            app_uid: DEV_CENTER,
        });
        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ godmode: true });
    });

    it('refuses an origin that is not listed', async () => {
        const root = await signIn();
        const res = await call(
            'POST',
            '/auth/first-party-session',
            root.token,
            {
                origin: 'https://elsewhere.test',
            },
        );
        expect(res.status).toBe(403);
    });

    it('refuses a page on another origin, the listed page included', async () => {
        const root = await signIn();
        for (const origin of [PAGE, 'https://elsewhere.test']) {
            const res = await call(
                'POST',
                '/auth/first-party-session',
                root.token,
                { origin: PAGE },
                { origin },
            );
            expect(res.status).toBe(403);
        }
    });

    it('refuses app tokens, access tokens and a first-party session', async () => {
        const root = await signIn();
        const page = await mint(root.token);
        const app = (await (
            await call('POST', '/auth/get-user-app-token', root.token, {
                origin: 'https://some-app.test',
            })
        ).json()) as { token: string };
        const godmode = (await (
            await call('POST', '/auth/get-user-app-token', root.token, {
                app_uid: DEV_CENTER,
            })
        ).json()) as { token: string };

        for (const token of [page, app.token, godmode.token]) {
            const res = await call('POST', '/auth/first-party-session', token, {
                origin: PAGE,
            });
            expect(res.status).toBe(403);
        }
    });

    it('never gets a session cookie', async () => {
        const root = await signIn();
        const page = await mint(root.token);

        const syncCookie = (token: string) =>
            fetch(new URL('/session/sync-cookie', env.origin), {
                headers: { authorization: `Bearer ${token}` },
            });
        expect((await syncCookie(root.token)).status).toBe(204);

        const res = await syncCookie(page);
        expect(res.status).toBe(403);
        expect(res.headers.get('set-cookie')).toBeNull();
    });

    it('ends with the sign-in it was handed out under', async () => {
        const root = await signIn();
        const page = await mint(root.token);
        expect(await actorOf(page)).toBeDefined();

        await env.server.services.auth.revokeSession(root.uuid);
        const result = await env.server.services.auth.authenticate(page);
        expect(result.actor).toBeUndefined();
        expect(result.reauth?.reason).toBe('session_revoked');
    });

    it('takes the tokens minted under it along when its sign-in ends', async () => {
        const root = await signIn();
        const page = await mint(root.token);
        const godmode = (await (
            await call('POST', '/auth/get-user-app-token', page, {
                app_uid: DEV_CENTER,
            })
        ).json()) as { token: string };
        const scoped = (await (
            await call('POST', '/auth/create-access-token', godmode.token, {
                permissions: ['service:foo:ii:read'],
                expiresIn: '7d',
            })
        ).json()) as { token: string };
        expect(await actorOf(scoped.token)).toBeDefined();

        await env.server.services.auth.revokeSession(root.uuid);
        for (const token of [godmode.token, scoped.token]) {
            expect(
                (await env.server.services.auth.authenticate(token)).actor,
            ).toBeUndefined();
        }
    });

    it('is revoked on its own without ending the sign-in', async () => {
        const root = await signIn();
        const page = await mint(root.token);
        const pageUuid = (await actorOf(page))!.session!.uid;

        await env.server.services.auth.revokeSession(pageUuid);
        expect(
            (await env.server.services.auth.authenticate(page)).actor,
        ).toBeUndefined();
        expect(await actorOf(root.token)).toBeDefined();
    });

    it('keeps the whole current sign-in when revoking all others', async () => {
        const root = await signIn();
        const page = await mint(root.token);
        const other = await signIn();
        const otherPage = await mint(other.token);

        // Asked from the page: its sign-in stays, and so does the page.
        await env.server.services.auth.revokeAllSessions(
            (await actorOf(page))!,
        );
        expect(await actorOf(page)).toBeDefined();
        expect(await actorOf(root.token)).toBeDefined();
        expect(
            (await env.server.services.auth.authenticate(other.token)).actor,
        ).toBeUndefined();
        expect(
            (await env.server.services.auth.authenticate(otherPage)).actor,
        ).toBeUndefined();

        // Asked from the sign-in: the page under it stays too.
        await env.server.services.auth.revokeAllSessions(
            (await actorOf(root.token))!,
        );
        expect(await actorOf(page)).toBeDefined();
    });

    it('is not counted as a sign-in', async () => {
        const root = await signIn();
        const before = await env.server.stores.session.listSignIns(userId, {
            limit: 100,
        });
        await mint(root.token);
        const after = await env.server.stores.session.listSignIns(userId, {
            limit: 100,
        });
        expect(after.length).toBe(before.length);
    });
});
