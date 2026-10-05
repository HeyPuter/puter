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
import { isAccountContext } from '../../core/actor.js';
import type { AccessTokenPayload } from '../../services/auth/types.js';
import { setupPuterTestEnv, type PuterTestEnv } from '../../testUtil.js';

// Seeded with godmode on.
const DEV_CENTER = 'app-0b37f054-07d4-4627-8765-11bd23e889d4';
const TWELVE_HOURS = 12 * 60 * 60;

/**
 * A godmode app launched from the desktop runs on a full-access token of its
 * own: tied to the desktop session that asked for it, carrying the app for
 * attribution, and expiring unless the desktop asks again.
 */
describe('godmode app tokens', () => {
    let env: PuterTestEnv;
    let userId = 0;

    beforeAll(async () => {
        env = await setupPuterTestEnv();
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
    ) =>
        fetch(new URL(path, env.apiOrigin), {
            method,
            headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${token}`,
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });

    const mint = async (sessionToken: string, appUid = DEV_CENTER) => {
        const res = await call(
            'POST',
            '/auth/get-user-app-token',
            sessionToken,
            { app_uid: appUid },
        );
        expect(res.status).toBe(200);
        return (await res.json()) as {
            token: string | null;
            app_uid: string;
            godmode?: boolean;
            expires_at?: number;
        };
    };

    const decode = (token: string) =>
        env.server.services.token.verify<AccessTokenPayload>('auth', token);

    /** A desktop session of its own, so revoking it leaves the shared one up. */
    const newDesktopSession = async () => {
        const user = await env.server.stores.user.getById(userId);
        return env.server.services.auth.createSessionToken(user!);
    };

    /** An app row of its own, so demoting it disturbs nothing else. */
    const makeApp = async ({
        name = `gm-${crypto.randomUUID().slice(0, 8)}`,
        godmode = true,
    } = {}) => {
        const uid = `app-${crypto.randomUUID()}`;
        await env.server.clients.db.write(
            'INSERT INTO `apps` (`uid`, `owner_user_id`, `name`, `title`, `index_url`, `godmode`, `timestamp`) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)',
            [uid, userId, name, 'Test App', `https://${name}.test/`, godmode ? 1 : 0],
        );
        return { uid, name };
    };

    it('issues a full-access token that carries the app', async () => {
        const before = Math.floor(Date.now() / 1000);
        const body = await mint(env.users.user.token);

        expect(body).toMatchObject({ app_uid: DEV_CENTER, godmode: true });
        expect(body.expires_at).toBeGreaterThanOrEqual(before + TWELVE_HOURS);

        const claims = decode(body.token!);
        expect(claims).toMatchObject({
            type: 'access-token',
            full_access: true,
            godmode_app_uid: DEV_CENTER,
        });
        expect(claims.app_uid).toBeUndefined();

        const { actor } = await env.server.services.auth.authenticate(
            body.token!,
        );
        expect(actor).toBeDefined();
        expect(isAccountContext(actor!)).toBe(true);
        expect(actor!.effectiveApp).toBeNull();
        expect(actor!.accessToken).toMatchObject({
            fullAccess: true,
            godmodeApp: { uid: DEV_CENTER },
        });
    });

    it('reaches the account surface but not account management', async () => {
        const { token } = await mint(env.users.user.token);

        expect((await call('GET', '/whoami', token!)).status).toBe(200);
        expect((await call('GET', '/get-dev-profile', token!)).status).toBe(
            200,
        );
        expect((await call('GET', '/auth/list-sessions', token!)).status).toBe(
            403,
        );
        // It can't mint its own replacement; only the desktop can.
        const self = await call('POST', '/auth/get-user-app-token', token!, {
            app_uid: DEV_CENTER,
        });
        expect(self.status).toBe(403);
    });

    it('re-signs onto one row per desktop session, pushing its expiry out', async () => {
        const first = decode((await mint(env.users.user.token)).token!);
        const second = decode((await mint(env.users.user.token)).token!);

        expect(second.token_uid).toBe(first.token_uid);
        expect(second.session_uid).toBe(first.session_uid);

        const row = await env.server.stores.session.getByUuidAny(
            second.session_uid!,
        );
        expect(row).toMatchObject({
            kind: 'access_token',
            app_uid: DEV_CENTER,
        });
    });

    it('lists the token under its app for the account', async () => {
        await mint(env.users.user.token);
        const res = await call(
            'GET',
            '/auth/list-sessions',
            env.users.user.token,
        );
        const sessions = (await res.json()) as Array<{
            kind: string;
            app_uid: string | null;
            app: { name?: string } | null;
        }>;
        const row = sessions.find(
            (s) => s.kind === 'access_token' && s.app_uid === DEV_CENTER,
        );
        expect(row?.app?.name).toBe('dev-center');
    });

    it('dies with the desktop session that minted it', async () => {
        const desktop = await newDesktopSession();
        const { token } = await mint(desktop.gui_token);
        expect((await call('GET', '/whoami', token!)).status).toBe(200);

        await env.server.services.auth.revokeSession(
            desktop.session.uuid as string,
        );

        const res = await call('GET', '/whoami', token!);
        expect(res.status).toBe(401);
    });

    it('stops working once its app is no longer godmode', async () => {
        const app = await makeApp();
        const { token } = await mint(env.users.user.token, app.uid);
        expect((await call('GET', '/whoami', token!)).status).toBe(200);

        const row = await env.server.stores.app.getByUid(app.uid);
        await env.server.clients.db.write(
            'UPDATE `apps` SET `godmode` = 0 WHERE `uid` = ?',
            [app.uid],
        );
        await env.server.stores.app.invalidate(row);

        expect((await call('GET', '/whoami', token!)).status).toBe(401);
    });

    it('still gives an ordinary app an ordinary app token', async () => {
        const app = await makeApp({ godmode: false });
        const body = await mint(env.users.user.token, app.uid);
        expect(body.godmode).toBeUndefined();
        expect(decode(body.token!).type).toBe('app-under-user');
    });

    it('mints scoped tokens that are revoked along with it', async () => {
        const { token } = await mint(env.users.user.token);
        const child = await call(
            'POST',
            '/auth/create-access-token',
            token!,
            { permissions: ['service:foo:ii:read'], expiresIn: '1h' },
        );
        expect(child.status).toBe(200);
        const childToken = ((await child.json()) as { token: string }).token;
        expect(
            (await env.server.services.auth.authenticate(childToken)).actor,
        ).toBeDefined();

        const full = await call('POST', '/auth/create-access-token', token!, {
            permissions: ['full-api-access'],
        });
        expect(full.status).toBe(403);

        const { actor } = await env.server.services.auth.authenticate(
            env.users.user.token,
        );
        await env.server.services.auth.revokeAccessToken(actor!, token!);

        expect(
            (await env.server.services.auth.authenticate(childToken)).actor,
        ).toBeUndefined();
    });

    /** A read token minted the way `getReadURL()` does, by `minter`. */
    const mintScoped = async (minter: string) => {
        const res = await call('POST', '/auth/create-access-token', minter, {
            permissions: ['service:foo:ii:read'],
            expiresIn: '7d',
        });
        expect(res.status).toBe(200);
        return ((await res.json()) as { token: string }).token;
    };
    const live = async (token: string) =>
        (await env.server.services.auth.authenticate(token)).actor !== undefined;

    it('lets the tokens it minted lapse when it does', async () => {
        const { token } = await mint(env.users.user.token);
        const child = await mintScoped(token!);
        expect(await live(child)).toBe(true);

        // The desktop stopped renewing it: its row's expiry passes.
        const row = await env.server.stores.session.getByUuidAny(
            decode(token!).session_uid!,
        );
        await env.server.clients.db.write(
            'UPDATE `sessions` SET `expires_at` = ? WHERE `uuid` = ?',
            [Math.floor(Date.now() / 1000) - 1, row!.uuid],
        );
        await env.server.stores.session.publishCacheKeys({
            keys: [`sessions:v2:uuid:${row!.uuid}`],
        });

        expect(await live(child)).toBe(false);
        // The desktop asking again revives the row, and with it the child.
        await mint(env.users.user.token);
        expect(await live(child)).toBe(true);
    });

    it('lets the tokens it minted die with the desktop session', async () => {
        const desktop = await newDesktopSession();
        const { token } = await mint(desktop.gui_token);
        const child = await mintScoped(token!);
        expect(await live(child)).toBe(true);

        await env.server.services.auth.revokeSession(
            desktop.session.uuid as string,
        );

        expect(await live(token!)).toBe(false);
        expect(await live(child)).toBe(false);
    });

    it('reaches the AI wire routes, where a gate listener may waive the plan', async () => {
        const { token } = await mint(env.users.user.token);
        const route = '/puterai/openai/v1/chat/completions';
        const send = (bearer: string) =>
            fetch(new URL(route, env.apiOrigin), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${bearer}`,
                },
                body: JSON.stringify({
                    model: 'fake',
                    provider: 'fake-chat',
                    messages: [{ role: 'user', content: 'hi' }],
                    max_tokens: 16,
                }),
            });

        // Past the credential gates, stopped only by the plan.
        expect((await send(token!)).status).toBe(402);

        env.server.clients.event.on(
            'subscription.gate.route.post.puterai.openai.v1.chat.completions',
            (_key, event) => {
                const gate = event as {
                    actor: { accessToken?: { godmodeApp?: { uid: string } } };
                    allow: boolean;
                };
                if (gate.actor.accessToken?.godmodeApp?.uid === DEV_CENTER) {
                    gate.allow = true;
                }
            },
        );
        expect((await send(token!)).status).not.toBe(402);
        expect((await send(env.users.user.apiToken)).status).toBe(402);
    });
});
