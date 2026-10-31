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

import { EventEmitter } from 'node:events';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { isHttpError } from '../HttpError';
import {
    createLargeJsonBodyParser,
    DEFAULT_JSON_LIMIT_BYTES,
} from './largeJsonBody';

const MiB = 1024 * 1024;

// A complete request with no socket reads as already consumed to body-parser,
// so the parsers call straight through; these tests are about admission.
const makeReq = (bytes: number | undefined, signedIn = true) =>
    ({
        complete: true,
        headers: {
            'content-type': 'application/json',
            ...(bytes === undefined ? {} : { 'content-length': String(bytes) }),
            ...(signedIn ? { authorization: 'Bearer t' } : {}),
        },
    }) as unknown as Request;

const makeRes = () => {
    const res = new EventEmitter() as EventEmitter & {
        setHeader: ReturnType<typeof vi.fn>;
    };
    res.setHeader = vi.fn();
    return res;
};

const authProbe = vi.fn<RequestHandler>((req, _res, next) => {
    if (req.headers.authorization) {
        (req as { actor?: unknown }).actor = { user: { uuid: 'u' } };
    }
    next();
});

const run = (mw: RequestHandler, req: Request, res = makeRes()) =>
    new Promise<{ err: unknown; res: ReturnType<typeof makeRes> }>(
        (resolve) => {
            mw(
                req,
                res as unknown as Response,
                ((err?: unknown) => resolve({ err, res })) as NextFunction,
            );
        },
    );

describe('createLargeJsonBodyParser', () => {
    const create = (budgetBytes = 200 * MiB) =>
        createLargeJsonBodyParser({
            authProbe,
            limitBytes: 128 * MiB,
            budgetBytes,
        });

    it.each([
        ['no Content-Length', undefined],
        ['a body within the default limit', DEFAULT_JSON_LIMIT_BYTES],
        ['a body over the large limit', 128 * MiB + 1],
    ])('leaves %s to the global parser without probing', async (_, bytes) => {
        authProbe.mockClear();
        const { err } = await run(create(), makeReq(bytes));
        expect(err).toBeUndefined();
        expect(authProbe).not.toHaveBeenCalled();
    });

    it('leaves an unauthenticated large body to the global parser', async () => {
        const mw = create(60 * MiB);
        const { err } = await run(mw, makeReq(60 * MiB, false));
        expect(err).toBeUndefined();
        // Nothing was charged, so a signed-in caller still fits.
        expect((await run(mw, makeReq(60 * MiB))).err).toBeUndefined();
    });

    it('charges nothing for a client that left during the probe', async () => {
        const mw = create(60 * MiB);
        const gone = Object.assign(makeRes(), { closed: true });
        expect((await run(mw, makeReq(60 * MiB), gone)).err).toBeUndefined();
        expect((await run(mw, makeReq(60 * MiB))).err).toBeUndefined();
    });

    it('refuses with 503 past the budget until a response closes', async () => {
        const mw = create(130 * MiB);
        const first = await run(mw, makeReq(60 * MiB));
        await run(mw, makeReq(60 * MiB));

        const refused = await run(mw, makeReq(60 * MiB));
        expect(isHttpError(refused.err) && refused.err.statusCode).toBe(503);
        expect(refused.res.setHeader).toHaveBeenCalledWith('Retry-After', '5');

        first.res.emit('close');
        expect((await run(mw, makeReq(60 * MiB))).err).toBeUndefined();
    });
});
