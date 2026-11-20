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

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { brotliCompressSync, deflateSync, gzipSync } from 'node:zlib';
import express, {
    type ErrorRequestHandler,
    type RequestHandler,
} from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SLICE_BYTES } from '../../../util/slicedJson';
import { createJsonBodyParser } from './jsonBody';

const LIMIT = 4 * 1024 * 1024;
const TEXT_AS_JSON = 'text/plain;actually=json';

type Verify = NonNullable<Parameters<typeof express.json>[0]>['verify'];
const captureRawBody: Verify = (req, _res, buf) => {
    (req as { rawBody?: Buffer }).rawBody = buf;
};

/** An app that answers with what its parsers left on the request. */
const listen = (parsers: RequestHandler[]): Promise<Server> => {
    const app = express();
    app.use(...parsers);
    app.post('/', (req, res) => {
        const rawBody = (req as { rawBody?: Buffer }).rawBody;
        res.json({
            body: req.body,
            hasBody: req.body !== undefined,
            rawBody: rawBody?.toString('base64'),
        });
    });
    const onError: ErrorRequestHandler = (err, _req, res, _next) => {
        res.status(err.statusCode ?? 500).json({ type: err.type });
    };
    app.use(onError);
    return new Promise((resolve) => {
        const server = app.listen(0, '127.0.0.1', () => resolve(server));
    });
};

describe('createJsonBodyParser', () => {
    let sliced: Server;
    let framework: Server;

    beforeAll(async () => {
        sliced = await listen([
            createJsonBodyParser({ limit: LIMIT, verify: captureRawBody }),
        ]);
        // What the server ran before: one parser per content type.
        framework = await listen([
            express.json({ limit: LIMIT, verify: captureRawBody }),
            express.json({
                limit: LIMIT,
                type: (req) => req.headers['content-type'] === TEXT_AS_JSON,
                verify: captureRawBody,
            }),
        ]);
    });

    afterAll(() => {
        sliced?.close();
        framework?.close();
    });

    const post = async (
        server: Server,
        body: string | Buffer | undefined,
        headers: Record<string, string>,
    ) => {
        const { port } = server.address() as AddressInfo;
        const response = await fetch(`http://127.0.0.1:${port}/`, {
            method: 'POST',
            headers,
            body,
        });
        return { status: response.status, answer: await response.json() };
    };

    const large = `${JSON.stringify({
        text: 'é😀 "quoted" \\ line\n'.repeat(SLICE_BYTES / 8),
        list: Array.from({ length: 20_000 }, (_, i) => ({
            i,
            on: i % 2 === 0,
        })),
    }).slice(0, -1)},"__proto__":{"nested":true}}`;

    it.each<[string, string | Buffer | undefined, Record<string, string>]>([
        ['an object', '{"a":1}', { 'Content-Type': 'application/json' }],
        ['an array', '[1,2]', { 'Content-Type': 'application/json' }],
        [
            'a body sent as text',
            '{"interface":"x","auth_token":"t"}',
            { 'Content-Type': TEXT_AS_JSON },
        ],
        ['a large body', large, { 'Content-Type': 'application/json' }],
        ['a large body sent as text', large, { 'Content-Type': TEXT_AS_JSON }],
        [
            'a charset parameter',
            large,
            { 'Content-Type': 'application/json; charset=UTF-8' },
        ],
        [
            'a quoted charset parameter',
            '{"a":"é"}',
            { 'Content-Type': 'application/json;charset="utf-8"' },
        ],
        [
            'another parameter',
            '{"a":1}',
            { 'Content-Type': 'application/json; profile=x' },
        ],
        ['an empty body', '', { 'Content-Type': 'application/json' }],
        ['no body', undefined, { 'Content-Type': 'application/json' }],
        [
            'a byte order mark',
            `\ufeff${large}`,
            { 'Content-Type': 'application/json' },
        ],
        [
            'only a byte order mark',
            '\ufeff',
            { 'Content-Type': 'application/json' },
        ],
        ['only whitespace', '  \n', { 'Content-Type': 'application/json' }],
        ['a bare string', '"text"', { 'Content-Type': 'application/json' }],
        ['a bare number', ' 12', { 'Content-Type': 'application/json' }],
        ['null', 'null', { 'Content-Type': 'application/json' }],
        ['malformed JSON', '{"a":', { 'Content-Type': 'application/json' }],
        [
            'malformed large JSON',
            `${large.slice(0, -1)},]`,
            { 'Content-Type': 'application/json' },
        ],
        [
            'a large bare string',
            JSON.stringify('x'.repeat(4 * SLICE_BYTES)),
            { 'Content-Type': 'application/json' },
        ],
        [
            'invalid UTF-8',
            Buffer.concat([
                Buffer.from('{"a":"'),
                Buffer.from([0xff, 0xe2, 0x82]),
                Buffer.from('"}'),
            ]),
            { 'Content-Type': 'application/json' },
        ],
        [
            'a body over the limit',
            `["${'x'.repeat(LIMIT)}"]`,
            { 'Content-Type': 'application/json' },
        ],
        [
            'a gzipped body',
            gzipSync(large),
            { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' },
        ],
        [
            'a deflated body',
            deflateSync(large),
            {
                'Content-Type': 'application/json',
                'Content-Encoding': 'deflate',
            },
        ],
        [
            'a brotli body',
            brotliCompressSync(large),
            { 'Content-Type': 'application/json', 'Content-Encoding': 'br' },
        ],
        [
            'a body that inflates past the limit',
            gzipSync(`["${'x'.repeat(LIMIT)}"]`),
            { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' },
        ],
        [
            'an unknown content encoding',
            '{"a":1}',
            { 'Content-Type': 'application/json', 'Content-Encoding': 'lzw' },
        ],
        ['plain text', '{"a":1}', { 'Content-Type': 'text/plain' }],
        [
            'text with the marker and a charset',
            '{"a":1}',
            { 'Content-Type': `${TEXT_AS_JSON}; charset=utf-8` },
        ],
        [
            'a JSON-suffixed type',
            '{"a":1}',
            { 'Content-Type': 'application/vnd.api+json' },
        ],
        [
            'form data',
            'a=1',
            { 'Content-Type': 'application/x-www-form-urlencoded' },
        ],
        ['no content type', '{"a":1}', { 'Content-Type': '' }],
    ])('answers %s the way express.json does', async (_name, body, headers) => {
        const got = await post(sliced, body, headers);
        const want = await post(framework, body, headers);
        expect(got).toEqual(want);
    });

    it('leaves a body in another charset unread', async () => {
        for (const charset of ['utf-16', 'utf8', 'latin1']) {
            const { status, answer } = await post(
                sliced,
                Buffer.from('{"a":1}', 'utf16le'),
                { 'Content-Type': `application/json; charset=${charset}` },
            );
            expect(status).toBe(200);
            expect(answer.hasBody).toBe(false);
        }
        // The last charset named is the one that counts.
        const { answer } = await post(sliced, '{"a":1}', {
            'Content-Type': 'application/json; charset=utf-8; charset=utf-16',
        });
        expect(answer.hasBody).toBe(false);
    });

    it('parses bodies that arrive together, each to its own result', async () => {
        const bodies = Array.from({ length: 6 }, (_, n) =>
            JSON.stringify({ n, pad: 'x'.repeat((n + 1) * SLICE_BYTES) }),
        );
        const answers = await Promise.all(
            bodies.map((body) =>
                post(sliced, body, { 'Content-Type': 'application/json' }),
            ),
        );
        answers.forEach(({ status, answer }, n) => {
            expect(status).toBe(200);
            expect(answer.body).toEqual(JSON.parse(bodies[n]!));
        });
        // A failed parse hands its turn on like a finished one.
        const mixed = await Promise.all([
            post(sliced, `${bodies[5]!},`, {
                'Content-Type': 'application/json',
            }),
            post(sliced, bodies[4], { 'Content-Type': 'application/json' }),
            post(sliced, bodies[3], { 'Content-Type': 'application/json' }),
        ]);
        expect(mixed.map(({ status }) => status)).toEqual([400, 200, 200]);
    });
});
