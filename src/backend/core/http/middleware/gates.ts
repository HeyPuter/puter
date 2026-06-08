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
import { assertVerifiedEmail } from '../verifiedEmail';

// Make sure the `Express.Request.actor` augmentation is in scope.
import '../expressAugmentation';

const rejectAuth = (req: Request): HttpError => {
    if (req.requiresReauth) {
        return new HttpError(401, 'Re-authentication required', {
            legacyCode: 'reauth_required',
            fields: {
                code: 'reauth_required',
                reason: req.requiresReauth.reason,
                ...(req.requiresReauth.auth_id
                    ? { auth_id: req.requiresReauth.auth_id }
                    : {}),
                ...(req.requiresReauth.reauth_token
                    ? { reauth_token: req.requiresReauth.reauth_token }
                    : {}),
            },
        });
    }
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

/**
 * Reject app-under-user and access-token actors with 403. Use on endpoints
 * that should only be exercised by a human session — settings changes,
 * admin-style actions on the user's own account.
 *
 * `allowFullAccess` (set per-route via the `allowFullAccessToken` route option)
 * relaxes ONLY the access-token half: a full-access ("personal access token")
 * actor is admitted, because it represents the user's own full API reach.
 * Third-party apps are ALWAYS rejected, and scoped access tokens are always
 * rejected. This opt-in is for user-resource / inference endpoints (AI proxy,
 * etc.) that use this gate purely to keep apps out — NEVER for account or
 * security management, which must stay closed to every access token.
 */
export const requireUserActorGate = (
    opts: { allowFullAccess?: boolean } = {},
): RequestHandler => {
    return (req, _res, next) => {
        const actor = req.actor;
        // requireAuth runs first; this gate just narrows the actor type.
        if (!actor) {
            next(rejectAuth(req));
            return;
        }
        // Third-party apps are never allowed through this gate.
        const appBlocked = !!actor.app;
        // Access tokens are blocked unless the route opted in AND this is a
        // full-access PAT (the user's own credential). Scoped tokens: blocked.
        const tokenBlocked =
            !!actor.accessToken &&
            !(opts.allowFullAccess && actor.accessToken.fullAccess);
        if (appBlocked || tokenBlocked) {
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

export const requireNonAccessTokenGate = (): RequestHandler => {
    return (req, _res, next) => {
        const actor = req.actor;
        if (!actor) {
            next(rejectAuth(req));
            return;
        }
        // Full-access ("personal access token") access tokens are admitted here:
        // they carry the user's full API reach by design. They remain blocked
        // from account management because those routes also use
        // `requireUserActorGate`, which rejects ALL access tokens. Normal
        // (scoped) access tokens stay blocked from non-`allowAccessToken`
        // routes.
        if (actor.accessToken && !actor.accessToken.fullAccess) {
            next(
                new HttpError(
                    403,
                    'Access tokens are not allowed to access this resource',
                    { legacyCode: 'forbidden' },
                ),
            );
            return;
        }
        next();
    };
};

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
    // Match the case-insensitivity guarantee of the username column
    // (MySQL: ascii_general_ci; SQLite: idx_user_username_nocase). Comparing
    // raw-case here would let a stored `Admin` bypass the lowercase allowlist
    // on any backend that lets case-collision rows exist.
    const allowList = new Set<string>(
        [...DEFAULT_ADMIN_USERNAMES, ...extras].map((u) => u.toLowerCase()),
    );
    return (req, _res, next) => {
        const username = req.actor?.user.username;
        if (!username || !allowList.has(username.toLowerCase())) {
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
        try {
            assertVerifiedEmail(strictFlag, req.actor?.user);
        } catch (err) {
            next(err);
            return;
        }
        next();
    };
};

/**
 * Reject authenticated users whose account is pending email confirmation
 * (`requires_email_confirmation && !email_confirmed`). Runs on every
 * authenticated route by default; routes that set `allowUnconfirmed: true`
 * skip this gate.
 *
 * Returns 403 with `email_confirmation_required` so clients can show the
 * confirmation prompt instead of a generic error.
 */
export const requireEmailConfirmedGate = (): RequestHandler => {
    return (req, _res, next) => {
        const user = req.actor?.user;
        if (user?.requires_email_confirmation && !user?.email_confirmed) {
            next(
                new HttpError(403, 'Please confirm your email to continue', {
                    legacyCode: 'email_confirmation_required',
                }),
            );
            return;
        }
        next();
    };
};

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
