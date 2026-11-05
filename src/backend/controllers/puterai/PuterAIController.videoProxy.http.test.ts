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

import crypto from 'node:crypto';
import http from 'node:http';
import {
    afterAll,
    afterEach,
    beforeAll,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import type { PuterServer } from '../../server.js';
import { allocateEphemeralPort, setupTestServer } from '../../testUtil.js';
import type { IConfig } from '../../types.js';

/**
 * The video proxy over a real socket: the provider download is the only thing
 * stubbed, so what reaches the client and what a hang-up does upstream are the
 * server's own behavior.
 */
describe('video proxy over HTTP', () => {
    const DOWNLOAD_BASE = 'https://generativelanguage.googleapis.com/';
    const SECRET = 'video-proxy-test-secret';
    let server: PuterServer;
    let port: number;

    beforeAll(async () => {
        port = await allocateEphemeralPort();
        server = await setupTestServer(
            {
                port,
                domain: 'puter.localhost',
                origin: `http://puter.localhost:${port}`,
                api_base_url: `http://api.puter.localhost:${port}`,
                url_signature_secret: SECRET,
                providers: {
                    'gemini-video-generation': { apiKey: 'test-key' },
                },
            } as unknown as IConfig,
            { listen: true },
        );
    }, 120_000);

    afterAll(async () => {
        await server?.shutdown();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    const signedPath = (fileId: string) => {
        const expires = String(Math.floor(Date.now() / 1000) + 60);
        const signature = crypto
            .createHash('sha256')
            .update(`${fileId}/video-proxy/${SECRET}/${expires}`)
            .digest('hex');
        return `/puterai/video/proxy?${new URLSearchParams({
            fileId,
            expires,
            signature,
            provider: 'gemini',
        })}`;
    };

    /** Serves `body` as the provider download and records what upstream sees. */
    const stubDownload = (body: ReadableStream<Uint8Array>) => {
        const seen: { signal?: AbortSignal } = {};
        const realFetch = globalThis.fetch;
        vi.spyOn(globalThis, 'fetch').mockImplementation(
            async (input, init) => {
                if (!String(input).startsWith(DOWNLOAD_BASE)) {
                    return realFetch(input, init);
                }
                seen.signal = init?.signal ?? undefined;
                return new Response(body, {
                    status: 200,
                    headers: { 'content-type': 'video/mp4' },
                });
            },
        );
        return seen;
    };

    const get = (path: string) =>
        http.request({
            host: '127.0.0.1',
            port,
            path,
            headers: { host: `api.puter.localhost:${port}` },
        });

    const waitFor = async (check: () => boolean) => {
        for (let i = 0; i < 100 && !check(); i++) {
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
        return check();
    };

    it('streams the provider download to the client byte for byte', async () => {
        const parts = ['video', '-', 'bytes'].map((s) =>
            new TextEncoder().encode(s),
        );
        stubDownload(
            new ReadableStream({
                start(controller) {
                    for (const part of parts) controller.enqueue(part);
                    controller.close();
                },
            }),
        );

        const { status, contentType, body } = await new Promise<{
            status?: number;
            contentType?: string;
            body: string;
        }>((resolve, reject) => {
            const req = get(signedPath('vid-ok'));
            req.on('response', (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk: Buffer) => chunks.push(chunk));
                res.on('end', () =>
                    resolve({
                        status: res.statusCode,
                        contentType: res.headers['content-type'],
                        body: Buffer.concat(chunks).toString('utf8'),
                    }),
                );
                res.on('error', reject);
            });
            req.on('error', reject);
            req.end();
        });

        expect(status).toBe(200);
        expect(contentType).toBe('video/mp4');
        expect(body).toBe('video-bytes');
    });

    it('streams without a listener-leak warning on the response', async () => {
        stubDownload(
            new ReadableStream({
                start(controller) {
                    controller.enqueue(new TextEncoder().encode('video'));
                    controller.close();
                },
            }),
        );
        const warnings: string[] = [];
        const onWarning = (warning: Error) => warnings.push(warning.name);
        process.on('warning', onWarning);
        try {
            await new Promise<void>((resolve, reject) => {
                const req = get(signedPath('vid-listeners'));
                req.on('response', (res) => {
                    res.on('data', () => {});
                    res.on('end', resolve);
                    res.on('error', reject);
                });
                req.on('error', reject);
                req.end();
            });
            await new Promise((resolve) => setTimeout(resolve, 10));
        } finally {
            process.off('warning', onWarning);
        }
        expect(warnings).not.toContain('MaxListenersExceededWarning');
    });

    it('stops the provider download when the client hangs up', async () => {
        let cancelled = false;
        const seen = stubDownload(
            new ReadableStream({
                start(controller) {
                    controller.enqueue(new TextEncoder().encode('first'));
                },
                // Never finishes on its own: only a cancel ends it.
                pull: () => new Promise(() => {}),
                cancel() {
                    cancelled = true;
                },
            }),
        );

        await new Promise<void>((resolve, reject) => {
            const req = get(signedPath('vid-leave'));
            req.on('response', (res) => {
                res.once('data', () => {
                    req.destroy();
                    resolve();
                });
            });
            req.on('error', (err) => {
                if (!req.destroyed) reject(err);
            });
            req.end();
        });

        expect(await waitFor(() => cancelled)).toBe(true);
        expect(seen.signal?.aborted).toBe(true);
    });

    it('cuts the reply off when the provider download breaks mid-stream', async () => {
        stubDownload(
            new ReadableStream({
                start(controller) {
                    controller.enqueue(new TextEncoder().encode('partial'));
                    setTimeout(
                        () => controller.error(new Error('upstream broke')),
                        10,
                    );
                },
            }),
        );

        const outcome = await new Promise<string>((resolve) => {
            const req = get(signedPath('vid-broken'));
            req.on('response', (res) => {
                res.on('data', () => {});
                res.on('end', () => resolve('ended'));
                res.on('error', () => resolve('aborted'));
                res.on('aborted', () => resolve('aborted'));
            });
            req.on('error', () => resolve('aborted'));
            req.end();
        });

        expect(outcome).toBe('aborted');
    });
});
