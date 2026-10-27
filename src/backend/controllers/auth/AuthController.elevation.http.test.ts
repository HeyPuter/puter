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
import { setupPuterTestEnv, type PuterTestEnv } from '../../testUtil.js';

describe('auth elevation cookies over HTTP', () => {
    let env: PuterTestEnv;

    beforeAll(async () => {
        env = await setupPuterTestEnv();
    }, 120_000);

    afterAll(async () => {
        await env?.shutdown();
    });

    it.each(['bearer', 'cookie'])(
        'API host returns a usable token without setting cookies (%s auth)',
        async (credential) => {
            const { token, password, username } = env.users.user;
            const res = await fetch(new URL('/auth/elevate', env.apiOrigin), {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    ...(credential === 'cookie'
                        ? { cookie: `puter_auth_token=${token}` }
                        : { authorization: `Bearer ${token}` }),
                },
                body: JSON.stringify({ password }),
            });
            expect(res.status).toBe(200);
            expect(res.headers.get('set-cookie')).toBeNull();
            const body = (await res.json()) as {
                elevated: boolean;
                token: string;
            };
            expect(body.elevated).toBe(true);
            expect(typeof body.token).toBe('string');
            const user = await env.server.stores.user.getByUsername(username);
            const { verifyStepUpSession } =
                await import('../../core/http/middleware/stepUpSession.js');
            expect(
                verifyStepUpSession(
                    {
                        headers: { 'x-puter-elevation': body.token },
                        actor: { user: { uuid: user!.uuid } },
                    } as never,
                    { tokenService: env.server.services.token },
                ),
            ).toBe(true);
        },
    );

    it('GUI host sets the elevation cookie and omits the raw token for cookie auth', async () => {
        const { token, password } = env.users.user;
        const res = await fetch(new URL('/auth/elevate', env.origin), {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                cookie: `puter_auth_token=${token}`,
            },
            body: JSON.stringify({ password }),
        });
        expect(res.status).toBe(200);
        expect(res.headers.get('set-cookie')).toContain('puter_elevated=');
        expect(await res.json()).toEqual({ elevated: true });
    });
});
