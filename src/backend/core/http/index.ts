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

export {
    All,
    Controller,
    Copy,
    Delete,
    Get,
    Head,
    Lock,
    Mkcol,
    Move,
    Options,
    Patch,
    Post,
    Propfind,
    Proppatch,
    Put,
    Unlock,
} from './decorators';
export { HttpError, isHttpError, type HttpErrorOptions } from './HttpError';
export { createErrorHandler } from './middleware/errorHandler';
export {
    adminOnlyGate,
    allowedAppIdsGate,
    DEFAULT_ADMIN_USERNAMES,
    requireAuthGate,
    requireUserActorGate,
    subdomainGate,
} from './middleware/gates';
export { createNotFoundHandler } from './middleware/notFoundHandler';
export { PuterRouter } from './PuterRouter';
export {
    PREFIX_METADATA_KEY,
    ROUTES_METADATA_KEY,
    type AuthRequired,
    type CollectedRoute,
    type RouteDescriptor,
    type RouteMethod,
    type RouteOptions,
    type RoutePath,
    type TypedHandler,
    type TypedRequest,
} from './types';
