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

import type { Request, RequestHandler, Response } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { extensionStore } from '../../../extensions.js';
import { setupPuterTestEnv, type PuterTestEnv } from '../../../testUtil.js';
import type { IConfig } from '../../../types';

/**
 * The route option over real HTTP. The unit tests cover the decision; this
 * covers the wiring — that a declaration reaches the middleware chain, that it
 * drags an auth gate in behind it, and that a tier the config doesn't define
 * leaves the route as open as it was.
 *
 * No route in the tree declares a tier, so the surface under test is an
 * extension route registered here, which runs through the same materializer as
 * every controller route.
 */
describe('requireReputation over HTTP', () => {
    let env: PuterTestEnv;

    const ok = ((_req: Request, res: Response) =>
        res.json({ ok: true })) as unknown as RequestHandler;

    beforeAll(async () => {
        extensionStore.routeHandlers.push(
            {
                method: 'get',
                path: '/test-reputation-gated',
                options: { subdomain: '*', requireReputation: 'standard' },
                handler: ok,
            },
            {
                method: 'get',
                path: '/test-reputation-undefined-tier',
                options: { subdomain: '*', requireReputation: 'unheard-of' },
                handler: ok,
            },
        );
        env = await setupPuterTestEnv({
            reputationGate: { tiers: { standard: 60 } },
        } as unknown as IConfig);
    }, 120_000);

    afterAll(async () => {
        extensionStore.routeHandlers.length = 0;
        await env?.shutdown();
    });

    const get = (path: string, token?: string) =>
        fetch(new URL(path, env.apiOrigin), {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
        });

    const setReputation = async (username: string, reputation: number) => {
        const user = await env.server.stores.user.getByUsername(username);
        await env.server.stores.user.update(user!.id!, { reputation });
    };

    it('requires auth on the strength of the declaration alone', async () => {
        const res = await get('/test-reputation-gated');
        expect(res.status).toBe(401);
    });

    it('admits an account that clears the tier', async () => {
        await setReputation(env.users.user.username, 75);
        const res = await get('/test-reputation-gated', env.users.user.token);
        expect(res.status).toBe(200);
    });

    it('turns away an account that does not', async () => {
        await setReputation(env.users.other.username, 20);
        const res = await get('/test-reputation-gated', env.users.other.token);
        expect(res.status).toBe(403);
        expect(await res.json()).toMatchObject({
            code: 'reputation_required',
        });
    });

    it('leaves a tier this deployment never defined wide open', async () => {
        const res = await get(
            '/test-reputation-undefined-tier',
            env.users.other.token,
        );
        expect(res.status).toBe(200);
    });
});
