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

import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { setupPuterTestEnv, type PuterTestEnv } from '../../testUtil.js';

const PICTURE =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=';

describe('profile routes over HTTP', () => {
    let env: PuterTestEnv;
    let userUuid = '';
    /** The plan `env.users.user` is on; see the resolver below. */
    let plan: string | null = null;

    beforeAll(async () => {
        env = await setupPuterTestEnv();
        userUuid = (await env.server.stores.user.getByUsername(
            env.users.user.username,
        ))!.uuid;
        env.server.services.metering.registerPolicy({
            id: 'business',
            monthUsageAllowance: 45 * 1_000_000 * 100,
            monthlyStorageAllowance: 1024 ** 3,
        });
        env.server.services.metering.registerSubscriptionResolver((actor) =>
            actor.user?.uuid === userUuid ? plan : null,
        );
    }, 120_000);

    afterAll(async () => {
        await env?.shutdown();
    });

    const withSubscription = async <T>(
        id: string | null,
        fn: () => Promise<T>,
    ): Promise<T> => {
        plan = id;
        env.server.services.metering.invalidateActorSubscription(userUuid);
        try {
            return await fn();
        } finally {
            plan = null;
            env.server.services.metering.invalidateActorSubscription(userUuid);
        }
    };

    const get = (query: string, token?: string) =>
        fetch(new URL(`/profile${query}`, env.apiOrigin), {
            headers: token ? { authorization: `Bearer ${token}` } : {},
        });

    const post = (body: unknown, token: string) =>
        fetch(new URL('/profile', env.apiOrigin), {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(body),
        });

    it('lets a user write and read their own profile on any plan', async () => {
        const write = await post(
            { picture: PICTURE, displayName: 'Test' },
            env.users.user.token,
        );
        expect(write.status).toBe(200);
        expect(await write.json()).toEqual({
            picture: PICTURE,
            displayName: 'Test',
            bio: null,
        });

        const own = await get('', env.users.user.token);
        expect(own.status).toBe(200);
        expect(await own.json()).toMatchObject({ picture: PICTURE });

        const byName = await get(
            `?username=${env.users.user.username}`,
            env.users.user.token,
        );
        expect(byName.status).toBe(200);
        expect(await byName.json()).toMatchObject({ displayName: 'Test' });
    });

    it('hides a free user from anonymous and third-party readers as a 404', async () => {
        const anonymous = await get(`?username=${env.users.user.username}`);
        expect(anonymous.status).toBe(404);
        const other = await get(
            `?username=${env.users.user.username}`,
            env.users.other.token,
        );
        expect(other.status).toBe(404);
        // Same shape as an account that does not exist.
        const missing = await get('?username=nobody-here');
        expect(missing.status).toBe(404);
    });

    it('serves a paid user to anyone, and hides them again when the plan ends', async () => {
        await withSubscription('business', async () => {
            const anonymous = await get(`?username=${env.users.user.username}`);
            expect(anonymous.status).toBe(200);
            expect(await anonymous.json()).toMatchObject({ picture: PICTURE });
            const other = await get(
                `?username=${env.users.user.username}`,
                env.users.other.token,
            );
            expect(other.status).toBe(200);
        });
        expect((await get(`?username=${env.users.user.username}`)).status).toBe(
            404,
        );
    });

    it('requires a username or a signed-in caller, and validates the username shape', async () => {
        expect((await get('')).status).toBe(401);
        expect((await get('?username=not%20valid')).status).toBe(400);
    });

    it('rejects a bad patch with a stable code and refuses app and anonymous writers', async () => {
        const bad = await post({ name: 'x' }, env.users.user.token);
        expect(bad.status).toBe(400);
        expect(await bad.json()).toMatchObject({
            code: 'profile_field_not_allowed',
        });

        const anonymous = await fetch(new URL('/profile', env.apiOrigin), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ bio: 'x' }),
        });
        expect(anonymous.status).toBe(401);
    });

    describe('revalidation', () => {
        // `fetch` adds `cache-control: no-cache` beside If-None-Match, which
        // rules out a 304; this sends what a browser revalidating its copy does.
        const revalidate = (query: string, etag: string, token?: string) =>
            new Promise<{ status: number; etag?: string; body: string }>(
                (resolve, reject) => {
                    const url = new URL(`/profile${query}`, env.apiOrigin);
                    const req = http.request(
                        {
                            host: url.hostname,
                            port: url.port,
                            path: `${url.pathname}${url.search}`,
                            headers: {
                                host: url.host,
                                'if-none-match': etag,
                                ...(token
                                    ? { authorization: `Bearer ${token}` }
                                    : {}),
                            },
                        },
                        (res) => {
                            let body = '';
                            res.setEncoding('utf8');
                            res.on('data', (chunk) => (body += chunk));
                            res.on('end', () =>
                                resolve({
                                    status: res.statusCode!,
                                    etag: res.headers.etag,
                                    body,
                                }),
                            );
                        },
                    );
                    req.on('error', reject);
                    req.end();
                },
            );

        it('answers 304 to the current tag without reading the stored profile', async () => {
            await post({ bio: 'tagged' }, env.users.user.token);
            const first = await get('', env.users.user.token);
            expect(first.headers.get('cache-control')).toBe(
                'private, no-cache',
            );
            const etag = first.headers.get('etag')!;
            expect(etag).toMatch(/^W\/"[^"]+"$/);

            const read = vi.spyOn(env.server.services.fs, 'readContent');
            try {
                const again = await revalidate('', etag, env.users.user.token);
                expect(again.status).toBe(304);
                expect(again.body).toBe('');
                expect(read).not.toHaveBeenCalled();
            } finally {
                read.mockRestore();
            }
        });

        it('sends the new profile once it changes', async () => {
            await post({ bio: 'before' }, env.users.user.token);
            const etag = (await get('', env.users.user.token)).headers.get(
                'etag',
            )!;
            await post({ bio: 'after' }, env.users.user.token);

            const again = await revalidate('', etag, env.users.user.token);
            expect(again.status).toBe(200);
            expect(again.etag).not.toBe(etag);
            expect(JSON.parse(again.body)).toMatchObject({ bio: 'after' });
        });

        // The file is written before its entry, and an entry can be read
        // from a cache or replica that has not caught up.
        describe('while the file entry is behind the file', () => {
            const profileEntry = async () =>
                (await env.server.stores.fsEntry.getEntryByPath(
                    `/system/profiles/${userUuid}.profile`,
                ))!;
            const serveEntry = (entry: unknown) => {
                const getEntryByPath =
                    env.server.stores.fsEntry.getEntryByPath.bind(
                        env.server.stores.fsEntry,
                    );
                return vi
                    .spyOn(env.server.stores.fsEntry, 'getEntryByPath')
                    .mockImplementation(async (path, options) =>
                        path.startsWith('/system/profiles/')
                            ? (entry as never)
                            : getEntryByPath(path, options),
                    );
            };

            it('tags a response by the profile it carries', async () => {
                await post({ bio: 'first' }, env.users.user.token);
                const firstTag = (
                    await get('', env.users.user.token)
                ).headers.get('etag')!;
                const behind = await profileEntry();
                await post({ bio: 'second' }, env.users.user.token);

                const spy = serveEntry(behind);
                try {
                    const response = await get('', env.users.user.token);
                    expect(await response.json()).toMatchObject({
                        bio: 'second',
                    });
                    expect(response.headers.get('etag')).not.toBe(firstTag);
                } finally {
                    spy.mockRestore();
                }
            });

            it('still answers 304 for a profile stored before tags were kept, after reading it', async () => {
                await post({ bio: 'kept' }, env.users.user.token);
                const untagged = { ...(await profileEntry()), metadata: null };
                const spy = serveEntry(untagged);
                const read = vi.spyOn(env.server.services.fs, 'readContent');
                try {
                    const etag = (
                        await get('', env.users.user.token)
                    ).headers.get('etag')!;
                    const again = await revalidate(
                        '',
                        etag,
                        env.users.user.token,
                    );
                    expect(again.status).toBe(304);
                    expect(read).toHaveBeenCalledTimes(2);
                } finally {
                    read.mockRestore();
                    spy.mockRestore();
                }
            });
        });

        it('tags an account that has stored no profile', async () => {
            const first = await get('', env.users.other.token);
            expect(await first.json()).toEqual({
                picture: null,
                displayName: null,
                bio: null,
            });
            const etag = first.headers.get('etag')!;
            const again = await revalidate('', etag, env.users.other.token);
            expect(again.status).toBe(304);
        });

        it('still hides a profile whose owner left their plan, whatever tag the reader holds', async () => {
            const query = `?username=${env.users.user.username}`;
            const etag = await withSubscription('business', async () => {
                const shown = await get(query);
                expect(shown.status).toBe(200);
                return shown.headers.get('etag')!;
            });
            expect((await revalidate(query, etag)).status).toBe(404);
        });
    });
});
