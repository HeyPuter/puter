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
 * `registerRoutes` method on the prototype that walks the collected routes
 * and feeds them to the `PuterRouter` passed in by `PuterServer`.
 *
 * Usage is optional — imperative controllers that override `registerRoutes`
 * directly work equally well.
 */

// ── Prototype shape helpers ─────────────────────────────────────────

interface DecoratedPrototype {
    [ROUTES_METADATA_KEY]?: CollectedRoute[];
    [PREFIX_METADATA_KEY]?: string;
    registerRoutes?: (router: PuterRouter) => void;
}

const getOrInitRoutes = (proto: DecoratedPrototype): CollectedRoute[] => {
    if ( ! proto[ROUTES_METADATA_KEY] ) {
        proto[ROUTES_METADATA_KEY] = [];
    }
    return proto[ROUTES_METADATA_KEY]!;
};

// ── @Controller ─────────────────────────────────────────────────────

/**
 * Class decorator.
 *
 * - Stores the controller's path `prefix` on the prototype so `PuterServer`
 *   can construct a correctly-prefixed `PuterRouter` for this controller.
 * - Installs a default `registerRoutes(router)` on the prototype that walks
 *   routes collected by method decorators (if this class hasn't defined its
 *   own `registerRoutes`). This means a purely-decorated controller needs
 *   no body — the decorators do all the wiring.
 *
 * Controllers that define their own `registerRoutes` are untouched; they can
 * still use `@Post` etc. and walk `prototype[ROUTES_METADATA_KEY]` manually
 * if they want to combine the styles.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyCtor = new (...args: any[]) => any;

export function Controller (prefix: string = '') {
    return <T extends AnyCtor>(value: T, _context: ClassDecoratorContext<T>): void => {
        const proto = value.prototype as DecoratedPrototype;
        proto[PREFIX_METADATA_KEY] = prefix;

        // Only install the default walker if the class itself hasn't
        // defined registerRoutes. We check *own* properties (not inherited)
        // so a PuterController base-class default doesn't block us.
        const hasOwnRegister = Object.prototype.hasOwnProperty.call(proto, 'registerRoutes');
        if ( hasOwnRegister ) return;

        proto.registerRoutes = function (router: PuterRouter): void {
            const routes = ((this as DecoratedPrototype)[ROUTES_METADATA_KEY] ?? []) as CollectedRoute[];
            for ( const r of routes ) {
                const bound = r.handler.bind(this) as RequestHandler;
                if ( r.method === 'use' ) {
                    if ( r.path !== undefined ) {
                        router.use(r.path, r.options, bound);
                    } else {
                        router.use(r.options, bound);
                    }
                    continue;
                }
                if ( r.path === undefined ) {
                    // A non-use method without a path is a mistake in the decorator
                    // call site; surface it loudly rather than silently dropping.
                    throw new Error(`@${r.method.toUpperCase()} decorator missing path`);
                }
                // Delegate to the appropriately-named method on the router.
                // The method set is enumerated in `RouteMethod` so this cast is safe.
                const routerMethod = router[r.method as Exclude<RouteMethod, 'use'>] as (
                    path: RoutePath,
                    options: RouteOptions,
                    handler: RequestHandler,
                ) => PuterRouter;
                routerMethod.call(router, r.path, r.options, bound);
            }
        };
    };
}

// ── Method decorators (@Get, @Post, ...) ───────────────────────────

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
type AnyMethod = Function;

const createMethodDecorator = (method: Exclude<RouteMethod, 'use'>) => {
    return (path: RoutePath, options: RouteOptions = {}) => {
        return (
            target: AnyMethod,
            context: ClassMethodDecoratorContext,
        ): void => {
            context.addInitializer(function () {
                const proto = Object.getPrototypeOf(this as object) as DecoratedPrototype;
                getOrInitRoutes(proto).push({
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
