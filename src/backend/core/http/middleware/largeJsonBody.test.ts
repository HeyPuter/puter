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
// so the parsers call straight through, leaving any preset `body` in place.
const makeReq = (
    bytes: number | undefined,
    user: string | null = 'u1',
    body?: unknown,
) =>
    ({
        complete: true,
        body,
        headers: {
            'content-type': 'application/json',
            ...(bytes === undefined ? {} : { 'content-length': String(bytes) }),
            ...(user ? { authorization: user } : {}),
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
        (req as { actor?: unknown }).actor = {
            user: { uuid: req.headers.authorization },
        };
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

const statusOf = (err: unknown) => (isHttpError(err) ? err.statusCode : err);

describe('createLargeJsonBodyParser', () => {
    const create = ({
        budgetBytes = 200 * MiB,
        perUserBytes = 128 * MiB,
        accepts,
    }: {
        budgetBytes?: number;
        perUserBytes?: number;
        accepts?: (req: Request) => boolean;
    } = {}) =>
        createLargeJsonBodyParser({
            authProbe,
            limitBytes: 128 * MiB,
            budgetBytes,
            perUserBytes,
            accepts,
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
        const mw = create({ budgetBytes: 60 * MiB });
        const { err } = await run(mw, makeReq(60 * MiB, null));
        expect(err).toBeUndefined();
        // Nothing was charged, so a signed-in caller still fits.
        expect((await run(mw, makeReq(60 * MiB))).err).toBeUndefined();
    });

    it('charges nothing for a client that left during the probe', async () => {
        const mw = create({ budgetBytes: 60 * MiB });
        const gone = Object.assign(makeRes(), { closed: true });
        expect((await run(mw, makeReq(60 * MiB), gone)).err).toBeUndefined();
        expect((await run(mw, makeReq(60 * MiB))).err).toBeUndefined();
    });

    it('refuses with 503 past the budget until a response closes', async () => {
        const mw = create({ budgetBytes: 130 * MiB });
        const first = await run(mw, makeReq(60 * MiB, 'u1'));
        await run(mw, makeReq(60 * MiB, 'u2'));

        const refused = await run(mw, makeReq(60 * MiB, 'u3'));
        expect(statusOf(refused.err)).toBe(503);
        // Load shedding is recorded, not paged.
        expect(isHttpError(refused.err) && refused.err.alarmSeverity).toBe(
            'info',
        );
        expect(refused.res.setHeader).toHaveBeenCalledWith('Retry-After', '5');

        first.res.emit('close');
        expect((await run(mw, makeReq(60 * MiB, 'u3'))).err).toBeUndefined();
    });

    it("refuses one user's bodies with 429 past their share", async () => {
        const mw = create({ perUserBytes: 100 * MiB });
        const first = await run(mw, makeReq(60 * MiB, 'u1'));

        const refused = await run(mw, makeReq(60 * MiB, 'u1'));
        expect(statusOf(refused.err)).toBe(429);
        expect(refused.res.setHeader).toHaveBeenCalledWith('Retry-After', '5');
        // Another user isn't held back by it.
        expect((await run(mw, makeReq(60 * MiB, 'u2'))).err).toBeUndefined();

        first.res.emit('close');
        expect((await run(mw, makeReq(60 * MiB, 'u1'))).err).toBeUndefined();
    });

    it('refuses with 413 a parsed body `accepts` turns down', async () => {
        const mw = create({
            accepts: (req) => (req.body as { ok?: boolean }).ok === true,
        });
        const refused = await run(mw, makeReq(60 * MiB, 'u1', { ok: false }));
        expect(statusOf(refused.err)).toBe(413);
        expect(
            (await run(mw, makeReq(60 * MiB, 'u2', { ok: true }))).err,
        ).toBeUndefined();
    });
});
