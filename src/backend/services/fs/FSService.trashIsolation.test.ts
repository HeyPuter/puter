import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
    createTestUser,
    setupPuterTestEnv,
    type PuterTestEnv,
} from '../../testUtil.js';

describe('Trash move isolation', () => {
    let env: PuterTestEnv;

    beforeAll(async () => {
        env = await setupPuterTestEnv();
    }, 180_000);

    afterAll(async () => {
        await env?.shutdown();
    });

    const call = async (path: string, token: string, body?: unknown) => {
        const res = await fetch(new URL(path, env.apiOrigin), {
            method: body === undefined ? 'GET' : 'POST',
            headers: {
                authorization: `Bearer ${token}`,
                ...(body === undefined
                    ? {}
                    : { 'content-type': 'application/json' }),
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        const text = await res.text();
        let json: Record<string, unknown> | null = null;
        try {
            json = text ? (JSON.parse(text) as Record<string, unknown>) : null;
        } catch {}
        return { status: res.status, json, text };
    };

    const freshUser = async () =>
        createTestUser(env.server, {
            username: `fs03${Math.random().toString(36).slice(2, 9)}`,
            password: 'puter-test-user-password',
        });

    const launchApp = async (userToken: string) => {
        const origin = `https://fs03-${Math.random().toString(36).slice(2, 10)}.example.com`;
        const res = await call('/auth/get-user-app-token', userToken, {
            origin,
        });
        expect(res.status).toBe(200);
        return res.json as { token: string; app_uid: string };
    };

    const writeFile = (token: string, path: string, content: string) =>
        call('/fs/write', token, {
            fileMetadata: {
                path,
                size: Buffer.byteLength(content),
                contentType: 'text/plain',
            },
            fileContent: content,
            encoding: 'utf8',
        });

    it('preserves an existing Trash item when an app moves a colliding file', async () => {
        const user = await freshUser();
        const home = `/${user.username}`;

        const made = await writeFile(
            user.token,
            `${home}/Desktop/tax-return.pdf`,
            'private',
        );
        expect(made.status).toBe(200);
        const victimUid = (made.json!.fsEntry as { uid: string }).uid;
        const trashed = await call('/move', user.token, {
            source: victimUid,
            destination: `${home}/Trash`,
            new_name: victimUid,
            new_metadata: {
                original_name: 'tax-return.pdf',
                original_path: `${home}/Desktop/tax-return.pdf`,
                trashed_ts: 1,
            },
        });
        expect(trashed.status).toBe(200);

        const app = await launchApp(user.token);
        const root = await call('/auth/request-app-root-dir', app.token, {
            app_uid: app.app_uid,
        });
        expect(root.status).toBe(200);
        const appRoot = (root.json as { path: string }).path;

        const direct = await call('/delete', app.token, { uid: victimUid });
        expect(direct.status).not.toBe(200);
        const stillThere =
            await env.server.stores.fsEntry.getEntryByUuid(victimUid);
        expect(stillThere).not.toBeNull();

        const decoy = await writeFile(app.token, `${appRoot}/decoy.txt`, 'x');
        expect(decoy.status).toBe(200);
        const decoyUid = (decoy.json!.fsEntry as { uid: string }).uid;
        const move = await call('/fs/move', app.token, {
            source: { uid: decoyUid },
            destination: { path: `${home}/Trash` },
            new_name: victimUid,
            overwrite: true,
        });
        expect(move.status).toBe(200);

        const gone = await env.server.stores.fsEntry.getEntryByUuid(victimUid);
        expect(gone).not.toBeNull();
        const moved = await env.server.stores.fsEntry.getEntryByUuid(decoyUid);
        expect(moved?.name).not.toBe(victimUid);
    });
});
