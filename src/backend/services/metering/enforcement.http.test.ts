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
import type { Actor } from '../../core/actor';
import { setupPuterTestEnv, type PuterTestEnv } from '../../testUtil.js';

/**
 * What an account that has spent its whole allowance can and cannot still do,
 * over real HTTP.
 *
 * The unit tests cover the decision; this covers the wiring — that the route
 * option reaches the middleware chain, that the routes which opt out really are
 * still reachable, and that a hosted site keeps serving for an owner who is out
 * of budget.
 */
describe('metering enforcement over HTTP', () => {
    let env: PuterTestEnv;

    beforeAll(async () => {
        env = await setupPuterTestEnv();
    }, 120_000);

    afterAll(async () => {
        await env?.shutdown();
    });

    const actorFor = async (username: string): Promise<Actor> => {
        const user = await env.server.stores.user.getByUsername(username);
        return { user: user! } as Actor;
    };

    /** Spend the account's whole monthly allowance. */
    const exhaust = async (actor: Actor): Promise<void> => {
        const metering = env.server.services.metering;
        const sub = await metering.getActorSubscription(actor);
        await metering.incrementUsage(
            actor,
            'egress:bytes',
            1,
            sub.monthUsageAllowance,
        );
        expect(await metering.hasAnyUsageCached(actor)).toBe(false);
    };

    const writeFile = async (actor: Actor, path: string, body: Buffer) => {
        await env.server.services.fs.write(actor.user.id!, {
            fileMetadata: {
                path,
                size: body.byteLength,
                contentType: 'text/plain',
            },
            fileContent: body,
        });
    };

    const driverCall = (
        token: string,
        method: string,
        args: Record<string, unknown>,
    ) =>
        fetch(new URL('/drivers/call', env.apiOrigin), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
                interface: 'puter-kvstore',
                method,
                args,
            }),
        });

    it('refuses a file read and admits the routes that do not spend', async () => {
        const { username, token } = env.users.other;
        const actor = await actorFor(username);
        const path = `/${username}/Desktop/enforcement.txt`;
        await writeFile(actor, path, Buffer.from('contents'));

        const readUrl = new URL('/fs/read', env.apiOrigin);
        readUrl.searchParams.set('path', path);
        const auth = { Authorization: `Bearer ${token}` };

        const before = await fetch(readUrl, { headers: auth });
        expect(before.status).toBe(200);

        await exhaust(actor);

        const read = await fetch(readUrl, { headers: auth });
        expect(read.status).toBe(402);
        expect(await read.json()).toMatchObject({ code: 'insufficient_funds' });

        // Looking at the account's own files is not spending, and neither is
        // getting rid of them — an account with no budget left still has to be
        // able to see what it has and clear it.
        const statUrl = new URL('/fs/stat', env.apiOrigin);
        const stat = await fetch(statUrl, {
            method: 'POST',
            headers: { ...auth, 'Content-Type': 'application/json' },
            body: JSON.stringify({ path }),
        });
        expect(stat.status).toBe(200);

        const readdirUrl = new URL('/fs/readdir', env.apiOrigin);
        readdirUrl.searchParams.set('path', `/${username}/Desktop`);
        const readdir = await fetch(readdirUrl, { headers: auth });
        expect(readdir.status).toBe(200);

        const remove = await fetch(new URL('/fs/delete', env.apiOrigin), {
            method: 'POST',
            headers: { ...auth, 'Content-Type': 'application/json' },
            body: JSON.stringify({ path }),
        });
        expect(remove.status).toBe(200);
    });

    it('refuses a KV read but not a KV delete, and never a worker session', async () => {
        const { username, token, workerToken } = env.users.admin;
        const actor = await actorFor(username);

        expect(
            (await driverCall(token, 'set', { key: 'k', value: 'v' })).status,
        ).toBe(200);

        await exhaust(actor);

        const get = await driverCall(token, 'get', { key: 'k' });
        expect(get.status).toBe(402);
        expect(await get.json()).toMatchObject({ code: 'insufficient_funds' });

        // Naming what is stored is how the account decides what to delete, so
        // the keys-only form of `list` stays open while the forms that hand
        // back the values do not.
        const keys = await driverCall(token, 'list', { as: 'keys' });
        expect(keys.status).toBe(200);
        expect((await keys.json()).result).toContain('k');
        expect((await driverCall(token, 'list', {})).status).toBe(402);
        expect((await driverCall(token, 'list', { as: 'values' })).status).toBe(
            402,
        );

        expect((await driverCall(token, 'del', { key: 'k' })).status).toBe(200);

        // Same account, worker credential: a deployed program keeps running.
        const workerGet = await driverCall(workerToken, 'get', { key: 'k' });
        expect(workerGet.status).toBe(200);
        expect((await workerGet.json()).success).toBe(true);
    });

    it('refuses a token-read, which authenticates itself past the gate chain', async () => {
        const { username } = env.users.user;
        const actor = await actorFor(username);
        const path = `/${username}/Desktop/token-read.txt`;
        await writeFile(actor, path, Buffer.from('contents'));
        const entry = (await env.server.stores.fsEntry.getEntryByPath(path))!;

        const accessToken = await env.server.services.auth.createAccessToken(
            actor as never,
            [[`fs:${entry.uuid}:read`]],
            { label: 'enforcement-token-read' },
        );

        const url = new URL('/token-read', env.apiOrigin);
        url.searchParams.set('uid', entry.uuid);
        url.searchParams.set('token', accessToken);

        expect((await fetch(url)).status).toBe(200);

        await exhaust(actor);

        const after = await fetch(url);
        expect(after.status).toBe(402);
        expect(await after.json()).toMatchObject({
            code: 'insufficient_funds',
        });
    });

    it('keeps serving a hosted site whose owner is out of budget', async () => {
        const { username } = env.users.user;
        const actor = await actorFor(username);
        const home = await env.server.stores.fsEntry.getEntryByPath(
            `/${username}`,
        );
        const subdomain = `enforcement-${Math.random().toString(36).slice(2, 8)}`;
        await env.server.stores.subdomain.create({
            userId: actor.user.id!,
            subdomain,
            rootDirId: home!.id,
        });
        await writeFile(
            actor,
            `/${username}/index.html`,
            Buffer.from('<html>hosted</html>'),
        );

        await exhaust(actor);

        const port = new URL(env.origin).port;
        const site = await fetch(
            `http://${subdomain}.site.puter.localhost:${port}/index.html`,
        );
        // Visitors have no say in the owner's balance, so hosting is metered
        // and never gated.
        expect(site.status).toBe(200);
        expect(await site.text()).toContain('hosted');
    });
});
