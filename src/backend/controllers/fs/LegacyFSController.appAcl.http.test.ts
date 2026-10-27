import { v4 as uuidv4 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeActor } from '../../core/actor.js';
import { setupPuterTestEnv, type PuterTestEnv } from '../../testUtil.js';

describe('/auth/check-app-acl', () => {
    let env: PuterTestEnv;
    beforeAll(async () => {
        env = await setupPuterTestEnv();
    }, 120_000);
    afterAll(async () => {
        await env?.shutdown();
    });

    const post = (path: string, body: unknown, token: string) =>
        fetch(new URL(path, env.apiOrigin), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(body),
        });

    const makeDirAndApp = async () => {
        const { username, token } = env.users.user;
        const server = env.server;
        const user = (await server.stores.user.getByUsername(username))!;
        const path = `/${username}/Documents/cacl-${uuidv4()}`;
        expect((await post('/fs/mkdir', { path }, token)).status).toBe(200);
        const entry = (await server.stores.fsEntry.getEntryByPath(path))!;

        const app = await (
            server.stores.app.create as unknown as (
                f: Record<string, unknown>,
                o: { ownerUserId: number },
            ) => Promise<{ uid: string; id: number }>
        )(
            {
                name: `cacl-${uuidv4()}`,
                title: 'Check app acl',
                index_url: `https://cacl-${uuidv4()}.test/`,
            },
            { ownerUserId: user.id },
        );
        return { user, path, entry, app };
    };

    it('allows a granted file without poisoning the app permission cache', async () => {
        const { token } = env.users.user;
        const server = env.server;
        const { user, path, entry, app } = await makeDirAndApp();

        const grant = await post(
            '/auth/grant-user-app',
            { app_uid: app.uid, permission: `fs:${entry.uuid}:read` },
            token,
        );
        expect(grant.status).toBe(200);

        const res = await post(
            '/auth/check-app-acl',
            { subject: { path }, app: app.uid, mode: 'read' },
            token,
        );
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ allowed: true });

        const asApp = makeActor({ user, app: { uid: app.uid, id: app.id } });
        const descriptor = () => server.services.acl.fsDescriptor(path);
        expect(
            await server.services.acl.check(asApp, descriptor(), 'read'),
        ).toBe(true);
    });

    it('denies an app with no grant', async () => {
        const { path, app } = await makeDirAndApp();
        const res = await post(
            '/auth/check-app-acl',
            { subject: { path }, app: app.uid, mode: 'read' },
            env.users.user.token,
        );
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ allowed: false });
    });

    it('refuses app and access tokens', async () => {
        const { token, apiToken } = env.users.user;
        const { path, entry, app } = await makeDirAndApp();
        const grant = await post(
            '/auth/grant-user-app',
            { app_uid: app.uid, permission: `fs:${entry.uuid}:read` },
            token,
        );
        expect(grant.status).toBe(200);

        const minted = await post(
            '/auth/get-user-app-token',
            { app_uid: app.uid },
            token,
        );
        expect(minted.status).toBe(200);
        const appToken = ((await minted.json()) as { token: string }).token;

        for (const credential of [appToken, apiToken]) {
            const res = await post(
                '/auth/check-app-acl',
                { subject: { path }, app: app.uid, mode: 'read' },
                credential,
            );
            expect(res.status).toBe(403);
        }
    });
});
