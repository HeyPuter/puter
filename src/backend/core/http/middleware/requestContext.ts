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

import { v4 as uuidv4 } from 'uuid';
import type { RequestHandler } from 'express';
import { runWithContext } from '../../context';
import '../expressAugmentation';

/**
 * Wraps the remaining middleware + handler chain in a per-request
 * `AsyncLocalStorage` scope.
 *
 * Install order in `PuterServer#installGlobalMiddleware`:
 *
 *     body parsers  →  authProbe  →  **requestContext**  →  routes
 *
 * Running AFTER the auth probe means `req.actor` is already populated
 * when we snapshot it into the context. Everything downstream — gates,
 * per-route parsers, controller handlers, and any services they call —
 * runs inside the ALS scope and can reach the context via
 * `Context.get('actor')`, `Context.get('req')`, etc.
 */
export const createRequestContextMiddleware = (): RequestHandler => {
    return (req, _res, next) => {
        runWithContext(
            {
                actor: req.actor,
                req,
                requestId: uuidv4(),
            },
            () => next(),
        );
    };
};
