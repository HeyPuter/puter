import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Actor } from '../actor';

/**
 * Every route method PuterRouter exposes. Mirrors the express router surface
 * plus WebDAV verbs that some legacy endpoints still use.
 *
 * `use` and `all` don't map to a single HTTP verb — they're treated uniformly
 * by the materializer (see `v2/server.ts`).
 */
export type RouteMethod =
    | 'use'
    | 'all'
    | 'get'
    | 'head'
    | 'post'
    | 'put'
    | 'delete'
    | 'patch'
    | 'options'
    | 'lock'
    | 'unlock'
    | 'propfind'
    | 'proppatch'
    | 'mkcol'
    | 'copy'
    | 'move';

/**
 * Path shape accepted by express route methods. Kept permissive rather than
 * re-exporting express's internal `PathParams` (which isn't stable public API).
 */
export type RoutePath = string | RegExp | Array<string | RegExp>;

/**
 * Per-route options declared by the caller.
 *
 * The materializer (`v2/server.ts#materializeRoute`) translates these into a
 * middleware chain in this order:
 *
 *     subdomain → requireAuth (+ suspended) → requireUserActor →
 *     adminOnly → allowedAppIds → caller `middleware: []` → handler
 *
 * `requireUserActor`, `adminOnly`, and `allowedAppIds` all imply
 * `requireAuth`; the materializer dedupes so only one auth gate ends up
 * in the chain. Commented-out slots are reserved for the next chunks
 * (body parsing, post-auth gates, timing).
 */
export interface RouteOptions {
    /** Extra per-route middleware. Applied after built-in gates, before the handler. */
    middleware?: RequestHandler[];

    /** Skip this route (via `next('route')`) when the request's leftmost subdomain doesn't match. */
    subdomain?: string | string[];

    /** Reject anonymous + suspended-user requests with 401/403. */
    requireAuth?: boolean;

    /** Reject app/access-token actors. Implies `requireAuth`. */
    requireUserActor?: boolean;

    /**
     * Reject unless the actor's username is `admin`, `system`, or one of the
     * extras in this array. `true` means just `admin`/`system`; an array adds
     * to that pair (does not replace it). Matches v1 `extensionController`
     * semantics. Implies `requireAuth` + `requireUserActor`.
     */
    adminOnly?: boolean | string[];

    /** Reject unless the actor is acting through one of these apps. Implies `requireAuth`. */
    allowedAppIds?: string[];

    // Reserved — wire as the corresponding features/services land:
    // bodyJson?: boolean | { limit?: string };
    // bodyFiles?: string[];
    // responseTimeout?: number;
    // requireVerified?: boolean;
    // antiCsrf?: boolean;
}

/**
 * Normalized route record produced by PuterRouter (and the class/method
 * decorators). `path` is omitted only for `router.use(handler)` / `use(options, handler)`.
 */
export interface RouteDescriptor {
    method: RouteMethod;
    path?: RoutePath;
    options: RouteOptions;
    handler: RequestHandler;
}

/**
 * Shape stored on decorated controller prototypes by `@Get` / `@Post` / etc.
 * `handler` is the method reference — still unbound at decoration time;
 * the installed `registerRoutes` binds it to the instance at walk time.
 */
export interface CollectedRoute {
    method: RouteMethod;
    path?: RoutePath;
    options: RouteOptions;
    handler: RequestHandler;
}

/** Internal: the property name used to stash decorator metadata on prototypes. */
export const ROUTES_METADATA_KEY = '__puterRoutes' as const;
/** Internal: the property name used to stash a controller's path prefix. */
export const PREFIX_METADATA_KEY = '__puterControllerPrefix' as const;

// ── Type narrowing helpers ──────────────────────────────────────────
//
// When a route declares a gate option (requireAuth, requireUserActor,
// adminOnly, allowedAppIds), the materializer guarantees the corresponding
// gate runs before the handler. These types encode that guarantee at the
// type level, so handlers can use `req.actor` without a non-null assertion.
//
// Activated by the `const` generic on PuterRouter's per-method overloads:
// the literal options object is captured precisely (e.g. `{requireAuth: true}`
// rather than `{requireAuth: boolean}`), letting the conditional branches
// match by value.

/**
 * `true` iff the materializer will run an auth gate before the handler.
 * Branches match readonly *and* mutable arrays so callers don't need
 * `as const` on every options literal.
 */
export type AuthRequired<O extends RouteOptions> =
    O extends { requireAuth: true } ? true
        : O extends { requireUserActor: true } ? true
            : O extends { adminOnly: true | readonly string[] | string[] } ? true
                : O extends { allowedAppIds: readonly string[] | string[] } ? true
                    : false;

/** Express `Request` with `actor` narrowed based on the route's options. */
export type TypedRequest<O extends RouteOptions> = Omit<Request, 'actor'> & {
    actor: AuthRequired<O> extends true ? Actor : Actor | undefined;
};

/** Handler signature whose `req.actor` reflects the route's gate options. */
export type TypedHandler<O extends RouteOptions> = (
    req: TypedRequest<O>,
    res: Response,
    next: NextFunction,
) => void | Promise<void>;
