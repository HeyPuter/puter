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

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
    setupPuterTestEnv,
    TEST_USER_CREDENTIALS,
    type PuterTestEnv,
} from '../../testUtil.js';

/** A PUT body is the file, whatever content type the client labels it with. */
describe('PUT stores the body as sent', () => {
    let env: PuterTestEnv;

    beforeAll(async () => {
        env = await setupPuterTestEnv();
    }, 60_000);

    afterAll(async () => {
        await env?.shutdown();
    });

    const dav = (path: string, init: RequestInit) => {
        const port = new URL(env.apiOrigin).port;
        const auth = Buffer.from(
            `${TEST_USER_CREDENTIALS.username}:${TEST_USER_CREDENTIALS.password}`,
        ).toString('base64');
        return fetch(`http://dav.puter.localhost:${port}${encodeURI(path)}`, {
            ...init,
            headers: { Authorization: `Basic ${auth}`, ...init.headers },
        });
    };

    it.each([
        ['application/json', '{"name":"report","rows":[1,2,3]}'],
        // Not JSON at all: the label alone must not get the body rejected.
        ['application/json', 'not json'],
        ['text/plain;actually=json', '{"a":1}'],
        ['application/x-www-form-urlencoded', 'a=1&b=two'],
        ['application/octet-stream', 'plain bytes'],
    ])(
        'with Content-Type %s',
        async (contentType, content) => {
            const path = `/${env.users.user.username}/Documents/put-${randomUUID().slice(0, 8)}.bin`;
            const put = await dav(path, {
                method: 'PUT',
                headers: { 'Content-Type': contentType },
                body: content,
            });
            expect(put.status).toBe(201);

            const get = await dav(path, { method: 'GET' });
            expect(get.status).toBe(200);
            expect(await get.text()).toBe(content);
        },
        30_000,
    );

    it('with a form body over the form parser limit', async () => {
        const path = `/${env.users.user.username}/Documents/put-${randomUUID().slice(0, 8)}.bin`;
        const content = `a=${'x'.repeat(200 * 1024)}`;
        const put = await dav(path, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: content,
        });
        expect(put.status).toBe(201);

        const get = await dav(path, { method: 'GET' });
        expect(await get.text()).toBe(content);
    }, 30_000);
});
