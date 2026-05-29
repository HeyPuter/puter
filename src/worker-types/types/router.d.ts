import type { Handler } from './event.d.ts';
import type { ExtractParams, Params } from './params.d.ts';

type RouteMethod = <S extends string>(
    path: S,
    handler: Handler<ExtractParams<S> & Params>,
) => void;

/**
 * The global `router` object that worker scripts use to register route
 * handlers. HTTP-verb methods infer their `params` type from the path
 * literal — `router.get('/posts/:id', ({ params }) => params.id)` types
 * `params.id` as `string` with no annotations required.
 */
export interface Router {
    /** When `false`, the worker stops handling fetch events. Default: `true`. */
    routing: boolean;

    /**
     * When `true` (default), the router responds to preflight `OPTIONS`
     * requests and adds `Access-Control-Allow-Origin: *` to responses
     * that don't already have it.
     */
    handleCors: boolean;

    get: RouteMethod;
    post: RouteMethod;
    put: RouteMethod;
    delete: RouteMethod;
    options: RouteMethod;

    /**
     * Register a handler for an arbitrary HTTP method (e.g. `PATCH`, `HEAD`).
     * The other verb methods all delegate to this internally.
     */
    custom<S extends string>(
        method: string,
        path: S,
        handler: Handler<ExtractParams<S> & Params>,
    ): void;
}
