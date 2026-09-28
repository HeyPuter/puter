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
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupPuterTestEnv, type PuterTestEnv } from '../../testUtil.js';

/**
 * Contact Us attachments over real HTTP. Multipart bodies must skip the global
 * JSON parser so the route's gates run before any of the body is read; only a
 * listening server shows that.
 */
describe('POST /contactUs over HTTP', () => {
    let env: PuterTestEnv;

    beforeAll(async () => {
        env = await setupPuterTestEnv();
    }, 120_000);

    afterAll(async () => {
        await env?.shutdown();
    });

    const png = (size: number): Buffer =>
        Buffer.concat([
            Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
            Buffer.alloc(size - 8, 0x61),
        ]);

    const BOUNDARY = 'contact-us-http-test';
    const multipartHead = Buffer.from(
        `--${BOUNDARY}\r\nContent-Disposition: form-data; name="message"\r\n\r\nhi\r\n` +
            `--${BOUNDARY}\r\nContent-Disposition: form-data; name="attachments"; filename="a.png"\r\n` +
            'Content-Type: image/png\r\n\r\n',
    );

    /** Send raw bytes and resolve with the response, however early it comes. */
    const rawPost = (
        headers: Record<string, string>,
        write: (req: http.ClientRequest) => void,
    ) =>
        new Promise<{ status: number; connection?: string }>(
            (resolve, reject) => {
                const url = new URL('/contactUs', env.apiOrigin);
                const req = http.request(
                    url,
                    {
                        method: 'POST',
                        headers: {
                            Authorization: `Bearer ${env.users.user.token}`,
                            'Content-Type': `multipart/form-data; boundary=${BOUNDARY}`,
                            ...headers,
                        },
                    },
                    (res) => {
                        res.resume();
                        resolve({
                            status: res.statusCode ?? 0,
                            connection: res.headers.connection,
                        });
                    },
                );
                req.on('error', reject);
                write(req);
            },
        );

    it('accepts the FormData the Contact Us window sends', async () => {
        const message = `http ${Math.random().toString(36).slice(2)}`;
        const body = new FormData();
        body.append('message', message);
        body.append(
            'attachments',
            new Blob([png(4096)], { type: 'image/png' }),
            'shot.png',
        );

        const res = await fetch(new URL('/contactUs', env.apiOrigin), {
            method: 'POST',
            headers: { Authorization: `Bearer ${env.users.user.token}` },
            body,
        });
        expect(res.status).toBe(200);

        const rows = (await env.server.clients.db.read(
            'SELECT `attachments` FROM `feedback` WHERE `message` = ?',
            [message],
        )) as Array<{ attachments: string | null }>;
        expect(JSON.parse(rows[0]!.attachments!)).toEqual([
            { name: 'shot.png', type: 'image/png', size: 4096 },
        ]);
    });

    it('refuses an unauthenticated upload', async () => {
        const body = new FormData();
        body.append('message', 'hi');
        const res = await fetch(new URL('/contactUs', env.apiOrigin), {
            method: 'POST',
            body,
        });
        expect(res.status).toBe(401);
    });

    it('answers an oversized Content-Length before the body is sent', async () => {
        const res = await rawPost(
            { 'Content-Length': String(64 * 1024 * 1024) },
            (req) => req.flushHeaders(),
        );
        expect(res).toEqual({ status: 413, connection: 'close' });
    });

    it('answers a chunked upload that breaks the per-file cap with 413', async () => {
        const file = png(12 * 1024 * 1024);
        const res = await rawPost({ 'Transfer-Encoding': 'chunked' }, (req) => {
            req.write(multipartHead);
            req.end(file);
        });
        expect(res.status).toBe(413);
    });
});
