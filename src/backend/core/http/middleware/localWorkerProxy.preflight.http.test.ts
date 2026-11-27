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

/**
 * A browser preflights any cross-origin call that carries a custom header, and
 * `puter.workers.exec()` always carries `puter-auth`. On the local worker
 * runtime that preflight has to reach the worker, which answers it as it does
 * on Cloudflare. Puter's own OPTIONS reply lists only the API's headers, so it
 * fails every `exec()` from a page.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Actor } from '../../actor.js';
import { runWithContext } from '../../context.js';
import { setupPuterTestEnv, type PuterTestEnv } from '../../../testUtil.js';

const PAGE_ORIGIN = 'http://localhost:5174';
const TEST_TIMEOUT_MS = 60_000;

describe('CORS preflight on the local worker runtime', () => {
    let env: PuterTestEnv;
    beforeAll(async () => {
        env = await setupPuterTestEnv({
            workers: { localServer: true },
        } as never);
    }, 120_000);
    afterAll(async () => {
        await env?.shutdown();
    });

    /** Deploys `source` the way puter.js does and returns the worker's URL. */
    const deploy = async (
        workerName: string,
        source: string,
    ): Promise<string> => {
        const server = env.server;
        const { username, token } = env.users.user;
        const user = (await server.stores.user.getByUsername(username))!;
        const actor: Actor = {
            user: { ...user, email_confirmed: true } as Actor['user'],
        };
        const filePath = `/${username}/${workerName}.js`;
        const content = Buffer.from(source);
        await runWithContext({ actor }, () =>
            server.services.fs.write(user.id, {
                fileMetadata: {
                    path: filePath,
                    size: content.length,
                    overwrite: true,
                },
                fileContent: content,
            }),
        );

        const res = await fetch(new URL('/drivers/call', env.apiOrigin), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
                interface: 'workers',
                driver: 'worker-service',
                method: 'create',
                args: { authorization: token, filePath, workerName },
            }),
        });
        const body = (await res.json()) as {
            result?: { success?: boolean; url?: string | null };
        };
        expect(res.status).toBe(200);
        expect(body.result?.success).toBe(true);
        return body.result!.url!;
    };

    /** The preflight a browser sends before `puter.workers.exec(url, POST)`. */
    const preflight = (url: string) =>
        fetch(url, {
            method: 'OPTIONS',
            headers: {
                Origin: PAGE_ORIGIN,
                'Access-Control-Request-Method': 'POST',
                'Access-Control-Request-Headers': 'content-type,puter-auth',
            },
        });

    it(
        'hands the preflight to a router worker, which allows puter-auth',
        async () => {
            const url = await deploy(
                'preflight-default',
                "router.post('/x', () => new Response('ok'));\n",
            );

            const res = await preflight(new URL('/x', url).href);

            expect(res.status).toBe(200);
            // The router echoes the requested headers back. Puter's own reply
            // would list the API's headers and answer with the body "OK".
            expect(res.headers.get('access-control-allow-headers')).toBe(
                'content-type,puter-auth',
            );
            expect(await res.text()).toBe('');
        },
        TEST_TIMEOUT_MS,
    );

    it('still answers a preflight to the API itself', async () => {
        const res = await preflight(
            new URL('/drivers/call', env.apiOrigin).href,
        );

        expect(res.status).toBe(200);
        expect(await res.text()).toBe('OK');
        const allowed = res.headers
            .get('access-control-allow-headers')!
            .split(',')
            .map((h) => h.trim().toLowerCase());
        expect(allowed).toContain('content-type');
        expect(allowed).toContain('authorization');
    });
});
