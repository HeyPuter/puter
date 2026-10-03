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

// Launch adopts whatever directory already sits at `AppData/<appUid>`, and an
// origin app's uid is derived from its origin, so another app knows where a
// not-yet-opened app's root will be.
describe('AppData roots over HTTP', () => {
    let env: PuterTestEnv;

    beforeAll(async () => {
        env = await setupPuterTestEnv();
    }, 120_000);

    afterAll(async () => {
        await env?.shutdown();
    });

    const call = (path: string, token: string, body?: unknown) =>
        fetch(new URL(path, env.apiOrigin), {
            method: body === undefined ? 'GET' : 'POST',
            headers: {
                authorization: `Bearer ${token}`,
                ...(body === undefined
                    ? {}
                    : { 'content-type': 'application/json' }),
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });

    const origin = (label: string) =>
        `https://${label}-${Math.random().toString(36).slice(2, 10)}.example.com`;

    const launch = async (userToken: string, appOrigin: string) => {
        const res = await call('/auth/get-user-app-token', userToken, {
            origin: appOrigin,
        });
        expect(res.status).toBe(200);
        return (await res.json()) as { token: string; app_uid: string };
    };

    const appRoot = async (app: { token: string; app_uid: string }) => {
        const res = await call('/auth/request-app-root-dir', app.token, {
            app_uid: app.app_uid,
        });
        expect(res.status).toBe(200);
        return (await res.json()) as { uid: string; path: string };
    };

    it('refuses an app renaming its root onto another app’s uid', async () => {
        const { username, token } = env.users.user;
        const a = await launch(token, origin('appdata-a'));
        const bOrigin = origin('appdata-b');
        const bUid = await env.server.services.auth.appUidFromOrigin(bOrigin);

        const root = await appRoot(a);
        // A uid-bound grant on its own root, which would follow the root.
        const sign = await call('/sign', a.token, {
            items: [{ uid: root.uid, action: 'write' }],
            app_uid: a.app_uid,
        });
        expect(sign.status).toBe(200);

        const rename = await call('/rename', a.token, {
            uid: root.uid,
            new_name: bUid,
        });
        expect(rename.status).toBe(403);
        const unmoved = await env.server.stores.fsEntry.getEntryByUuid(
            root.uid,
        );
        expect(unmoved?.path).toBe(`/${username}/AppData/${a.app_uid}`);

        // B gets a root of its own, out of A's reach.
        const b = await launch(token, bOrigin);
        expect(b.app_uid).toBe(bUid);
        const bRoot = await appRoot(b);
        expect(bRoot.uid).not.toBe(root.uid);

        const secret = `/${username}/AppData/${bUid}/secret.txt`;
        const write = await call('/fs/write', b.token, {
            fileMetadata: {
                path: secret,
                size: Buffer.byteLength('b-private'),
                contentType: 'text/plain',
            },
            fileContent: 'b-private',
            encoding: 'utf8',
        });
        expect(write.status).toBe(200);

        const read = await call(
            `/read?file=${encodeURIComponent(secret)}`,
            a.token,
        );
        expect(read.status).toBe(404);
    });

    it('refuses an app moving its root into the Trash', async () => {
        const { username, token } = env.users.user;
        const a = await launch(token, origin('appdata-trash'));
        const root = await appRoot(a);

        const move = await call('/move', a.token, {
            source: root.uid,
            destination: `/${username}/Trash`,
        });
        expect(move.status).toBe(403);
        const unmoved = await env.server.stores.fsEntry.getEntryByUuid(
            root.uid,
        );
        expect(unmoved?.path).toBe(`/${username}/AppData/${a.app_uid}`);
    });
});
