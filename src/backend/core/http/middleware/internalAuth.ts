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

import type { RequestHandler } from 'express';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { HttpError } from '../HttpError';

export const INTERNAL_AUTH_HEADER = 'x-puter-internal-auth';

// Both sides are HMACed to a fixed-size digest under a per-process key, so the
// comparison is constant-time and leaks no length.
const COMPARE_KEY = randomBytes(32);
const secretsEqual = (a: string, b: string): boolean =>
    timingSafeEqual(
        createHmac('sha256', COMPARE_KEY).update(a).digest(),
        createHmac('sha256', COMPARE_KEY).update(b).digest(),
    );

/**
 * 403 unless the request carries the shared secret in `x-puter-internal-auth`.
 * Read per request; an unset secret refuses everything.
 */
export const internalAuthGate =
    (secret: () => string | undefined): RequestHandler =>
    (req, _res, next) => {
        const expected = secret();
        const offered = req.headers[INTERNAL_AUTH_HEADER];
        if (
            !expected ||
            typeof offered !== 'string' ||
            !secretsEqual(offered, expected)
        ) {
            next(new HttpError(403, 'Forbidden', { legacyCode: 'forbidden' }));
            return;
        }
        next();
    };
