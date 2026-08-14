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

/**
 * Route-level coverage for the sharing endpoints. The service unit tests drive
 * the semantics; this suite exists to catch a route that was never registered,
 * a gate that rejects a legitimate request, and anything the response shape
 * leaks.
 */
describe('share endpoints over HTTP', () => {
    let env: PuterTestEnv;

    beforeAll(async () => {
        env = await setupPuterTestEnv();
    }, 120_000);

    afterAll(async () => {
        await env?.shutdown();
    });

    const post = (path: string, token: string, body: unknown) =>
        fetch(new URL(path, env.apiOrigin), {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(body),
        });

    const get = (path: string, token: string, params: Record<string, string>) => {
        const url = new URL(path, env.apiOrigin);
        for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
        return fetch(url, { headers: { authorization: `Bearer ${token}` } });
    };

    /** A file in the owner's home. Written directly — these tests are about
     *  the share routes, not the upload path. */
    const makeFile = async (owner: { username: string }) => {
        const uid = crypto.randomUUID();
        const name = `share-http-${uid.slice(0, 8)}.txt`;
        const path = `/${owner.username}/${name}`;
        const user = await env.server.stores.user.getByUsername(owner.username);
        await env.server.clients.db.write(
            'INSERT INTO `fsentries` (`uuid`, `name`, `path`, `user_id`, `is_dir`, `modified`) VALUES (?, ?, ?, ?, 0, ?)',
            [uid, name, path, user!.id, Math.floor(Date.now() / 1000)],
        );
        return { uid, path };
    };

    it('shares an item, lists it for the recipient, then revokes it', async () => {
        const owner = env.users.user;
        const recipient = env.users.other;
        const file = await makeFile(owner);

        const shareRes = await post('/share', owner.token, {
            recipients: [recipient.username],
            items: [{ uid: file.uid }],
            mode: 'read',
        });
        expect(shareRes.status).toBe(200);
        const shareBody = (await shareRes.json()) as {
            status: string;
            results: Array<{ status: string; mode?: string }>;
        };
        expect(shareBody.status).toBe('success');
        expect(shareBody.results[0].mode).toBe('read');

        const listRes = await get(
            '/share/shared-with-me',
            recipient.token,
            { includeTotal: 'true' },
        );
        expect(listRes.status).toBe(200);
        const listed = (await listRes.json()) as {
            items: Array<Record<string, unknown>>;
            total?: number;
        };
        const row = listed.items.find((i) => i.uid_entry === file.uid);
        expect(row).toBeDefined();
        expect(row?.issuer).toBe(owner.username);
        expect(row?.mode).toBe('read');
        expect(typeof listed.total).toBe('number');

        // Nothing internal rides along in the response.
        for (const key of ['issuer_user_id', 'holder_user_id', 'fsentry_id']) {
            expect(row).not.toHaveProperty(key);
        }

        const revokeRes = await post('/share/revoke', owner.token, {
            recipients: [recipient.username],
            items: [{ uid: file.uid }],
        });
        expect(revokeRes.status).toBe(200);
        expect(await revokeRes.json()).toMatchObject({ revoked: 1 });

        const afterRes = await get('/share/shared-with-me', recipient.token, {});
        const after = (await afterRes.json()) as {
            items: Array<Record<string, unknown>>;
        };
        expect(after.items.find((i) => i.uid_entry === file.uid)).toBeUndefined();
    });

    it('revokes every item in the request, not just the first', async () => {
        const owner = env.users.user;
        const recipient = env.users.other;
        const fileA = await makeFile(owner);
        const fileB = await makeFile(owner);

        for (const file of [fileA, fileB]) {
            const res = await post('/share', owner.token, {
                recipients: [recipient.username],
                items: [{ uid: file.uid }],
                mode: 'read',
            });
            expect(res.status).toBe(200);
        }

        // A truncated revoke is a silent security failure: the caller is told
        // "success" while items after the first keep their grants.
        const revokeRes = await post('/share/revoke', owner.token, {
            recipients: [recipient.username],
            items: [{ uid: fileA.uid }, { uid: fileB.uid }],
        });
        expect(revokeRes.status).toBe(200);
        expect(await revokeRes.json()).toMatchObject({
            status: 'success',
            revoked: 2,
        });

        const afterRes = await get('/share/shared-with-me', recipient.token, {});
        const after = (await afterRes.json()) as {
            items: Array<Record<string, unknown>>;
        };
        for (const file of [fileA, fileB]) {
            expect(
                after.items.find((i) => i.uid_entry === file.uid),
            ).toBeUndefined();
        }
    });

    it('reports per-pair outcomes when only some recipients resolve', async () => {
        const owner = env.users.user;
        const file = await makeFile(owner);

        const res = await post('/share', owner.token, {
            recipients: [env.users.other.username, 'nosuchuser-zzz'],
            items: [{ uid: file.uid }],
            mode: 'read',
        });
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
            status: string;
            results: Array<{ status: string; recipient: string }>;
        };
        expect(body.status).toBe('mixed');
        expect(body.results).toHaveLength(2);
        expect(
            body.results.find((r) => r.recipient === 'nosuchuser-zzz')?.status,
        ).toBe('error');
    });

    it('lists who can reach an item for its owner', async () => {
        const owner = env.users.user;
        const recipient = env.users.other;
        const file = await makeFile(owner);

        await post('/share', owner.token, {
            recipients: [recipient.username],
            items: [{ uid: file.uid }],
            mode: 'write',
        });

        const res = await get('/share/shares', owner.token, { uid: file.uid });
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
            items: Array<{ holder: string; mode: string }>;
        };
        expect(body.items).toHaveLength(1);
        expect(body.items[0].holder).toBe(recipient.username);
        expect(body.items[0].mode).toBe('write');
    });

    it('hides an item from a stranger asking who can reach it', async () => {
        const owner = env.users.user;
        const file = await makeFile(owner);

        const res = await get('/share/shares', env.users.other.token, {
            uid: file.uid,
        });
        expect(res.status).toBe(404);
    });

    it('rejects an unauthenticated share', async () => {
        const res = await fetch(new URL('/share', env.apiOrigin), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ recipients: ['x'], items: ['y'] }),
        });
        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(res.status).toBeLessThan(500);
    });

    it('caps how many recipients one request can reach', async () => {
        const owner = env.users.user;
        const file = await makeFile(owner);
        const many = Array.from({ length: 64 }, (_, i) => `user-${i}`);

        const res = await post('/share', owner.token, {
            recipients: many,
            items: [{ uid: file.uid }],
            mode: 'read',
        });
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({
            code: 'too_many_recipients',
        });
    });

    it('caps how many items one request can carry', async () => {
        const owner = env.users.user;
        const many = Array.from({ length: 128 }, () => ({
            uid: crypto.randomUUID(),
        }));

        const res = await post('/share', owner.token, {
            recipients: [env.users.other.username],
            items: many,
            mode: 'read',
        });
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({ code: 'too_many_items' });
    });

    it('rejects a request with no recipients or no items', async () => {
        const owner = env.users.user;
        const file = await makeFile(owner);

        expect(
            (await post('/share', owner.token, { items: [{ uid: file.uid }] }))
                .status,
        ).toBe(400);
        expect(
            (
                await post('/share', owner.token, {
                    recipients: [env.users.other.username],
                })
            ).status,
        ).toBe(400);
    });
});
