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

import { createServer, get, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pipeStreamResult } from './pipeStreamResult.js';
import { upstreamBodyStream } from './upstreamErrors.js';

let server: Server | undefined;
afterEach(async () => {
    vi.restoreAllMocks();
    server?.closeAllConnections();
    await new Promise((resolve) => server?.close(resolve) ?? resolve(null));
    server = undefined;
});

/** Serves `source()` through pipeStreamResult and reads it as a client. */
const fetchThrough = async (
    source: () => Readable,
    onFirstChunk?: () => void,
): Promise<{ body: string; outcome: 'end' | 'aborted' }> => {
    server = createServer((_req, res) => {
        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Transfer-Encoding', 'chunked');
        pipeStreamResult(source(), res, 'test.run');
    });
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    return new Promise((resolve) => {
        get(`http://127.0.0.1:${port}/`, (res) => {
            const chunks: Buffer[] = [];
            let settled = false;
            const done = (outcome: 'end' | 'aborted') => {
                if (settled) return;
                settled = true;
                resolve({ body: Buffer.concat(chunks).toString(), outcome });
            };
            res.on('data', (c: Buffer) => {
                if (chunks.push(c) === 1) onFirstChunk?.();
            });
            res.on('end', () => done('end'));
            res.on('aborted', () => done('aborted'));
            res.on('error', () => done('aborted'));
        });
    });
};

describe('pipeStreamResult', () => {
    it('delivers a healthy stream and ends the response', async () => {
        const result = await fetchThrough(() => Readable.from(['a', 'b']));
        expect(result).toEqual({ body: 'ab', outcome: 'end' });
    });

    it('aborts the transfer, logging once and staying up, when the upstream body fails after the first chunk', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const uncaught = vi.fn();
        process.on('uncaughtException', uncaught);
        let upstream!: ReadableStreamDefaultController<Uint8Array>;
        try {
            const result = await fetchThrough(
                () => {
                    const body = new ReadableStream<Uint8Array>({
                        start(controller) {
                            upstream = controller;
                            controller.enqueue(Buffer.from('first'));
                        },
                    });
                    return upstreamBodyStream(new Response(body));
                },
                () => upstream.error(new Error('connection reset')),
            );

            expect(result).toEqual({ body: 'first', outcome: 'aborted' });
            expect(warn).toHaveBeenCalledTimes(1);
            expect(String(warn.mock.calls[0]![0])).toContain('test.run');
            expect(uncaught).not.toHaveBeenCalled();
        } finally {
            process.off('uncaughtException', uncaught);
        }
    });

    it('stops the source, without logging, when the client hangs up', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        let source!: Readable;
        let pulls = 0;
        server = createServer((_req, res) => {
            source = new Readable({
                read() {
                    pulls += 1;
                    this.push(Buffer.alloc(64 * 1024));
                },
            });
            pipeStreamResult(source, res, 'test.run');
        });
        await new Promise<void>((resolve) => server!.listen(0, resolve));
        const { port } = server.address() as AddressInfo;
        await new Promise<void>((resolve) => {
            const req = get(`http://127.0.0.1:${port}/`, (res) => {
                res.once('data', () => {
                    req.destroy();
                    resolve();
                });
            });
            req.on('error', () => {});
        });

        await vi.waitFor(() => expect(source.destroyed).toBe(true));
        const pullsAtClose = pulls;
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(pulls).toBe(pullsAtClose);
        expect(warn).not.toHaveBeenCalled();
    });
});
