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
 * Route-level coverage for `GET /fs/readdir`. The unit tests call the handler
 * directly, which cannot catch a route that was never registered or a gate that
 * rejects the request — so this suite drives real HTTP over a listening server,
 * and authenticates purely through `?auth_token=` (no request headers), which is
 * the whole point of offering the read as a GET.
 */
describe('GET /fs/readdir over HTTP', () => {
    let env: PuterTestEnv;

    beforeAll(async () => {
        env = await setupPuterTestEnv();
    }, 120_000);

    afterAll(async () => {
        await env?.shutdown();
    });

    const readdirUrl = (params: Record<string, string>) => {
        const url = new URL('/fs/readdir', env.apiOrigin);
        for (const [key, value] of Object.entries(params)) {
            url.searchParams.set(key, value);
        }
        return url;
    };

    it('lists a directory authenticated only by a query token', async () => {
        const { username, token } = env.users.user;
        const response = await fetch(
            readdirUrl({ path: `/${username}`, auth_token: token }),
        );
        expect(response.status).toBe(200);
        const body = (await response.json()) as Array<{
            name: string;
            uuid: string;
        }>;
        expect(Array.isArray(body)).toBe(true);
        // Default provisioned home directories.
        expect(body.map((e) => e.name)).toContain('Documents');
        for (const entry of body) {
            expect(entry.uuid).toEqual(expect.any(String));
        }
    });

    it('paginates via query params', async () => {
        const { username, token } = env.users.user;
        const response = await fetch(
            readdirUrl({
                path: `/${username}`,
                auth_token: token,
                limit: '2',
                cursor: '',
                includeTotal: 'true',
            }),
        );
        expect(response.status).toBe(200);
        const page = (await response.json()) as {
            items: unknown[];
            cursor?: string;
            total?: number;
        };
        expect(page.items.length).toBe(2);
        expect(typeof page.total).toBe('number');
        expect(page.cursor).toEqual(expect.any(String));
    });

    it('rejects an unauthenticated request', async () => {
        const { username } = env.users.user;
        const response = await fetch(readdirUrl({ path: `/${username}` }));
        expect(response.status).toBeGreaterThanOrEqual(400);
        expect(response.status).toBeLessThan(500);
    });

    it('does not leak internal ids or storage columns over the wire', async () => {
        const { username, token } = env.users.user;
        const response = await fetch(
            readdirUrl({ path: `/${username}`, auth_token: token }),
        );
        const raw = await response.text();
        const body = JSON.parse(raw) as Array<Record<string, unknown>>;
        expect(body.length).toBeGreaterThan(0);
        // Checked per-entry rather than by scanning the raw body: the nested
        // `associatedApp` payload legitimately carries its own `id` (v1 has
        // always exposed it), so a substring scan would false-alarm.
        for (const entry of body) {
            for (const field of [
                'id',
                'parentId',
                'userId',
                'associatedAppId',
                'bucket',
                'bucketRegion',
                'publicToken',
                'fileRequestToken',
            ]) {
                expect(entry).not.toHaveProperty(field);
            }
        }
        // No user-identifying data (emails, owner records) anywhere.
        expect(raw).not.toContain('@');
        expect(raw).not.toMatch(/"(email|owner|user_id|userId)"/);
    });

    it('lists a nested subtree recursively over GET', async () => {
        const { username, token } = env.users.user;
        const base = `/${username}/Documents/http-recursive-${Date.now()}`;
        for (const path of [base, `${base}/a`, `${base}/a/b`]) {
            const created = await fetch(new URL('/fs/mkdir', env.apiOrigin), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path, auth_token: token }),
            });
            expect(created.status).toBe(200);
        }

        const response = await fetch(
            readdirUrl({
                path: base,
                auth_token: token,
                recursive: 'true',
                depth: '5',
            }),
        );
        expect(response.status).toBe(200);
        const page = (await response.json()) as {
            items: Array<{ path: string }>;
        };
        expect(
            page.items.map((e) => e.path.slice(base.length + 1)).sort(),
        ).toEqual(['a', 'a/b']);
    });

    it('mkdir does not return internal ids, storage columns or tokens', async () => {
        const { username, token } = env.users.user;
        const response = await fetch(new URL('/fs/mkdir', env.apiOrigin), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                path: `/${username}/Documents/http-mkdir-${Date.now()}`,
                auth_token: token,
            }),
        });
        expect(response.status).toBe(200);
        const entry = (await response.json()) as Record<string, unknown>;
        expect(entry.uuid).toEqual(expect.any(String));
        expect(entry.isDir).toBe(true);
        for (const field of [
            'id',
            'parentId',
            'userId',
            'associatedAppId',
            'bucket',
            'bucketRegion',
            'publicToken',
            'fileRequestToken',
        ]) {
            expect(entry).not.toHaveProperty(field);
        }
    });

    it('startBatchWrite does not expose storage internals', async () => {
        const { username, token } = env.users.user;
        const response = await fetch(
            new URL('/fs/startBatchWrite', env.apiOrigin),
            {
                method: 'POST',
                // Array body, so there is no `auth_token` field for the auth
                // probe to read — authenticate via the header instead.
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify([
                    {
                        fileMetadata: {
                            path: `/${username}/Documents/http-signed-${Date.now()}.bin`,
                            size: 4,
                        },
                    },
                ]),
            },
        );
        expect(response.status).toBe(200);
        const [target] = (await response.json()) as Array<
            Record<string, unknown>
        >;
        // What a client actually needs to upload.
        expect(target!.sessionId).toEqual(expect.any(String));
        expect(typeof target!.url).toBe('string');
        // What it does not: where the bytes physically live.
        for (const field of ['bucket', 'bucketRegion', 'objectKey']) {
            expect(target).not.toHaveProperty(field);
        }
    });

    it('still serves the POST form for existing callers', async () => {
        const { username, token } = env.users.user;
        const response = await fetch(new URL('/fs/readdir', env.apiOrigin), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: `/${username}`, auth_token: token }),
        });
        expect(response.status).toBe(200);
        const body = (await response.json()) as Array<{ name: string }>;
        expect(body.map((e) => e.name)).toContain('Documents');
    });

    describe('the share flag', () => {
        const post = async (path: string, token: string, body: unknown) => {
            const response = await fetch(new URL(path, env.apiOrigin), {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    authorization: `Bearer ${token}`,
                },
                body: JSON.stringify(body),
            });
            expect(response.status).toBe(200);
            return response.json() as Promise<Record<string, unknown>>;
        };

        const mkdir = (path: string, token: string) =>
            post('/fs/mkdir', token, { path });

        const readdir = async (path: string, token: string) => {
            const response = await fetch(readdirUrl({ path, auth_token: token }));
            expect(response.status).toBe(200);
            const entries = (await response.json()) as Array<{
                name: string;
                isShared: boolean | null;
            }>;
            return new Map(entries.map((e) => [e.name, e.isShared]));
        };

        const base = () =>
            `/${env.users.user.username}/Documents/flag-${crypto.randomUUID().slice(0, 8)}`;

        it('marks a shared child in a listing, and clears it on revoke', async () => {
            const owner = env.users.user;
            const recipient = env.users.other;
            const parent = base();
            await mkdir(parent, owner.token);
            const shared = await mkdir(`${parent}/shared`, owner.token);
            await mkdir(`${parent}/private`, owner.token);

            // A write response says nothing about sharing.
            expect(shared).not.toHaveProperty('isShared');

            await post('/share', owner.token, {
                recipients: [recipient.username],
                items: [{ uid: shared.uuid }],
                mode: 'read',
            });

            expect(await readdir(parent, owner.token)).toEqual(
                new Map([
                    ['shared', true],
                    ['private', false],
                ]),
            );

            await post('/share/revoke', owner.token, {
                recipients: [recipient.username],
                items: [{ uid: shared.uuid }],
            });

            expect(await readdir(parent, owner.token)).toEqual(
                new Map([
                    ['shared', false],
                    ['private', false],
                ]),
            );
        });

        it('names the recipients in stat only when asked', async () => {
            const owner = env.users.user;
            const recipient = env.users.other;
            const parent = base();
            await mkdir(parent, owner.token);
            const shared = await mkdir(`${parent}/shared`, owner.token);

            await post('/share', owner.token, {
                recipients: [recipient.username],
                items: [{ uid: shared.uuid }],
                mode: 'read',
            });

            const plain = await post('/fs/stat', owner.token, {
                uid: shared.uuid,
            });
            expect(plain.isShared).toBe(true);
            expect(plain).not.toHaveProperty('shares');


            const withShares = await post('/fs/stat', owner.token, {
                uid: shared.uuid,
                return_shares: true,
            });
            const shares = withShares.shares as Array<Record<string, unknown>>;
            expect(shares).toHaveLength(1);
            expect(shares[0]).toMatchObject({
                holder: recipient.username,
                issuer: owner.username,
                mode: 'read',
                inherited_from: null,
            });
            for (const key of ['holder_user_id', 'issuer_user_id', 'fsentry_id']) {
                expect(shares[0]).not.toHaveProperty(key);
            }
        });

        it('tells a recipient nothing about who else can reach the item', async () => {
            const owner = env.users.user;
            const recipient = env.users.other;
            const parent = base();
            await mkdir(parent, owner.token);
            const shared = await mkdir(`${parent}/shared`, owner.token);

            await post('/share', owner.token, {
                recipients: [recipient.username],
                items: [{ uid: shared.uuid }],
                mode: 'read',
            });

            const stat = await post('/fs/stat', recipient.token, {
                uid: shared.uuid,
                return_shares: true,
            });
            expect(stat.isShared).toBeNull();
            // Asked for, so the key is there — but it names nobody.
            expect(stat.shares).toEqual([]);
        });
    });
});
