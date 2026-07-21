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

import type { RequestHandler } from 'express';
import { HttpError } from '../HttpError';

export interface NotFoundHandlerOptions {
    /**
     * The bare GUI domain (`config.domain`). When set, unmatched GET/HEAD
     * requests whose host is exactly this domain redirect to `/` instead of
     * 404ing, so a typo'd or stale URL lands back on the desktop. Subdomains
     * (api., etc.) and custom domains are unaffected and still 404.
     */
    guiDomain?: string;
}

/**
 * Catch-all 404 middleware. Install last (just before the error handler);
 * any request that didn't match a route lands here.
 *
 * Throws an `HttpError(404)` rather than writing the response directly so
 * the same error-handler pipeline serializes the body — keeps the wire shape
 * consistent with every other failure (`{ error: '...', code: 'not_found' }`).
 */
export const createNotFoundHandler = (
    opts: NotFoundHandlerOptions = {},
): RequestHandler => {
    const guiDomain = opts.guiDomain?.trim().toLowerCase() || null;
    return (req, res, next): void => {
        if (
            guiDomain &&
            (req.method === 'GET' || req.method === 'HEAD') &&
            req.hostname?.toLowerCase() === guiDomain &&
            // '/' always matches the shell route; the guard just makes a
            // misconfigured deployment 404 instead of redirect-looping.
            req.path !== '/'
        ) {
            res.redirect('/');
            return;
        }
        next(new HttpError(404, 'Not Found', { legacyCode: 'not_found' }));
    };
};
