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
import { setupPuterTestEnv, type PuterTestEnv } from '../../../testUtil.js';

const loadShed = () =>
    Object.assign(new Error('Database operation failed'), {
        code: 'dbBatchFailed',
    });

/**
 * A token whose lookup fails is not a dead token: clients discard a token on
 * 401 `token_auth_failed`, so that answer is kept for tokens that checked out
 * invalid.
 */
describe('auth probe when the token lookup fails', () => {
    let env: PuterTestEnv;

    beforeAll(async () => {
        env = await setupPuterTestEnv();
    }, 120_000);

    afterAll(async () => {
        await env?.shutdown();
    });

    const get = (path: string, token: string) =>
        fetch(new URL(path, env.apiOrigin), {
            headers: { authorization: `Bearer ${token}` },
        });

    /** Run `fn` while the next user lookup rejects with `error`. */
    const withFailedUserLookup = async <T>(
        error: Error,
        fn: () => Promise<T>,
    ): Promise<T> => {
        const spy = vi
            .spyOn(env.server.stores.user, 'getByUuid')
            .mockRejectedValueOnce(error);
        try {
            return await fn();
        } finally {
            spy.mockRestore();
        }
    };

    it.each([
        ['a session token', () => env.users.user.token],
        ['an access token', () => env.users.user.apiToken],
    ])(
        'answers %s with 503 db_unavailable during a database outage',
        async (_kind, tokenOf) => {
            const token = tokenOf();
            const res = await withFailedUserLookup(loadShed(), () =>
                get('/whoami', token),
            );
            expect(res.status).toBe(503);
            expect(res.headers.get('retry-after')).toBe('5');
            expect(await res.json()).toEqual({
                error: 'Service temporarily unavailable',
                message: 'Service temporarily unavailable',
                code: 'db_unavailable',
            });

            expect((await get('/whoami', token)).status).toBe(200);
        },
    );

    it('answers an unexpected lookup failure with a generic 500, not a 401', async () => {
        const res = await withFailedUserLookup(new Error('boom'), () =>
            get('/whoami', env.users.user.token),
        );
        expect(res.status).toBe(500);
        expect((await res.json()).code).toBe('internal_error');
    });

    it('serves a route that does not require auth anonymously', async () => {
        const res = await withFailedUserLookup(loadShed(), () =>
            get('/version', env.users.user.token),
        );
        expect(res.status).toBe(200);
    });

    it('still answers an invalid token with 401 token_auth_failed', async () => {
        const res = await get('/whoami', 'not-a-real-jwt');
        expect(res.status).toBe(401);
        expect(await res.json()).toEqual({
            error: 'Authentication failed',
            message: 'Authentication failed',
            code: 'token_auth_failed',
        });
    });
});
