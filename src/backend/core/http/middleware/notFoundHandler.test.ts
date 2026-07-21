/**
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

import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { isHttpError } from '../HttpError';
import { createNotFoundHandler } from './notFoundHandler';

const makeReq = (over: Partial<Request> = {}): Request =>
    ({
        method: 'GET',
        hostname: 'puter.example',
        path: '/no-such-page',
        ...over,
    }) as Request;

const makeRes = () => ({
    status: vi.fn(),
    json: vi.fn(),
    redirect: vi.fn(),
});

const expect404 = (next: ReturnType<typeof vi.fn>) => {
    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0][0];
    expect(isHttpError(err)).toBe(true);
    expect(err.statusCode).toBe(404);
    expect(err.legacyCode).toBe('not_found');
};

describe('createNotFoundHandler', () => {
    it("forwards an HttpError(404, 'not_found') to next() — does not write the response itself", () => {
        // The handler must NOT call res.json/status — that's the error
        // handler's job, so every failure goes through the same serializer.
        const handler = createNotFoundHandler();
        const next = vi.fn();
        const res = makeRes();
        handler(makeReq(), res as unknown as Response, next);

        expect404(next);
        // Never wrote a response directly.
        expect(res.status).not.toHaveBeenCalled();
        expect(res.json).not.toHaveBeenCalled();
        expect(res.redirect).not.toHaveBeenCalled();
    });

    describe('with guiDomain set', () => {
        const handler = createNotFoundHandler({ guiDomain: 'puter.example' });

        it('redirects an unmatched GET on the GUI domain to /', () => {
            const next = vi.fn();
            const res = makeRes();
            handler(makeReq(), res as unknown as Response, next);

            expect(res.redirect).toHaveBeenCalledWith('/');
            expect(next).not.toHaveBeenCalled();
        });

        it('redirects HEAD like GET', () => {
            const next = vi.fn();
            const res = makeRes();
            handler(
                makeReq({ method: 'HEAD' }),
                res as unknown as Response,
                next,
            );

            expect(res.redirect).toHaveBeenCalledWith('/');
            expect(next).not.toHaveBeenCalled();
        });

        it('still 404s non-GET methods on the GUI domain', () => {
            const next = vi.fn();
            const res = makeRes();
            handler(
                makeReq({ method: 'POST' }),
                res as unknown as Response,
                next,
            );

            expect404(next);
            expect(res.redirect).not.toHaveBeenCalled();
        });

        it('still 404s on subdomains (api., etc.)', () => {
            const next = vi.fn();
            const res = makeRes();
            handler(
                makeReq({ hostname: 'api.puter.example' }),
                res as unknown as Response,
                next,
            );

            expect404(next);
            expect(res.redirect).not.toHaveBeenCalled();
        });

        it('never redirects / to itself', () => {
            const next = vi.fn();
            const res = makeRes();
            handler(makeReq({ path: '/' }), res as unknown as Response, next);

            expect404(next);
            expect(res.redirect).not.toHaveBeenCalled();
        });
    });
});
