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
import type { PuterRouter } from './PuterRouter';
import {
    PREFIX_METADATA_KEY,
    ROUTES_METADATA_KEY,
    type CollectedRoute,
    type RouteMethod,
    type RouteOptions,
    type RoutePath,
} from './types';

/**
 * Decorator-style route registration for controllers that prefer annotations
 * over imperative `registerRoutes(router)` bodies.
 *
 * Stage-3 decorators (TS 5+), matching the extensionController pattern. Every
 * method decorator pushes a `CollectedRoute` onto `prototype.__puterRoutes`
 * during class initialization. `@Controller` seals the deal by installing a
 * `registerRoutes` method on the prototype that walks the collected routes and
 * feeds them to the `PuterRouter` passed in by `PuterServer`.
 *
 * Usage is optional — imperative controllers that override `registerRoutes`
 * directly work equally well.
 */

// -- Prototype shape helpers -----------------------------------------

interface DecoratedPrototype {
    [ROUTES_METADATA_KEY]?: CollectedRoute[];
    [PREFIX_METADATA_KEY]?: string;
    registerRoutes?: (router: PuterRouter) => void;
}

const getOrInitRoutes = (proto: DecoratedPrototype): CollectedRoute[] => {
    if (!proto[ROUTES_METADATA_KEY]) {
        proto[ROUTES_METADATA_KEY] = [];
    }
    return proto[ROUTES_METADATA_KEY]!;
};

// -- @Controller -----------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyCtor = new (...args: any[]) => any;

/**
 * Class decorator. Stores `prefix` on the prototype for `PuterServer`, and
 * installs a default `registerRoutes` that walks decorator-collected routes
 * unless the class defines its own.
 */
export function Controller(prefix: string = '') {
    return <T extends AnyCtor>(
        value: T,
        _context: ClassDecoratorContext<T>,
    ): void => {
        const proto = value.prototype as DecoratedPrototype;
        proto[PREFIX_METADATA_KEY] = prefix;

        // Own property only, so a base-class default doesn't block the walker.
        const hasOwnRegister = Object.prototype.hasOwnProperty.call(
            proto,
            'registerRoutes',
        );
        if (hasOwnRegister) return;

        proto.registerRoutes = function (router: PuterRouter): void {
            const routes = ((this as DecoratedPrototype)[ROUTES_METADATA_KEY] ??
                []) as CollectedRoute[];
            for (const r of routes) {
                const bound = r.handler.bind(this) as RequestHandler;
                if (r.method === 'use') {
                    if (r.path !== undefined) {
                        router.use(r.path, r.options, bound);
                    } else {
                        router.use(r.options, bound);
                    }
                    continue;
                }
                if (r.path === undefined) {
                    // A non-use method without a path is a mistake in the decorator
                    // call site; surface it loudly rather than silently dropping.
                    throw new Error(
                        `@${r.method.toUpperCase()} decorator missing path`,
                    );
                }
                // Delegate to the appropriately-named method on the router.
                // The method set is enumerated in `RouteMethod` so this cast is safe.
                const routerMethod = router[
                    r.method as Exclude<RouteMethod, 'use'>
                ] as (
                    path: RoutePath,
                    options: RouteOptions,
                    handler: RequestHandler,
                ) => PuterRouter;
                routerMethod.call(router, r.path, r.options, bound);
            }
        };
    };
}

// -- Method decorators (@Get, @Post, ...) ---------------------------

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
type AnyMethod = Function;

const createMethodDecorator = (method: Exclude<RouteMethod, 'use'>) => {
    return (path: RoutePath, options: RouteOptions = {}) => {
        return (
            target: AnyMethod,
            context: ClassMethodDecoratorContext,
        ): void => {
            context.addInitializer(function () {
                const proto = Object.getPrototypeOf(
                    this as object,
                ) as DecoratedPrototype;
                const routes = getOrInitRoutes(proto);
                // Initializers run once per *instance* but collect onto the
                // shared prototype, so a process that builds a second server
                // (every multi-server test file) would otherwise register
                // every route twice. The decorated method and the path literal
                // are the same references each time, so identity recognizes a
                // repeat without comparing option objects.
                const already = routes.some(
                    (r) =>
                        r.handler === (target as unknown as RequestHandler) &&
                        r.method === method &&
                        r.path === path,
                );
                if (already) return;
                routes.push({
                    method,
                    path,
                    options,
                    handler: target as unknown as RequestHandler,
                });
            });
        };
    };
};

export const All = createMethodDecorator('all');
export const Get = createMethodDecorator('get');
export const Head = createMethodDecorator('head');
export const Post = createMethodDecorator('post');
export const Put = createMethodDecorator('put');
export const Delete = createMethodDecorator('delete');
export const Patch = createMethodDecorator('patch');
export const Options = createMethodDecorator('options');
export const Lock = createMethodDecorator('lock');
export const Unlock = createMethodDecorator('unlock');
export const Propfind = createMethodDecorator('propfind');
export const Proppatch = createMethodDecorator('proppatch');
export const Mkcol = createMethodDecorator('mkcol');
export const Copy = createMethodDecorator('copy');
export const Move = createMethodDecorator('move');
