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
import { makeActor } from '../../actor.js';
import { runWithContext } from '../../context.js';
import { setupPuterTestEnv, type PuterTestEnv } from '../../../testUtil.js';

/**
 * Which routes the account's own API token reaches. A privileged app runs on
 * one instead of the GUI session token, so the routes it needs must admit it
 * while account and security management keeps refusing it.
 */
describe('full-access token route admissions', () => {
    let env: PuterTestEnv;
    let pat = '';
    let scoped = '';

    beforeAll(async () => {
        env = await setupPuterTestEnv();
        pat = env.users.user.apiToken;
        const row = await env.server.stores.user.getByUsername(
            env.users.user.username,
        );
        const actor = makeActor({ user: row! });
        scoped = await runWithContext({ actor }, () =>
            env.server.services.auth.createAccessToken(actor, [
                ['service:foo:ii:read'],
            ]),
        );
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

    const ADMITTED: Array<[string, string, unknown?]> = [
        ['GET', '/get-dev-profile'],
        ['GET', '/auth/list-permissions'],
        ['GET', '/share/shared-by-me/apps'],
        ['GET', '/share/audit'],
        ['POST', '/profile', { bio: 'set by a personal access token' }],
    ];

    it.each(ADMITTED)(
        'admits a full-access token on %s %s',
        async (method, path, body) => {
            const res = await call(method, path, pat, body);
            expect(res.status, `${method} ${path}`).toBe(200);
        },
    );

    it.each(ADMITTED)(
        'still refuses a scoped token on %s %s',
        async (method, path, body) => {
            const res = await call(method, path, scoped, body);
            expect(res.status, `${method} ${path}`).toBe(403);
        },
    );

    // Account and security management: a leaked token must not reach these.
    const REFUSED: Array<[string, string, unknown?]> = [
        ['GET', '/share/blocks'],
        ['POST', '/share/blocks', { all: true }],
        ['DELETE', '/share/blocks', { all: true }],
        ['GET', '/app-feedback/target?app=dev-center'],
        ['POST', '/app-feedback', { app: 'dev-center', message: 'hi' }],
        ['GET', '/auth/list-sessions'],
        ['POST', '/auth/revoke-all-sessions'],
        ['POST', '/auth/get-user-app-token', { origin: 'https://probe.test' }],
        ['POST', '/auth/grant-user-app', { app_uid: 'app-x', permission: 'p' }],
    ];

    it.each(REFUSED)(
        'refuses a full-access token on %s %s',
        async (method, path, body) => {
            const res = await call(method, path, pat, body);
            expect(res.status, `${method} ${path}`).toBe(403);
            expect(await res.json()).toMatchObject({ code: 'forbidden' });
        },
    );

    // Root-origin only, so it needs the other base URL.
    it('refuses a full-access token on GET /get-gui-token', async () => {
        const res = await fetch(new URL('/get-gui-token', env.origin), {
            headers: { authorization: `Bearer ${pat}` },
        });
        expect(res.status).toBe(403);
    });

    it('reports the open an app launched on a full-access token', async () => {
        const res = await call('POST', '/rao', pat, {
            app_uid: 'app-0b37f054-07d4-4627-8765-11bd23e889d4',
        });
        expect(res.status).toBe(200);
    });

    it('keeps /rao closed to a scoped token', async () => {
        const res = await call('POST', '/rao', scoped, {
            app_uid: 'app-0b37f054-07d4-4627-8765-11bd23e889d4',
        });
        expect(res.status).toBe(403);
    });
});
