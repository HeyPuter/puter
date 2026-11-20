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

import express, { type Request, type RequestHandler } from 'express';
import { parseJsonInSlices, SLICE_BYTES } from '../../../util/slicedJson';

/** What puter.js labels a JSON driver call, to keep it a simple CORS request. */
const TEXT_AS_JSON = 'text/plain;actually=json';

const UTF8_CHARSET = /;\s*charset=("?)utf-8\1\s*(?:;|$)/i;

/** No charset, or exactly UTF-8. Anything else is left to `express.json`. */
const declaresUtf8 = (contentType: string): boolean => {
    const mentions = contentType.match(/charset/gi)?.length ?? 0;
    return mentions === 0 || (mentions === 1 && UTF8_CHARSET.test(contentType));
};

const isUtf8Json = (req: Request): boolean => {
    const contentType = req.headers['content-type'];
    if (contentType === TEXT_AS_JSON) return true;
    return (
        typeof contentType === 'string' &&
        Boolean(req.is('application/json')) &&
        declaresUtf8(contentType)
    );
};

/** The error `express.json` raises, which the error handler answers with a 400. */
const parseFailed = (message: string): Error =>
    Object.assign(new SyntaxError(message), {
        status: 400,
        statusCode: 400,
        expose: true,
        type: 'entity.parse.failed',
    });

const waiting: Array<() => void> = [];
let parsing = false;

/**
 * Bodies too large for one `JSON.parse` call parse one at a time, so a single
 * tree is under construction however many arrive together.
 */
const parseInTurn = async (body: Buffer): Promise<unknown> => {
    if (body.length <= SLICE_BYTES) return parseJsonInSlices(body);
    if (parsing) await new Promise<void>((resolve) => waiting.push(resolve));
    parsing = true;
    try {
        return await parseJsonInSlices(body);
    } finally {
        // Handing over keeps `parsing` set, so a new arrival can't cut in.
        const next = waiting.shift();
        if (next) next();
        else parsing = false;
    }
};

interface JsonBodyOptions {
    limit: number;
    verify?: NonNullable<Parameters<typeof express.raw>[0]>['verify'];
}

/**
 * `express.json` for UTF-8 bodies, with the parse done in slices so a large
 * body can't hold the event loop. Reading, limits, decompression and `verify`
 * are the framework's; the result and the errors match `express.json`.
 */
export const createJsonBodyParser = ({
    limit,
    verify,
}: JsonBodyOptions): RequestHandler => {
    const read = express.raw({
        limit,
        verify,
        type: (req) => isUtf8Json(req as Request),
    });

    return (req, res, next) => {
        read(req, res, async (err?: unknown) => {
            // Not a Buffer: the reader skipped this request.
            if (err || !Buffer.isBuffer(req.body)) {
                next(err);
                return;
            }
            let body: Buffer = req.body;
            req.body = undefined;
            // The framework's decoder drops a byte order mark.
            if (body[0] === 0xef && body[1] === 0xbb && body[2] === 0xbf) {
                body = body.subarray(3);
            }
            if (body.length === 0) {
                req.body = {};
                next();
                return;
            }
            let parsed: unknown;
            try {
                parsed = await parseInTurn(body);
            } catch (e) {
                next(parseFailed((e as Error).message));
                return;
            }
            if (typeof parsed !== 'object' || parsed === null) {
                next(parseFailed('JSON body must be an object or an array'));
                return;
            }
            req.body = parsed;
            next();
        });
    };
};
