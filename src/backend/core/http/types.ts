import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Actor } from '../actor';

/**
 * Every route method PuterRouter exposes. Mirrors the express router surface
 * plus WebDAV verbs that some endpoints still use.
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

    /**
     * Subdomain routing. If set, the route only matches requests whose
     * leftmost subdomain is in this list (via `next('route')` skip).
     *
     * If omitted, verb-routes (get/post/etc.) are restricted to the root
     * origin only (no subdomain). Pass `'*'` to explicitly match ANY
     * subdomain/root. `use()` middleware is not gated by default.
     */
    subdomain?: string | string[];

    /** Reject anonymous + suspended-user requests with 401/403. */
    requireAuth?: boolean;

    /** Reject app/access-token actors. Implies `requireAuth`. */
    requireUserActor?: boolean;

    /**
     * Reject unless the actor's username is `admin`, `system`, or one of the
     * extras in this array. `true` means just `admin`/`system`; an array adds
     * to that pair (does not replace it). Implies `requireAuth` +
     * `requireUserActor`.
     */
    adminOnly?: boolean | string[];

    /** Reject unless the actor is acting through one of these apps. Implies `requireAuth`. */
    allowedAppIds?: string[];

    /**
     * Reject unless the actor's user has a confirmed email. 400 with
     * `account_is_not_verified` on failure. No-op when
     * `config.strict_email_verification_required` is falsy, so self-hosted
     * deployments can opt in via config. Implies `requireAuth` but NOT
     * `requireUserActor` — app-under-user actors also carry a `.user`, so
     * verification applies uniformly whether the user acts directly or
     * through an app.
     */
    requireVerified?: boolean;

    /**
     * Per-route JSON body parsing override. By default the global parser
     * handles every `application/json` request with a 50mb limit and stashes
     * the raw bytes on `req.rawBody` for signature-verification use cases.
     *
     * Use this option only when a route needs different parser settings:
     *   - `false` — opt out of parsing entirely (rare; the route reads the
     *     raw stream itself, e.g. some webhook proxies). The global parser
     *     will still have already run if the content-type was JSON, so this
     *     is mostly useful for routes that accept *non*-JSON body shapes
     *     and want to ensure no further parsers attach.
     *   - `{ limit, type }` — override the limit (e.g., for ML endpoints
     *     that legitimately need 100mb) or the matched content-type list
     *     (e.g., to ALSO accept `application/x-ndjson`).
     */
    bodyJson?: false | { limit?: string; type?: string | string[] };

    /**
     * Per-route raw (Buffer) body parser. Use for binary uploads where the
     * route handler wants `req.body: Buffer` directly. Default content-type
     * match is `application/octet-stream`; pass `type` to override.
     */
    bodyRaw?: boolean | { limit?: string; type?: string | string[] };

    /**
     * Per-route text body parser. `req.body` becomes a string. Default
     * content-type match is `text/plain`.
     */
    bodyText?: boolean | { limit?: string; type?: string | string[] };

    /**
     * Per-route urlencoded form parser. `req.body` becomes a parsed object.
     * Default `extended: true` (uses `qs`); pass `extended: false` for the
     * built-in `querystring` parser.
     */
    bodyUrlencoded?: boolean | { limit?: string; extended?: boolean };

    /**
     * Require captcha verification. When `true`, the route rejects
     * requests that don't carry valid `captchaToken` + `captchaAnswer`
     * fields in the body. No-op when captcha is disabled in config.
     */
    captcha?: boolean;

    /**
     * Require a valid one-time anti-CSRF token in `req.body.anti_csrf`.
     * The token is consumed on use. Requires authentication (keyed by
     * user uuid).
     */
    antiCsrf?: boolean;

    /**
     * Per-route rate limiting. In-memory sliding window keyed by
     * request identity.
     *
     * `key` controls how requests are bucketed:
     *   - `'fingerprint'` (default) — IP + User-Agent hash. Safe for
     *     shared IPs (offices, VPNs).
     *   - `'ip'` — bare IP address.
     *   - `'user'` — actor's user ID. Use for authenticated routes
     *     where you want per-account limits.
     *   - `(req) => string` — custom key function.
     *
     * `scope` is an optional namespace prefix to isolate counters
     * between routes that share the same key strategy. Defaults to
     * the route path.
     */
    rateLimit?: {
        limit: number;
        window: number;
        key?: 'fingerprint' | 'ip' | 'user' | ((req: Request) => string);
        scope?: string;
    };

    // Reserved — wire as the corresponding features/services land:
    // bodyFiles?: string[];      // multer-style multipart fields
    // responseTimeout?: number;
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
export type AuthRequired<O extends RouteOptions> = O extends {
    requireAuth: true;
}
    ? true
    : O extends { requireUserActor: true }
      ? true
      : O extends { adminOnly: true | readonly string[] | string[] }
        ? true
        : O extends { allowedAppIds: readonly string[] | string[] }
          ? true
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
