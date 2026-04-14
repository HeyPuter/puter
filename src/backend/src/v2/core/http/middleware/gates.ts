import type { RequestHandler } from 'express';
import { HttpError } from '../HttpError';

// Make sure the `Express.Request.actor` augmentation is in scope.
import '../expressAugmentation';

/**
 * Per-route gate middlewares.
 *
 * These are tiny because they need to be: composability is the point. The
 * server's route materializer (`v2/server.ts#materializeRoute`) consults the
 * per-route `RouteOptions` and pushes the relevant gate(s) onto the express
 * middleware chain in this order:
 *
 *     subdomain → requireAuth (+ suspended check) → requireUserActor →
 *     adminOnly → allowedAppIds → caller middleware → handler
 *
 * Each gate either calls `next()` to pass through, calls `next('route')` to
 * skip (subdomain only), or throws an `HttpError` for the terminal error
 * handler to serialize. Express 5 forwards thrown errors automatically; no
 * `next(err)` ceremony required.
 */

// ── subdomain ───────────────────────────────────────────────────────

/**
 * Skip this route entirely (via `next('route')`) when the request's
 * leftmost subdomain doesn't match. This *isn't* a rejection — it lets
 * a different route matcher handle the request.
 *
 * Mirrors v1 `middleware/subdomain.js`.
 */
export const subdomainGate = (allowed: string | string[]): RequestHandler => {
    const allowList = Array.isArray(allowed) ? allowed : [allowed];
    return (req, _res, next) => {
        // Express `req.subdomains` is reverse-of-URL order; the leftmost
        // subdomain (the active one) is the last element.
        const active = req.subdomains?.[req.subdomains.length - 1] ?? '';
        if ( ! allowList.includes(active) ) {
            next('route');
            return;
        }
        next();
    };
};

// ── requireAuth (+ suspended check) ─────────────────────────────────

/**
 * Reject anonymous requests with 401. Also reject authenticated-but-suspended
 * users with 403 — `actor.user.suspended` is populated by `AuthService` from
 * `UserStore`, so the gate doesn't need its own DB hit.
 *
 * Implied by `requireUserActor`, `adminOnly`, and `allowedAppIds`; the
 * materializer ensures only one copy ends up in the chain.
 */
export const requireAuthGate = (): RequestHandler => {
    return (req, _res, next) => {
        if ( ! req.actor ) {
            next(new HttpError(401, 'Authentication required', { legacyCode: 'token_required' }));
            return;
        }
        if ( req.actor.user.suspended ) {
            next(new HttpError(403, 'Account suspended', { legacyCode: 'forbidden' }));
            return;
        }
        next();
    };
};

// ── requireUserActor ────────────────────────────────────────────────

/**
 * Reject app-under-user and access-token actors with 403. Use on endpoints
 * that should only be exercised by a human session — settings changes,
 * admin-style actions on the user's own account.
 */
export const requireUserActorGate = (): RequestHandler => {
    return (req, _res, next) => {
        const actor = req.actor;
        // requireAuth runs first; this gate just narrows the actor type.
        if ( ! actor ) {
            next(new HttpError(401, 'Authentication required', { legacyCode: 'token_required' }));
            return;
        }
        if ( actor.app || actor.accessToken ) {
            next(new HttpError(403, 'This endpoint is only available to user sessions', { legacyCode: 'forbidden' }));
            return;
        }
        next();
    };
};

// ── adminOnly ───────────────────────────────────────────────────────

/** Built-in admin usernames that always pass `adminOnly`. */
export const DEFAULT_ADMIN_USERNAMES = ['admin', 'system'] as const;

/**
 * Reject unless `actor.user.username` matches `admin`, `system`, or one of
 * the supplied extras. Mirrors v1 `extensionController` semantics:
 * extras are *additional* allowed users on top of the built-in pair, not a
 * replacement for it.
 *
 * Implies `requireAuth` + `requireUserActor`.
 */
export const adminOnlyGate = (extras: readonly string[] = []): RequestHandler => {
    const allowList = new Set<string>([...DEFAULT_ADMIN_USERNAMES, ...extras]);
    return (req, _res, next) => {
        const username = req.actor?.user.username;
        if ( ! username || ! allowList.has(username) ) {
            next(new HttpError(403, 'Only admins may request this resource', { legacyCode: 'forbidden' }));
            return;
        }
        next();
    };
};

// ── allowedAppIds ───────────────────────────────────────────────────

/**
 * Reject unless the actor is acting through one of the named apps.
 * Matches v1 extensionController: app-under-user actors are permitted iff
 * `actor.app.uid` is in the allowList; non-app actors are rejected.
 *
 * Implies `requireAuth`. Doesn't pair sensibly with `requireUserActor`
 * (a user-only actor has no app), but if both are set we reject loudly here.
 */
export const allowedAppIdsGate = (allowedAppUids: readonly string[]): RequestHandler => {
    const allowList = new Set(allowedAppUids);
    return (req, _res, next) => {
        const appUid = req.actor?.app?.uid;
        if ( ! appUid || ! allowList.has(appUid) ) {
            next(new HttpError(403, 'This app may not request this resource', { legacyCode: 'forbidden' }));
            return;
        }
        next();
    };
};
