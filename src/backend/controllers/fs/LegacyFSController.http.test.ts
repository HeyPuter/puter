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

import { GetObjectCommand } from '@aws-sdk/client-s3';
import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { setupPuterTestEnv, type PuterTestEnv } from '../../testUtil.js';

/**
 * The v1 download routes over real HTTP: what reaches the client, and what
 * happens to the storage stream when the client goes away mid-download.
 */
describe('legacy file downloads over HTTP', () => {
    let env: PuterTestEnv;

    beforeAll(async () => {
        env = await setupPuterTestEnv();
    }, 120_000);

    afterAll(async () => {
        await env?.shutdown();
    });

    const writeFile = async (name: string, content: Buffer) => {
        const { username } = env.users.user;
        const user = await env.server.stores.user.getByUsername(username);
        const path = `/${username}/Documents/${name}`;
        const { fsEntry } = await env.server.services.fs.write(user!.id, {
            fileMetadata: {
                path,
                size: content.byteLength,
                contentType: 'application/octet-stream',
            },
            fileContent: content,
        });
        return { path, uuid: fsEntry.uuid };
    };

    const signedReadUrl = async (path: string): Promise<URL> => {
        const signed = await fetch(new URL('/sign', env.apiOrigin), {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${env.users.user.token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ items: [{ path, action: 'read' }] }),
        });
        expect(signed.status).toBe(200);
        const readUrl = new URL(
            (await signed.json()).signatures[0].read_url as string,
        );
        return new URL(`${readUrl.pathname}${readUrl.search}`, env.apiOrigin);
    };

    const accessTokenFor = async (uuid: string): Promise<string> => {
        const user = await env.server.stores.user.getByUsername(
            env.users.user.username,
        );
        return env.server.services.auth.createAccessToken(
            { user } as never,
            [[`fs:${uuid}:read`]],
            { label: 'legacy-download-http' },
        );
    };

    type Route = '/read' | '/token-read' | '/file' | '/down';
    const routes: Route[] = ['/read', '/token-read', '/file', '/down'];

    const requestFor = async (
        route: Route,
        file: { path: string; uuid: string },
        init: RequestInit & { headers?: Record<string, string> } = {},
    ): Promise<Response> => {
        const { token, apiToken } = env.users.user;
        let url: URL;
        let base: RequestInit & { headers?: Record<string, string> } = {};
        if (route === '/read') {
            url = new URL('/read', env.apiOrigin);
            url.searchParams.set('file', file.path);
            base = { headers: { Authorization: `Bearer ${token}` } };
        } else if (route === '/token-read') {
            url = new URL('/token-read', env.apiOrigin);
            url.searchParams.set('uid', file.uuid);
            url.searchParams.set('token', await accessTokenFor(file.uuid));
        } else if (route === '/file') {
            url = await signedReadUrl(file.path);
        } else {
            url = new URL('/down', env.origin);
            url.searchParams.set('path', file.path);
            base = {
                method: 'POST',
                headers: { Authorization: `Bearer ${apiToken}` },
            };
        }
        return fetch(url, {
            ...base,
            ...init,
            headers: { ...base.headers, ...init.headers },
        });
    };

    it.each(routes)(
        'GET %s returns the stored bytes and headers unchanged',
        async (route) => {
            const content = randomBytes(256 * 1024 + 7);
            const name = `bytes-${route.replace(/\W/g, '')}.bin`;
            const file = await writeFile(name, content);

            const raw = await requestFor(route, file, {
                headers: { 'Accept-Encoding': 'identity' },
            });
            expect(raw.status).toBe(200);
            expect(raw.headers.get('content-length')).toBe(
                String(content.byteLength),
            );
            expect(raw.headers.get('content-type')).toBe(
                'application/octet-stream',
            );
            expect(raw.headers.get('content-disposition')).toBe(
                `${route === '/down' ? 'attachment' : 'inline'}; filename="${name}"`,
            );
            expect(raw.headers.get('etag')).toEqual(expect.any(String));
            expect(raw.headers.get('last-modified')).toEqual(
                expect.any(String),
            );
            expect(Buffer.from(await raw.arrayBuffer()).equals(content)).toBe(
                true,
            );

            // Compressed on the wire by default; the bytes still match.
            const compressed = await requestFor(route, file);
            expect(compressed.headers.get('content-encoding')).toBe('gzip');
            expect(
                Buffer.from(await compressed.arrayBuffer()).equals(content),
            ).toBe(true);
        },
    );

    // Storage hands over one chunk and then goes quiet, as a large object
    // does while the client is still reading.
    const stallReadsOf = (objectKey: string) => {
        const s3 = env.server.stores.s3Object;
        const client = env.server.clients.s3.get(s3.resolveRegion(null));
        const send = client.send.bind(client);
        const bodies: Readable[] = [];
        const spy = vi.spyOn(client, 'send').mockImplementation(((
            command: unknown,
        ) => {
            if (
                !(command instanceof GetObjectCommand) ||
                command.input.Key !== objectKey
            ) {
                return send(command as never);
            }
            let pushed = false;
            const body = new Readable({
                read() {
                    if (!pushed) {
                        pushed = true;
                        this.push(Buffer.alloc(16 * 1024, 1));
                    }
                },
            });
            bodies.push(body);
            return Promise.resolve({
                Body: body,
                ContentLength: 1024 * 1024,
                ContentType: 'application/octet-stream',
            });
        }) as never);
        return { spy, bodies };
    };

    it.each(routes)(
        'GET %s releases the storage stream when the client aborts',
        async (route) => {
            const file = await writeFile(
                `abort-${route.replace(/\W/g, '')}.bin`,
                Buffer.alloc(1024 * 1024, 1),
            );
            const { spy, bodies } = stallReadsOf(file.uuid);
            try {
                const abort = new AbortController();
                // Uncompressed, so the first chunk reaches the client as-is.
                const response = await requestFor(route, file, {
                    signal: abort.signal,
                    headers: { 'Accept-Encoding': 'identity' },
                });
                expect(response.status).toBe(200);
                const reader = response.body!.getReader();
                await reader.read();
                abort.abort();

                expect(bodies).toHaveLength(1);
                await vi.waitFor(() => expect(bodies[0]!.destroyed).toBe(true));
            } finally {
                spy.mockRestore();
            }

            // The server keeps serving after the aborted transfer.
            const healthy = await writeFile(
                `after-abort-${route.replace(/\W/g, '')}.txt`,
                Buffer.from('still fine'),
            );
            const next = await requestFor(route, healthy);
            expect(next.status).toBe(200);
            expect(await next.text()).toBe('still fine');
        },
    );

    // Storage fails, either before its first byte or after one chunk.
    const failReadsOf = (objectKey: string, sendFirst: boolean) => {
        const s3 = env.server.stores.s3Object;
        const client = env.server.clients.s3.get(s3.resolveRegion(null));
        const send = client.send.bind(client);
        return vi.spyOn(client, 'send').mockImplementation(((
            command: unknown,
        ) => {
            if (
                !(command instanceof GetObjectCommand) ||
                command.input.Key !== objectKey
            ) {
                return send(command as never);
            }
            let reads = 0;
            const body = new Readable({
                read() {
                    reads++;
                    if (sendFirst && reads === 1) {
                        this.push(Buffer.alloc(16 * 1024, 1));
                        return;
                    }
                    setImmediate(() =>
                        this.destroy(new Error('storage socket reset')),
                    );
                },
            });
            return Promise.resolve({
                Body: body,
                ContentLength: 1024 * 1024,
                ContentType: 'application/octet-stream',
            });
        }) as never);
    };

    it.each(
        routes.flatMap((route) => [
            [route, true] as const,
            [route, false] as const,
        ]),
    )(
        'GET %s drops the connection when storage fails (bytes sent first: %s)',
        async (route, sendFirst) => {
            const file = await writeFile(
                `fail-${sendFirst ? 'mid' : 'start'}-${route.replace(/\W/g, '')}.bin`,
                Buffer.alloc(1024 * 1024, 1),
            );
            const spy = failReadsOf(file.uuid, sendFirst);
            try {
                // No error body after a partial one: the client sees the
                // transfer cut off, either at the headers or mid-body.
                const outcome = await (async () => {
                    try {
                        const response = await requestFor(route, file, {
                            headers: { 'Accept-Encoding': 'identity' },
                        });
                        await response.arrayBuffer();
                        return `completed ${response.status}`;
                    } catch {
                        return 'cut off';
                    }
                })();
                expect(outcome).toBe('cut off');
            } finally {
                spy.mockRestore();
            }

            const healthy = await writeFile(
                `after-fail-${sendFirst ? 'mid' : 'start'}-${route.replace(/\W/g, '')}.txt`,
                Buffer.from('still fine'),
            );
            const next = await requestFor(route, healthy);
            expect(next.status).toBe(200);
            expect(await next.text()).toBe('still fine');
        },
    );
});
