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
import {
    RESPONSE_CLOSE_LISTENER_BUDGET,
    setupPuterTestEnv,
    TEST_USER_CREDENTIALS,
    trackResponseCloseListeners,
    type PuterTestEnv,
} from '../../testUtil.js';

/** File downloads over WebDAV: the bytes, ranges, and either end failing. */
describe('WebDAV GET over HTTP', () => {
    let env: PuterTestEnv;

    beforeAll(async () => {
        env = await setupPuterTestEnv();
    }, 60_000);

    afterAll(async () => {
        await env?.shutdown();
    });

    const dav = (path: string, init: RequestInit = {}) => {
        const port = new URL(env.apiOrigin).port;
        const auth = Buffer.from(
            `${TEST_USER_CREDENTIALS.username}:${TEST_USER_CREDENTIALS.password}`,
        ).toString('base64');
        return fetch(`http://dav.puter.localhost:${port}${encodeURI(path)}`, {
            ...init,
            headers: {
                Authorization: `Basic ${auth}`,
                // Uncompressed, so the bytes on the wire are the stored ones.
                'Accept-Encoding': 'identity',
                ...(init.headers as Record<string, string> | undefined),
            },
        });
    };

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

    it('returns the stored bytes, whole or as a range', async () => {
        const content = randomBytes(128 * 1024 + 3);
        const file = await writeFile('dav-get.bin', content);

        const whole = await dav(file.path);
        expect(whole.status).toBe(200);
        expect(whole.headers.get('content-length')).toBe(
            String(content.byteLength),
        );
        expect(Buffer.from(await whole.arrayBuffer())).toEqual(content);

        const range = await dav(file.path, {
            headers: { Range: 'bytes=10-19' },
        });
        expect(range.status).toBe(206);
        expect(range.headers.get('content-range')).toBe(
            `bytes 10-19/${content.byteLength}`,
        );
        expect(Buffer.from(await range.arrayBuffer())).toEqual(
            content.subarray(10, 20),
        );
    });

    /**
     * Storage hands over one chunk of `file` and then goes quiet, as a large
     * object does while the client is still reading.
     */
    const stallStorage = (file: { uuid: string }) => {
        const s3 = env.server.stores.s3Object;
        const client = env.server.clients.s3.get(s3.resolveRegion(null));
        const send = client.send.bind(client);
        const bodies: Readable[] = [];
        const spy = vi.spyOn(client, 'send').mockImplementation(((
            command: unknown,
        ) => {
            if (
                !(command instanceof GetObjectCommand) ||
                command.input.Key !== file.uuid
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
        return { bodies, restore: () => spy.mockRestore() };
    };

    const expectFullDownload = async (path: string) => {
        const response = await dav(path);
        expect(response.status).toBe(200);
        expect((await response.arrayBuffer()).byteLength).toBe(1024 * 1024);
    };

    it('releases the storage stream when the client aborts', async () => {
        const file = await writeFile(
            'dav-abort.bin',
            Buffer.alloc(1024 * 1024, 1),
        );
        const storage = stallStorage(file);
        try {
            const abort = new AbortController();
            const response = await dav(file.path, { signal: abort.signal });
            expect(response.status).toBe(200);
            await response.body!.getReader().read();
            abort.abort();

            expect(storage.bodies).toHaveLength(1);
            await vi.waitFor(() =>
                expect(storage.bodies[0]!.destroyed).toBe(true),
            );
        } finally {
            storage.restore();
        }

        await expectFullDownload(file.path);
    });

    it('cuts the download off when storage fails mid-stream', async () => {
        const file = await writeFile(
            'dav-reset.bin',
            Buffer.alloc(1024 * 1024, 1),
        );
        const storage = stallStorage(file);
        try {
            const response = await dav(file.path);
            expect(response.status).toBe(200);
            const reader = response.body!.getReader();
            await reader.read();
            storage.bodies[0]!.destroy(new Error('upstream reset'));

            const outcome = await (async () => {
                try {
                    while (!(await reader.read()).done);
                    return 'ended';
                } catch {
                    return 'cut off';
                }
            })();
            expect(outcome).toBe('cut off');
        } finally {
            storage.restore();
        }

        await expectFullDownload(file.path);
    });

    it('stays within the close listener budget per response', async () => {
        const file = await writeFile('dav-listeners.bin', randomBytes(4096));
        const tracker = trackResponseCloseListeners();
        try {
            const response = await dav(file.path);
            expect(response.status).toBe(200);
            await response.arrayBuffer();
        } finally {
            tracker.restore();
        }
        const peak = tracker.peak(
            (req) => req.method === 'GET' && req.url === file.path,
        );
        expect(peak).toBeGreaterThan(0);
        expect(peak).toBeLessThanOrEqual(RESPONSE_CLOSE_LISTENER_BUDGET);
    });
});
