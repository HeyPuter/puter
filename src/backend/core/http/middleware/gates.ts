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
import { effectiveActorApp } from '../../actor';
import type { Actor } from '../../actor';
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
        if (req.appBlocked) {
            next(
                new HttpError(
                    403,
                    'This app is not allowed to access Puter resources',
                    { legacyCode: 'app_blocked' },
                ),
            );
            return;
        }
        if (!req.actor) {
            next(rejectAuth(req));
            return;
        }
        try {
            assertNotSuspended(req.actor.user);
        } catch (err) {
            next(err);
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

/**
 * Reject bare user-session actors — the "root" credential a browser session
 * (or `/login`) holds, with no app and no access token in play. Use on API
 * surfaces that must only be driven by a delegated credential: an app or
 * worker token, or an API token minted from the dashboard. The point is that
 * a leaked-or-copied session token (full account control) shouldn't double
 * as an AI/API credential; users are pushed to mint a revocable token
 * instead.
 *
 * This gate only rejects the bare-session shape. Which delegated credentials
 * are acceptable is decided by the gates it composes with (`requireUserActor`
 * + `allowFullAccessToken` to also keep apps out, `requireNonAccessTokenGate`
 * for scoped tokens, etc.).
 */
export const assertNotUserSession = (
    actor: Pick<Actor, 'app' | 'accessToken' | 'session'> | null | undefined,
): void => {
    if (!actor) return; // anonymous requests are the auth gate's problem
    if (actor.app || actor.accessToken) return;
    // User-scoped workers (deployed with no app binding) authenticate with
    // a session-TYPE token whose session row is `kind='worker'` — a managed,
    // revocable deployment credential, not a browser sign-in. Workers are
    // never treated as root tokens: this gate is an annoyance for
    // sign-up-and-scrape abuse, and someone who deploys a worker to reach
    // an API has already left that path.
    if (actor.session?.kind === 'worker') return;
    throw new HttpError(
        403,
        'This API cannot be called with an account session token. ' +
            'Use an app or worker token, or create an API token from the ' +
            'dashboard (Account → API Token).',
        { legacyCode: 'app_or_api_token_required' },
    );
};

/** Route-option form of {@link assertNotUserSession} (`noUserSession: true`). */
export const noUserSessionGate = (): RequestHandler => {
    return (req, _res, next) => {
        const actor = req.actor;
        if (!actor) {
            next(rejectAuth(req));
            return;
        }
        try {
            assertNotUserSession(actor);
        } catch (err) {
            next(err);
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
 * Also requires a *root token* — an actor with no app anywhere in its token
 * chain (see `effectiveActorApp`) — so a third-party app an admin has
 * authorized can't reach admin endpoints on the admin's behalf. The one
 * exception is `appGated`: on a route that is also appId-gated
 * (`allowedAppIds`), a direct app-under-user actor is deferred to
 * `allowedAppIdsGate`, so the net effect there is "a root token OR a token
 * scoped to an allowed app". Access tokens issued through an app are
 * rejected even then — `allowedAppIdsGate` only sees top-level `actor.app`
 * and would otherwise wave them through.
 *
 * Implies `requireAuth`. Does *not* imply `requireUserActor` — a root token
 * still includes an admin's full-access personal access token, not only
 * browser sessions; combine with `requireUserActor` explicitly if a route
 * must be restricted to browser sessions.
 */
export const adminOnlyGate = (
    extras: readonly string[] = [],
    opts: { appGated?: boolean } = {},
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
        // Root-token requirement: reject actors carrying an app anywhere in
        // their token chain — app-under-user, or an access token issued
        // through an app. A direct app-under-user actor is deferred to
        // `allowedAppIdsGate` when the route is appId-gated; chain-only apps
        // are rejected even then, since that gate can't see them.
        const chainApp = req.actor ? effectiveActorApp(req.actor) : null;
        if (chainApp && !(opts.appGated && req.actor?.app?.uid)) {
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
 * Reject authenticated users whose account is still pending any signup-time
 * verification — email confirmation, SMS phone verification, or credit-card
 * verification. The abuse harness sets the phone/card flags on low-reputation
 * signups (in place of a hard block), and this gate is what actually keeps
 * those accounts out of the product until the flag clears: the flags live on
 * `req.actor.user`, so every authenticated route enforces them, not just the
 * GUI modal.
 *
 * Runs on every authenticated route by default; routes that set
 * `allowUnconfirmed: true` opt out (the verification endpoints themselves,
 * plus essential flows like whoami / logout / save-account so a pending
 * account can still reach the screens that clear the gate).
 *
 * Returns 403 with a per-gate legacy code (`email_confirmation_required` /
 * `phone_verification_required` / `card_verification_required`) so clients can
 * show the right prompt instead of a generic error. There is no state where a
 * user should be allowed in with one verification pending, so any pending gate
 * rejects.
 */
export const requireVerifiedAccount = (): RequestHandler => {
    return (req, _res, next) => {
        try {
            assertVerifiedAccount(req.actor?.user);
        } catch (err) {
            next(err);
            return;
        }
        next();
    };
};

/**
 * The pending-verification check, factored out of {@link requireVerifiedAccount}
 * so auth paths that build their own actor outside the route-option machinery
 * can enforce the exact same gate. The WebDAV controller is the motivating
 * case: it dispatches every method off a single `router.use`, so
 * `requireVerifiedAccount` is never wired into its chain — it has to call this
 * directly. Keeping one implementation is the point: a verification gate added
 * here is picked up by every caller, so the paths can't drift (which is how
 * WebDAV came to bypass the phone/card gate to begin with).
 *
 * Throws 403 with a per-gate legacy code (`email_confirmation_required` /
 * `phone_verification_required` / `card_verification_required`) so clients can
 * show the right prompt instead of a generic error. There is no state where a
 * user should be let in with any verification pending, so the first pending
 * gate rejects.
 */
export const assertVerifiedAccount = (
    user:
        | {
              requires_email_confirmation?: unknown;
              email_confirmed?: unknown;
              requires_phone_verification?: unknown;
              requires_card_verification?: unknown;
          }
        | undefined,
): void => {
    if (user?.requires_email_confirmation && !user?.email_confirmed) {
        throw new HttpError(403, 'Please confirm your email to continue', {
            legacyCode: 'email_confirmation_required',
        });
    }
    if (user?.requires_phone_verification) {
        throw new HttpError(
            403,
            'Please verify your phone number to continue',
            {
                legacyCode: 'phone_verification_required' as never,
            },
        );
    }
    if (user?.requires_card_verification) {
        throw new HttpError(403, 'Please verify your card to continue', {
            legacyCode: 'card_verification_required' as never,
        });
    }
};

export const assertNotSuspended = (
    user: { suspended?: unknown } | undefined,
): void => {
    if (user?.suspended) {
        throw new HttpError(403, 'Account suspended', {
            legacyCode: 'forbidden',
        });
    }
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
