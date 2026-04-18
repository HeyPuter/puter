import type { RequestHandler } from 'express';
import type {
    RouteDescriptor,
    RouteMethod,
    RouteOptions,
    RoutePath,
    TypedHandler,
} from './types';

/**
 * Normalized result of argument parsing for either path-required methods
 * (`get`, `post`, ...) or the more permissive `use`.
 */
interface NormalizedArgs {
    path?: RoutePath;
    options: RouteOptions;
    handler: RequestHandler;
}

/**
 * PuterRouter is a **collector**, not an active express router.
 *
 * Controllers call familiar express-shaped methods (`router.get(...)`,
 * `router.post(...)`, ...); the router pushes a `RouteDescriptor` onto
 * `routes`. `PuterServer` then walks each controller's routes and
 * materializes them into real express handlers, applying middleware
 * derived from the per-route `options` plus any caller-supplied
 * `options.middleware` chain.
 *
 * Keeping registration purely declarative means:
 * - Decorator-style and imperative-style controllers share one target.
 * - New per-route options (auth, subdomain, body parsing) can be added
 *   without touching any call site.
 * - The router has no dependency on an express app — useful for tests
 *   and for controllers constructed before the server is wired.
 */
export class PuterRouter {
    readonly prefix: string;
    readonly routes: RouteDescriptor[] = [];

    constructor (prefix: string = '') {
        this.prefix = prefix;
    }

    // ── use ─────────────────────────────────────────────────────────
    //
    // `use` is the only method whose path is optional (global-ish
    // middleware) and whose options can appear with or without a path.
    // All four overloads route into `#parseUseArgs`.

    use (handler: RequestHandler): this;
    use (options: RouteOptions, handler: RequestHandler): this;
    use (path: RoutePath, handler: RequestHandler): this;
    use (path: RoutePath, options: RouteOptions, handler: RequestHandler): this;
    use (...args: unknown[]): this {
        const normalized = this.#parseUseArgs(args);
        this.routes.push({ method: 'use', ...normalized });
        return this;
    }

    // ── HTTP verbs + WebDAV ─────────────────────────────────────────
    //
    // All take `(path, handler)` or `(path, options, handler)`.

    all (path: RoutePath, handler: RequestHandler): this;
    all<const O extends RouteOptions>(path: RoutePath, options: O, handler: TypedHandler<O>): this;
    all (...args: unknown[]): this {
        return this.#push('all', args);
    }

    get (path: RoutePath, handler: RequestHandler): this;
    get<const O extends RouteOptions>(path: RoutePath, options: O, handler: TypedHandler<O>): this;
    get (...args: unknown[]): this {
        return this.#push('get', args);
    }

    head (path: RoutePath, handler: RequestHandler): this;
    head<const O extends RouteOptions>(path: RoutePath, options: O, handler: TypedHandler<O>): this;
    head (...args: unknown[]): this {
        return this.#push('head', args);
    }

    post (path: RoutePath, handler: RequestHandler): this;
    post<const O extends RouteOptions>(path: RoutePath, options: O, handler: TypedHandler<O>): this;
    post (...args: unknown[]): this {
        return this.#push('post', args);
    }

    put (path: RoutePath, handler: RequestHandler): this;
    put<const O extends RouteOptions>(path: RoutePath, options: O, handler: TypedHandler<O>): this;
    put (...args: unknown[]): this {
        return this.#push('put', args);
    }

    delete (path: RoutePath, handler: RequestHandler): this;
    delete<const O extends RouteOptions>(path: RoutePath, options: O, handler: TypedHandler<O>): this;
    delete (...args: unknown[]): this {
        return this.#push('delete', args);
    }

    patch (path: RoutePath, handler: RequestHandler): this;
    patch<const O extends RouteOptions>(path: RoutePath, options: O, handler: TypedHandler<O>): this;
    patch (...args: unknown[]): this {
        return this.#push('patch', args);
    }

    options (path: RoutePath, handler: RequestHandler): this;
    options<const O extends RouteOptions>(path: RoutePath, options: O, handler: TypedHandler<O>): this;
    options (...args: unknown[]): this {
        return this.#push('options', args);
    }

    lock (path: RoutePath, handler: RequestHandler): this;
    lock<const O extends RouteOptions>(path: RoutePath, options: O, handler: TypedHandler<O>): this;
    lock (...args: unknown[]): this {
        return this.#push('lock', args);
    }

    unlock (path: RoutePath, handler: RequestHandler): this;
    unlock<const O extends RouteOptions>(path: RoutePath, options: O, handler: TypedHandler<O>): this;
    unlock (...args: unknown[]): this {
        return this.#push('unlock', args);
    }

    propfind (path: RoutePath, handler: RequestHandler): this;
    propfind<const O extends RouteOptions>(path: RoutePath, options: O, handler: TypedHandler<O>): this;
    propfind (...args: unknown[]): this {
        return this.#push('propfind', args);
    }

    proppatch (path: RoutePath, handler: RequestHandler): this;
    proppatch<const O extends RouteOptions>(path: RoutePath, options: O, handler: TypedHandler<O>): this;
    proppatch (...args: unknown[]): this {
        return this.#push('proppatch', args);
    }

    mkcol (path: RoutePath, handler: RequestHandler): this;
    mkcol<const O extends RouteOptions>(path: RoutePath, options: O, handler: TypedHandler<O>): this;
    mkcol (...args: unknown[]): this {
        return this.#push('mkcol', args);
    }

    copy (path: RoutePath, handler: RequestHandler): this;
    copy<const O extends RouteOptions>(path: RoutePath, options: O, handler: TypedHandler<O>): this;
    copy (...args: unknown[]): this {
        return this.#push('copy', args);
    }

    move (path: RoutePath, handler: RequestHandler): this;
    move<const O extends RouteOptions>(path: RoutePath, options: O, handler: TypedHandler<O>): this;
    move (...args: unknown[]): this {
        return this.#push('move', args);
    }

    // ── Internals ───────────────────────────────────────────────────

    #push (method: RouteMethod, args: unknown[]): this {
        const normalized = this.#parsePathArgs(args);
        this.routes.push({ method, ...normalized });
        return this;
    }

    #parsePathArgs (args: unknown[]): NormalizedArgs {
        // (path, handler) — two args, handler is last
        if ( args.length === 2 ) {
            return {
                path: args[0] as RoutePath,
                options: {},
                handler: args[1] as RequestHandler,
            };
        }
        // (path, options, handler)
        return {
            path: args[0] as RoutePath,
            options: (args[1] as RouteOptions) ?? {},
            handler: args[2] as RequestHandler,
        };
    }

    #parseUseArgs (args: unknown[]): NormalizedArgs {
        if ( args.length === 1 ) {
            // use(handler)
            return { options: {}, handler: args[0] as RequestHandler };
        }
        if ( args.length === 2 ) {
            const [first, second] = args;
            // Path-like first arg: string, RegExp, or array of those.
            if (
                typeof first === 'string'
                || first instanceof RegExp
                || Array.isArray(first)
            ) {
                return {
                    path: first as RoutePath,
                    options: {},
                    handler: second as RequestHandler,
                };
            }
            // Otherwise the first arg is options.
            return {
                options: (first as RouteOptions) ?? {},
                handler: second as RequestHandler,
            };
        }
        // use(path, options, handler)
        return {
            path: args[0] as RoutePath,
            options: (args[1] as RouteOptions) ?? {},
            handler: args[2] as RequestHandler,
        };
    }
}
