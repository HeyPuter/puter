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

import { request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { setImmediate as nextTurn } from 'node:timers/promises';
import express, {
    type ErrorRequestHandler,
    type RequestHandler,
} from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createJsonBodyParser } from './jsonBody';
import {
    createLargeJsonBodyParser,
    DEFAULT_JSON_LIMIT_BYTES,
} from './largeJsonBody';

const MiB = 1024 * 1024;
const TOKEN = 'valid-token';
const PAD = 'x'.repeat(DEFAULT_JSON_LIMIT_BYTES);

/** Stands in for the auth probe: one token is valid, wherever it is sent. */
const authProbe: RequestHandler = (req, _res, next) => {
    const token =
        (req.body as { auth_token?: string } | undefined)?.auth_token ??
        req.headers.authorization;
    if (!req.actor && token === TOKEN) {
        req.actor = { user: { uuid: 'u1' } } as typeof req.actor;
    }
    next();
};

describe('a JSON body over the default limit', () => {
    let server: Server;

    beforeAll(async () => {
        const app = express();
        app.post(
            '/call',
            createLargeJsonBodyParser({
                authProbe,
                limitBytes: 128 * MiB,
                budgetBytes: 256 * MiB,
                perUserBytes: 128 * MiB,
            }),
        );
        app.use(createJsonBodyParser({ limit: DEFAULT_JSON_LIMIT_BYTES }));
        app.use(authProbe);
        app.post('/call', (req, res) => {
            const body = req.body as { auth_token?: string; pad: string };
            res.json({
                user: req.actor?.user.uuid ?? null,
                token: body.auth_token ?? null,
                padLength: body.pad.length,
            });
        });
        const onError: ErrorRequestHandler = (err, _req, res, _next) => {
            res.status(err.statusCode ?? 500).json({});
        };
        app.use(onError);
        await new Promise<void>((resolve) => {
            server = app.listen(0, '127.0.0.1', resolve);
        });
    });

    afterAll(() => {
        server?.close();
    });

    /** Sends `chunks` one write at a time, so the server sees them apart. */
    const post = (chunks: string[], headers: Record<string, string> = {}) =>
        new Promise<{ status: number; answer: Record<string, unknown> }>(
            (resolve, reject) => {
                const { port } = server.address() as AddressInfo;
                const req = request(
                    {
                        host: '127.0.0.1',
                        port,
                        path: '/call',
                        method: 'POST',
                        headers: {
                            'Content-Type': 'text/plain;actually=json',
                            'Content-Length': chunks.reduce(
                                (total, chunk) =>
                                    total + Buffer.byteLength(chunk),
                                0,
                            ),
                            ...headers,
                        },
                    },
                    (res) => {
                        const parts: Buffer[] = [];
                        res.on('data', (part: Buffer) => parts.push(part));
                        res.on('end', () =>
                            resolve({
                                status: res.statusCode!,
                                answer: JSON.parse(
                                    Buffer.concat(parts).toString(),
                                ),
                            }),
                        );
                    },
                );
                req.on('error', reject);
                void (async () => {
                    for (const chunk of chunks) {
                        req.write(chunk);
                        await nextTurn();
                    }
                    req.end();
                })();
            },
        );

    it('is accepted when it opens with a valid auth_token', async () => {
        const { status, answer } = await post([
            `{"auth_token":"${TOKEN}","pad":"${PAD}"}`,
        ]);
        expect(status).toBe(200);
        expect(answer).toEqual({
            user: 'u1',
            token: TOKEN,
            padLength: PAD.length,
        });
    }, 60_000);

    it('is accepted when the token arrives in pieces, with spacing', async () => {
        const opening = ` {\n  "auth_token" : "${TOKEN}" ,`;
        const { status, answer } = await post([...opening, `"pad":"${PAD}"}`]);
        expect(status).toBe(200);
        expect(answer.user).toBe('u1');
    }, 60_000);

    it('is accepted with a header credential, as before', async () => {
        const { status, answer } = await post([`{"pad":"${PAD}"}`], {
            Authorization: TOKEN,
        });
        expect(status).toBe(200);
        expect(answer).toEqual({
            user: 'u1',
            token: null,
            padLength: PAD.length,
        });
    }, 60_000);

    it.each([
        [
            'its token comes after other fields',
            `{"pad":"${PAD}","auth_token":"${TOKEN}"}`,
        ],
        ['its token is not valid', `{"auth_token":"expired","pad":"${PAD}"}`],
        ['it has no token', `{"pad":"${PAD}"}`],
        [
            'a later field replaces the token it opens with',
            `{"auth_token":"${TOKEN}","pad":"${PAD}","auth_token":"other"}`,
        ],
        [
            'the token it opens with is nested',
            `{"args":{"auth_token":"${TOKEN}"},"pad":"${PAD}"}`,
        ],
    ])(
        'is refused with 413 when %s',
        async (_name, body) => {
            expect((await post([body])).status).toBe(413);
        },
        60_000,
    );
});
