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

import type { Request } from 'express';
import { HttpError } from './HttpError';

/** The parsed body as a plain object; 400 when it is missing or not one. */
export const bodyRecord = (req: Request): Record<string, unknown> => {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new HttpError(400, 'body must be an object', {
            legacyCode: 'bad_request',
        });
    }
    return body as Record<string, unknown>;
};
