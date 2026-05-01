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

export { HttpError, isHttpError, type HttpErrorOptions } from './HttpError';
export { PuterRouter } from './PuterRouter';
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
export {
    DEFAULT_ADMIN_USERNAMES,
    adminOnlyGate,
    allowedAppIdsGate,
    requireAuthGate,
    requireUserActorGate,
    subdomainGate,
} from './middleware/gates';
export { createErrorHandler } from './middleware/errorHandler';
export { createNotFoundHandler } from './middleware/notFoundHandler';
