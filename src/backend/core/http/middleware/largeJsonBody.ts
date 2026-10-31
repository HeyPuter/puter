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

import express, { type RequestHandler } from 'express';
import { HttpError } from '../HttpError';

/** The global JSON parser's limit, which applies before auth. */
export const DEFAULT_JSON_LIMIT_BYTES = 50 * 1024 * 1024;

interface LargeJsonBodyOptions {
    /** The global auth probe; it skips requests that already carry an actor. */
    authProbe: RequestHandler;
    limitBytes: number;
    /** Declared bytes of large bodies a process holds at once. */
    budgetBytes: number;
}

/**
 * Parses JSON bodies over the default limit, up to `limitBytes`, once the
 * caller's header or cookie credential resolves. Unauthenticated requests and
 * requests without a Content-Length fall through to the global parser and its
 * limit.
 *
 * The parsed body lives as long as the request, so a body's bytes count against
 * the budget until its response closes. Over budget gets a 503.
 */
export const createLargeJsonBodyParser = ({
    authProbe,
    limitBytes,
    budgetBytes,
}: LargeJsonBodyOptions): RequestHandler => {
    const json = express.json({ limit: limitBytes });
    const textAsJson = express.json({
        limit: limitBytes,
        type: (req) =>
            req.headers['content-type'] === 'text/plain;actually=json',
    });
    let inFlightBytes = 0;

    return (req, res, next) => {
        const declared = Number(req.headers['content-length']);
        if (!(declared > DEFAULT_JSON_LIMIT_BYTES && declared <= limitBytes)) {
            next();
            return;
        }
        void authProbe(req, res, () => {
            // `res.closed`: the client left during the probe, so `close` has
            // already fired and would never release a charge.
            if (!req.actor || res.closed) {
                next();
                return;
            }
            if (inFlightBytes + declared > budgetBytes) {
                res.setHeader('Retry-After', '5');
                next(
                    new HttpError(503, 'Too many large requests in progress', {
                        code: 'large_body_capacity',
                    }),
                );
                return;
            }
            inFlightBytes += declared;
            res.once('close', () => {
                inFlightBytes -= declared;
            });
            json(req, res, (err?: unknown) => {
                if (err) {
                    next(err);
                    return;
                }
                textAsJson(req, res, next);
            });
        });
    };
};
