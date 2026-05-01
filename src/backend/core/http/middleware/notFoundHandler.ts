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

/**
 * Catch-all 404 middleware. Install last (just before the error handler);
 * any request that didn't match a route lands here.
 *
 * Throws an `HttpError(404)` rather than writing the response directly so
 * the same error-handler pipeline serializes the body — keeps the wire shape
 * consistent with every other failure (`{ error: '...', code: 'not_found' }`).
 */
export const createNotFoundHandler = (): RequestHandler => {
    return (_req, _res, next): void => {
        next(new HttpError(404, 'Not Found', { legacyCode: 'not_found' }));
    };
};
