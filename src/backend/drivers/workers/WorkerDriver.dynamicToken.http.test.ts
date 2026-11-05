import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Actor } from '../../core/actor.js';
import { runWithContext } from '../../core/context.js';
import { INTERNAL_DEPLOY_TARGET, type WorkerDriver } from './WorkerDriver.js';
import { setupPuterTestEnv, type PuterTestEnv } from '../../testUtil.js';

describe('dynamic worker token over HTTP', () => {
    let env: PuterTestEnv;
    beforeAll(async () => {
        env = await setupPuterTestEnv({
            workers: { localServer: true },
        } as never);
    }, 120_000);
    afterAll(async () => {
        await env?.shutdown();
    });

    const call = (token: string) =>
        fetch(new URL('/drivers/call', env.apiOrigin), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
                interface: 'puter-kvstore',
                method: 'set',
                args: { key: 'visits', value: 1 },
            }),
        });
    const whoami = (token: string) =>
        fetch(new URL('/whoami', env.apiOrigin), {
            headers: { Authorization: `Bearer ${token}` },
        });

    it('authenticates a site-bound worker and retires it when the site is deleted', async () => {
        const server = env.server;
        const { username } = env.users.user;
        const user = (await server.stores.user.getByUsername(username))!;
        const actor: Actor = {
            user: { ...user, email_confirmed: true } as Actor['user'],
        };

        const origin = 'https://verifysite.puter.site';
        const appUid = await server.services.auth.appUidFromOrigin(origin);
        await server.stores.app.createFromOrigin(appUid, origin, {
            ownerUserId: user.id,
        });
        const site = await server.stores.subdomain.create({
            userId: user.id,
            subdomain: 'verifysite',
        });
        const path = `/${username}/api.worker.js`;
        // Valid JS: where workerd is installed, the deploy really starts it.
        const source = Buffer.from('// noop\n');
        await runWithContext({ actor }, () =>
            server.services.fs.write(user.id, {
                fileMetadata: { path, size: source.length, overwrite: true },
                fileContent: source,
            }),
        );

        const spy = vi.spyOn(server.services.auth, 'createWorkerAppToken');
        const scriptName = 'b'.repeat(48);
        try {
            await runWithContext({ actor }, () =>
                (server.drivers.workers as unknown as WorkerDriver).create({
                    appId: appUid,
                    workerName: scriptName,
                    filePath: path,
                    [INTERNAL_DEPLOY_TARGET]: {
                        scriptName,
                        siteUid: site.uuid,
                        siteSubdomain: site.subdomain,
                        namespace: 'dynamic',
                        tags: ['t'],
                    },
                } as never),
            );
        } catch (e) {
            // No preamble built here; the token is minted before deploy.
            if ((e as { statusCode?: number }).statusCode !== 503) throw e;
        }
        const token = (await spy.mock.results.at(-1)!.value) as string;
        spy.mockRestore();

        const claims = JSON.parse(
            Buffer.from(token.split('.')[1], 'base64url').toString(),
        );
        expect(claims.worker).toBe(true);
        expect(claims.worker_name).toBe(scriptName);
        expect(claims.worker_uid).toBeUndefined();

        expect(claims.workerSiteUid).toBe(site.uuid);
        expect(claims.workerSite).toBe(site.subdomain);
        expect((await whoami(token)).status).toBe(200);
        expect((await call(token)).status).toBe(200);
        await server.stores.subdomain.deleteByUuid(site.uuid);
        expect((await whoami(token)).status).toBe(401);
        expect((await call(token)).status).toBe(401);
    });
});
