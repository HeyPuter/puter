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

import type { Request, RequestHandler } from 'express';
import { HttpError } from '../HttpError';

// Make sure the `Express.Request.actor` augmentation is in scope.
import '../expressAugmentation';

/**
 * Build the 401 a route gate emits when `req.actor` is absent. Splits the
 * legacy code so old clients can tell the two cases apart: `token_missing`
 * means "send a token", `token_auth_failed` means "your token didn't work,
 * re-login". Matches the v1 backend's auth-failure shape so the existing
 * client retry-vs-reauth logic doesn't need to change.
 */
const rejectAuth = (req: Request): HttpError => {
    if (req.tokenAuthFailed) {
        return new HttpError(401, 'Authentication failed', {
            legacyCode: 'token_auth_failed',
        });
    }
    return new HttpError(401, 'Missing authentication token', {
        legacyCode: 'token_missing',
    });
};

/**
 * Per-route gate middlewares.
 *
 * These are tiny because they need to be: composability is the point. The
 * server's route materializer (`server.ts#materializeRoute`) consults the
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
 */
export const subdomainGate = (allowed: string | string[]): RequestHandler => {
    const allowList = Array.isArray(allowed) ? allowed : [allowed];
    return (req, _res, next) => {
        // Express `req.subdomains` is reverse-of-URL order; the leftmost
        // subdomain (the active one) is the last element.
        const active = req.subdomains?.[req.subdomains.length - 1] ?? '';
        if (!allowList.includes(active)) {
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
        if (!req.actor) {
            next(rejectAuth(req));
            return;
        }
        if (req.actor.user.suspended) {
            next(
                new HttpError(403, 'Account suspended', {
                    legacyCode: 'forbidden',
                }),
            );
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
        if (!actor) {
            next(rejectAuth(req));
            return;
        }
        if (actor.app || actor.accessToken) {
            next(
                new HttpError(
                    403,
                    'This endpoint is only available to user sessions',
                    { legacyCode: 'forbidden' },
                ),
            );
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
 * the supplied extras. Extras are *additional* allowed users on top of the
 * built-in pair, not a replacement for it.
 *
 * Implies `requireAuth`. Does *not* imply `requireUserActor` — admin
 * endpoints are callable via an admin's access token or app-under-user
 * actor; combine with `requireUserActor` explicitly if a route must be
 * restricted to browser sessions.
 */
export const adminOnlyGate = (
    extras: readonly string[] = [],
): RequestHandler => {
    const allowList = new Set<string>([...DEFAULT_ADMIN_USERNAMES, ...extras]);
    return (req, _res, next) => {
        const username = req.actor?.user.username;
        if (!username || !allowList.has(username)) {
            next(
                new HttpError(403, 'Only admins may request this resource', {
                    legacyCode: 'forbidden',
                }),
            );
            return;
        }
        next();
    };
};

// ── requireVerified ─────────────────────────────────────────────────

/**
 * Reject unless the authenticated user has a confirmed email. Gated behind
 * `strict_email_verification_required` config so self-hosted deployments
 * without email delivery don't brick their own filesystem routes.
 *
 * Reads `req.actor?.user?.email_confirmed`, which is present on both
 * user-only and app-under-user actors, so it works for either shape.
 */
export const requireVerifiedGate = (strictFlag: boolean): RequestHandler => {
    return (req, _res, next) => {
        if (!strictFlag) {
            next();
            return;
        }
        const user = req.actor?.user as Record<string, unknown> | undefined;
        if (!user?.email_confirmed) {
            next(
                new HttpError(400, 'Account email is not verified', {
                    legacyCode: 'account_is_not_verified',
                }),
            );
            return;
        }
        next();
    };
};

// ── allowedAppIds ───────────────────────────────────────────────────

/**
 * Reject unless the actor is acting through one of the named apps.
 * App-under-user actors are permitted iff `actor.app.uid` is in the allowList;
 * non-app actors are rejected.
 *
 * Implies `requireAuth`. Doesn't pair sensibly with `requireUserActor`
 * (a user-only actor has no app), but if both are set we reject loudly here.
 */
export const allowedAppIdsGate = (
    allowedAppUids: readonly string[],
): RequestHandler => {
    const allowList = new Set(allowedAppUids);
    return (req, _res, next) => {
        const appUid = req.actor?.app?.uid;
        if (appUid && !allowList.has(appUid)) {
            next(
                new HttpError(403, 'This app may not request this resource', {
                    legacyCode: 'forbidden',
                }),
            );
            return;
        }
        next();
    };
};
