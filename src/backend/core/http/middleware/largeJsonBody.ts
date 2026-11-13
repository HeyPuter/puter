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

import type { Request, RequestHandler, Response } from 'express';
import { actorUid } from '../../actor';
import { HttpError } from '../HttpError';
import { createJsonBodyParser } from './jsonBody';

/** The global JSON parser's limit, which applies before auth. */
export const DEFAULT_JSON_LIMIT_BYTES = 50 * 1024 * 1024;

/** How much of a body is read to find a token it opens with. */
const LEADING_TOKEN_BYTES = 8 * 1024;
const LEADING_TOKEN =
    /^[ \t\n\r]*\{[ \t\n\r]*"auth_token"[ \t\n\r]*:[ \t\n\r]*"([^"\\]+)"/;

/**
 * The first `bytes` of the body, put back for the parser to read. Empty when
 * the body ends or fails before that many arrive.
 */
const peekBody = (req: Request, bytes: number): Promise<Buffer> =>
    new Promise((resolve) => {
        const settle = (head: Buffer | null) => {
            req.off('readable', onReadable);
            req.off('end', onGone);
            req.off('close', onGone);
            req.off('error', onGone);
            if (head) req.unshift(head);
            resolve(head ?? Buffer.alloc(0));
        };
        const onReadable = () => {
            // Null until `bytes` are buffered.
            const head = req.read(bytes) as Buffer | null;
            if (head) settle(head);
        };
        const onGone = () => settle(null);
        req.on('readable', onReadable);
        req.on('end', onGone);
        req.on('close', onGone);
        req.on('error', onGone);
    });

/**
 * The `auth_token` a JSON body opens with, which puter.js sends first so it can
 * be read ahead of the body.
 */
const leadingBodyToken = async (req: Request): Promise<string | undefined> => {
    const head = await peekBody(req, LEADING_TOKEN_BYTES);
    return LEADING_TOKEN.exec(head.toString('latin1'))?.[1];
};

interface LargeJsonBodyOptions {
    /** The global auth probe; it skips requests that already carry an actor. */
    authProbe: RequestHandler;
    limitBytes: number;
    /** Declared bytes of large bodies a process holds at once. */
    budgetBytes: number;
    /** Declared bytes of large bodies one user holds at once. */
    perUserBytes: number;
    /** Checked once the body is parsed; a body it refuses gets a 413. */
    accepts?: (req: Request) => boolean;
}

/**
 * Parses JSON bodies over the default limit, up to `limitBytes`, once the
 * caller's credential resolves: a header, a cookie, or an `auth_token` the body
 * opens with. Unauthenticated requests and requests without a Content-Length
 * fall through to the global parser and its limit.
 *
 * The parsed body lives as long as the request, so a body's bytes count against
 * both budgets until its response closes. Over the user's budget gets a 429,
 * over the process budget a 503.
 */
export const createLargeJsonBodyParser = ({
    authProbe,
    limitBytes,
    budgetBytes,
    perUserBytes,
    accepts,
}: LargeJsonBodyOptions): RequestHandler => {
    const json = createJsonBodyParser({ limit: limitBytes });
    let inFlightBytes = 0;
    const inFlightByUser = new Map<string, number>();

    const probe = (req: Request, res: Response) =>
        new Promise<void>((resolve) => {
            void authProbe(req, res, () => resolve());
        });

    return async (req, res, next) => {
        const declared = Number(req.headers['content-length']);
        if (!(declared > DEFAULT_JSON_LIMIT_BYTES && declared <= limitBytes)) {
            next();
            return;
        }
        await probe(req, res);
        let bodyToken: string | undefined;
        if (!req.actor && !res.closed) {
            bodyToken = await leadingBodyToken(req);
            if (bodyToken) {
                // Where the probe looks for a body token.
                req.body = { auth_token: bodyToken };
                await probe(req, res);
                req.body = undefined;
            }
        }
        // `res.closed`: the client left during the probe, so `close` has
        // already fired and would never release a charge.
        if (!req.actor || res.closed) {
            next();
            return;
        }
        const user = req.actor.user.uuid ?? actorUid(req.actor);
        const userBytes = inFlightByUser.get(user) ?? 0;
        if (userBytes + declared > perUserBytes) {
            res.setHeader('Retry-After', '5');
            next(
                new HttpError(
                    429,
                    'Too many large requests in progress for this account',
                    { legacyCode: 'too_many_requests' },
                ),
            );
            return;
        }
        if (inFlightBytes + declared > budgetBytes) {
            res.setHeader('Retry-After', '5');
            next(
                new HttpError(503, 'Too many large requests in progress', {
                    code: 'large_body_capacity',
                    // Load shedding, not a fault: record it, don't page.
                    alarmSeverity: 'info',
                }),
            );
            return;
        }
        inFlightBytes += declared;
        inFlightByUser.set(user, userBytes + declared);
        res.once('close', () => {
            inFlightBytes -= declared;
            const left = (inFlightByUser.get(user) ?? 0) - declared;
            if (left > 0) inFlightByUser.set(user, left);
            else inFlightByUser.delete(user);
        });
        json(req, res, (err?: unknown) => {
            if (err) {
                next(err);
                return;
            }
            // The caller was resolved from the token the body opens with,
            // so the parsed body has to name the same one.
            const tokenMoved =
                bodyToken !== undefined &&
                (req.body as { auth_token?: unknown } | undefined)
                    ?.auth_token !== bodyToken;
            if (tokenMoved || (accepts && !accepts(req))) {
                // The same answer the default limit gives.
                next(
                    new HttpError(413, 'request entity too large', {
                        legacyCode: 'client_bad_request',
                    }),
                );
                return;
            }
            next();
        });
    };
};
