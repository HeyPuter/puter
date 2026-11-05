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
import {
    createTestUser,
    setupPuterTestEnv,
    type PuterTestEnv,
} from '../../testUtil.js';

// A scoped access token writes through the `/fs` routes wherever its grant
// reaches — the reach it already has over WebDAV — and nowhere else. The ACL
// each handler runs intersects the token's grant with its issuer's, so these
// check both edges of that, plus the routes that stay closed to tokens.
describe('scoped access tokens on the /fs write routes', () => {
    let env: PuterTestEnv;

    beforeAll(async () => {
        env = await setupPuterTestEnv();
    }, 180_000);

    afterAll(async () => {
        await env?.shutdown();
    });

    const post = async (route: string, token: string, body: unknown) => {
        const res = await fetch(new URL(route, env.apiOrigin), {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(body),
        });
        const text = await res.text();
        let json: Record<string, unknown> | null = null;
        try {
            json = text ? (JSON.parse(text) as Record<string, unknown>) : null;
        } catch {
            // Some refusals are plain text.
        }
        return { status: res.status, json, text };
    };

    /** A user, a token granted `mode` on their Documents, and some fixtures. */
    const setup = async (mode: 'read' | 'write') => {
        const user = await createTestUser(env.server, {
            username: `stw${Math.random().toString(36).slice(2, 9)}`,
            password: 'puter-test-user-password',
        });
        const home = `/${user.username}`;
        const documents = await post('/stat', user.token, {
            path: `${home}/Documents`,
        });
        await post('/touch', user.token, { path: `${home}/Desktop/kept.txt` });
        await post('/touch', user.token, { path: `${home}/Documents/in.txt` });
        const minted = await post('/auth/create-access-token', user.token, {
            permissions: [`fs:${documents.json!.uid}:${mode}`],
        });
        expect(minted.status).toBe(200);
        return {
            user,
            home,
            token: minted.json!.token as string,
            exists: async (path: string) =>
                (await post('/stat', user.token, { path })).status === 200,
        };
    };

    it('writes inside its grant on the legacy routes', async () => {
        const { home, token, exists } = await setup('write');
        const docs = `${home}/Documents`;

        expect(
            (await post('/mkdir', token, { path: `${docs}/d` })).status,
        ).toBe(200);
        expect(
            (await post('/touch', token, { path: `${docs}/d/t.txt` })).status,
        ).toBe(200);
        const t = await post('/stat', token, { path: `${docs}/d/t.txt` });
        expect(
            (
                await post('/rename', token, {
                    uid: t.json!.uid,
                    new_name: 'r.txt',
                })
            ).status,
        ).toBe(200);
        expect(
            (
                await post('/copy', token, {
                    source: `${docs}/d/r.txt`,
                    destination: docs,
                })
            ).status,
        ).toBe(200);
        expect(
            (
                await post('/move', token, {
                    source: `${docs}/r.txt`,
                    destination: `${docs}/d`,
                    new_name: 'm.txt',
                })
            ).status,
        ).toBe(200);
        expect(
            (await post('/delete', token, { paths: [`${docs}/d/m.txt`] }))
                .status,
        ).toBe(200);
        const batch = await post('/batch', token, {
            operations: [
                { op: 'mkdir', path: `${docs}/b` },
                { op: 'delete', path: `${docs}/d/r.txt` },
            ],
        });
        expect(batch.status, batch.text).toBe(200);

        expect(await exists(`${docs}/b`)).toBe(true);
        expect(await exists(`${docs}/d/r.txt`)).toBe(false);
        expect(await exists(`${docs}/d/m.txt`)).toBe(false);
    }, 180_000);

    it('writes inside its grant on the v2 routes', async () => {
        const { home, token, exists } = await setup('write');
        const docs = `${home}/Documents`;

        expect(
            (await post('/fs/mkdir', token, { path: `${docs}/v` })).status,
        ).toBe(200);
        expect(
            (await post('/fs/touch', token, { path: `${docs}/v/t.txt` }))
                .status,
        ).toBe(200);
        const written = await post('/fs/write', token, {
            fileMetadata: {
                path: `${docs}/v/w.txt`,
                size: 3,
                contentType: 'text/plain',
            },
            fileContent: 'abc',
        });
        expect(written.status, written.text).toBe(200);
        expect(
            (
                await post('/fs/rename', token, {
                    path: `${docs}/v/t.txt`,
                    new_name: 'r.txt',
                })
            ).status,
        ).toBe(200);
        expect(
            (
                await post('/fs/copy', token, {
                    source: `${docs}/v/r.txt`,
                    destination: docs,
                })
            ).status,
        ).toBe(200);
        expect(
            (
                await post('/fs/move', token, {
                    source: `${docs}/r.txt`,
                    destination: `${docs}/v`,
                    new_name: 'm.txt',
                })
            ).status,
        ).toBe(200);
        expect(
            (
                await post('/fs/mkshortcut', token, {
                    parent: docs,
                    target: `${docs}/v/w.txt`,
                    name: 'w-link',
                })
            ).status,
        ).toBe(200);
        expect(
            (await post('/fs/delete', token, { path: `${docs}/v/m.txt` }))
                .status,
        ).toBe(200);
        const started = await post('/fs/startWrite', token, {
            fileMetadata: { path: `${docs}/v/up.bin`, size: 4 },
        });
        expect(started.status, started.text).toBe(200);
        expect(
            (
                await post('/fs/abortWrite', token, {
                    uploadId: started.json!.sessionId,
                })
            ).status,
        ).toBe(200);

        expect(await exists(`${docs}/v/w.txt`)).toBe(true);
        expect(await exists(`${docs}/w-link`)).toBe(true);
        expect(await exists(`${docs}/v/m.txt`)).toBe(false);
    }, 180_000);

    it('is refused everywhere outside its grant', async () => {
        const { home, token, exists } = await setup('write');
        const docs = `${home}/Documents`;
        const desktop = `${home}/Desktop`;

        const attempts = [
            ['/mkdir', { path: `${desktop}/x` }],
            ['/touch', { path: `${desktop}/x.txt` }],
            ['/move', { source: `${docs}/in.txt`, destination: desktop }],
            ['/copy', { source: `${desktop}/kept.txt`, destination: docs }],
            ['/delete', { paths: [`${desktop}/kept.txt`] }],
            ['/delete', { paths: [home] }],
            ['/fs/mkdir', { path: `${desktop}/x` }],
            [
                '/fs/write',
                {
                    fileMetadata: {
                        path: `${desktop}/kept.txt`,
                        size: 1,
                        overwrite: true,
                    },
                    fileContent: 'x',
                },
            ],
            ['/fs/move', { source: `${docs}/in.txt`, destination: desktop }],
            ['/fs/copy', { source: `${desktop}/kept.txt`, destination: docs }],
            ['/fs/rename', { path: `${desktop}/kept.txt`, new_name: 'y.txt' }],
            ['/fs/delete', { path: `${desktop}/kept.txt` }],
            ['/fs/delete', { path: home }],
        ] as const;
        for (const [route, body] of attempts) {
            const res = await post(route, token, body);
            expect(
                [403, 404],
                `${route} ${JSON.stringify(body)} → ${res.status}`,
            ).toContain(res.status);
        }

        const batch = await post('/batch', token, {
            operations: [{ op: 'mkdir', path: `${desktop}/b` }],
        });
        expect(batch.status).not.toBe(200);

        expect(await exists(`${desktop}/kept.txt`)).toBe(true);
        expect(await exists(`${desktop}/x`)).toBe(false);
        expect(await exists(`${desktop}/b`)).toBe(false);
        expect(await exists(`${docs}/in.txt`)).toBe(true);
        expect(await exists(`${docs}/kept.txt`)).toBe(false);
    }, 180_000);

    it('refuses every write to a read-only token', async () => {
        const { home, token, exists } = await setup('read');
        const docs = `${home}/Documents`;

        const attempts = [
            ['/mkdir', { path: `${docs}/x` }],
            ['/touch', { path: `${docs}/x.txt` }],
            ['/delete', { paths: [`${docs}/in.txt`] }],
            ['/fs/mkdir', { path: `${docs}/x` }],
            [
                '/fs/write',
                {
                    fileMetadata: { path: `${docs}/x.txt`, size: 1 },
                    fileContent: 'x',
                },
            ],
            [
                '/fs/startWrite',
                { fileMetadata: { path: `${docs}/x.bin`, size: 1 } },
            ],
            ['/fs/rename', { path: `${docs}/in.txt`, new_name: 'y.txt' }],
            ['/fs/delete', { path: `${docs}/in.txt` }],
        ] as const;
        for (const [route, body] of attempts) {
            const res = await post(route, token, body);
            expect(res.status, `${route} → ${res.status}`).toBe(403);
        }
        expect(await exists(`${docs}/in.txt`)).toBe(true);
        expect(await exists(`${docs}/x`)).toBe(false);
    }, 180_000);

    // An upload session belongs to the account, not to the credential that
    // opened it, so each later step re-checks the target against the caller.
    it('cannot touch an upload the session opened outside its grant', async () => {
        const { user, home, token } = await setup('write');
        const started = await post('/fs/startWrite', user.token, {
            fileMetadata: { path: `${home}/Desktop/up.bin`, size: 4 },
        });
        expect(started.status).toBe(200);
        const uploadId = started.json!.sessionId as string;

        for (const [route, body] of [
            ['/fs/abortWrite', { uploadId }],
            ['/fs/completeWrite', { uploadId }],
            ['/fs/signMultipartParts', { uploadId, partNumbers: [1] }],
        ] as const) {
            const res = await post(route, token, body);
            expect(
                [403, 404],
                `${route} → ${res.status} ${res.text}`,
            ).toContain(res.status);
        }

        // Still open: the session's own abort finds it to abort.
        const sessions = await env.server.services.fs.getUploadSessions(
            (await env.server.stores.user.getByUsername(user.username))!.id,
            [uploadId],
        );
        expect(sessions[0]?.status).not.toBe('aborted');
        expect(
            (await post('/fs/abortWrite', user.token, { uploadId })).status,
        ).toBe(200);
    }, 180_000);

    it('aborting an unknown upload stays a no-op', async () => {
        const { token } = await setup('write');
        const res = await post('/fs/abortWrite', token, {
            uploadId: 'no-such-upload',
        });
        expect(res.status).toBe(200);
    }, 180_000);

    it('keeps the routes that reach past one entry closed', async () => {
        const { home, token } = await setup('write');
        const docs = `${home}/Documents`;

        for (const [route, body] of [
            ['/sign', { items: [{ path: `${docs}/in.txt`, action: 'read' }] }],
            ['/search', { text: 'in' }],
            ['/fs/search', { query: 'in' }],
            ['/df', {}],
            ['/readdir-subdomains', {}],
        ] as const) {
            const res = await post(route, token, body);
            expect(res.status, `${route} → ${res.status}`).toBe(403);
            expect(res.json?.message ?? res.text).toMatch(
                /Access tokens are not allowed/,
            );
        }
    }, 180_000);
});
