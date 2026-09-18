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

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { UserRow } from '../../stores/user/UserStore';
import type { Actor } from '../actor';

/**
 * Which request slot the auth probe found its token in, recorded on
 * `req.tokenSource`. Routes that hand the browser durable credentials assert on
 * it instead of accepting any token that authenticates.
 */
export type TokenSource =
    | 'body'
    | 'header'
    | 'x-api-key'
    | 'cookie'
    | 'query'
    | 'handshake';

/** Express router methods plus the WebDAV verbs some endpoints use. */
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
 * Express route path; kept permissive since express's `PathParams` is not
 * public API.
 */
export type RoutePath = string | RegExp | Array<string | RegExp>;

/** The account-verification factors a route can ask for by name. */
export type VerificationFactor = 'phone' | 'card';

/** The user fields the account gates read; all optional, like `Actor.user`. */
export type AccountGateUser = Partial<
    Pick<
        UserRow,
        | 'suspended'
        | 'email_confirmed'
        | 'requires_email_confirmation'
        | 'requires_phone_verification'
        | 'requires_card_verification'
        | 'requires_password_change'
        | 'phone'
        | 'card_fingerprint'
    >
>;

/** One rate-limit window. See `RouteOptions.rateLimit` for semantics. */
export interface RouteRateLimit {
    limit: number;
    window: number;
    /**
     * Per-`SubscriptionPolicy.id` overrides for `limit`; the base applies when
     * there is no match.
     */
    bySubscription?: Record<string, number>;
    key?: 'fingerprint' | 'ip' | 'user' | ((req: Request) => string);
    scope?: string;
    backend?: 'memory' | 'redis' | 'kv';
}

/**
 * Per-route options. The materializer (`v2/server.ts`) turns them into a
 * middleware chain in this order:
 *
 *     subdomain → requireAuth → emailConfirmed → requireUserActor → adminOnly →
 *     allowedAppIds → phoneVerified → cardVerified → anyVerified →
 *     requireReputation → requireSubscription → rateLimit → requireCredits →
 *     concurrent → `middleware` → handler
 *
 * Options that imply `requireAuth` are deduped to a single auth gate.
 */
export interface RouteOptions {
    /** Extra middleware, run after the built-in gates. */
    middleware?: RequestHandler[];

    /**
     * Only match requests whose leftmost subdomain is listed. Verb routes
     * default to the root origin only; `'*'` matches any. `use()` middleware is
     * not gated by default.
     */
    subdomain?: string | string[];

    /** 401 for anonymous requests, 403 for suspended accounts. */
    requireAuth?: boolean;

    /** Reject app/access-token actors. Implies `requireAuth`. */
    requireUserActor?: boolean;

    /**
     * With `requireUserActor`, admit full-access personal access tokens; apps
     * and scoped tokens stay blocked. Never set on account or security routes.
     */
    allowFullAccessToken?: boolean;

    /** Admit scoped access tokens. */
    allowAccessToken?: boolean;

    /**
     * Reject bare account-session actors with 403 `app_or_api_token_required`;
     * worker sessions pass. Implies `requireAuth`.
     */
    noUserSession?: boolean;

    /**
     * Reject unless the username is `admin`, `system`, or one of the listed
     * extras, and the actor is a root token (no app in its chain). Pair with
     * `allowedAppIds` to also admit tokens scoped to those apps. Implies
     * `requireAuth`, not `requireUserActor`.
     */
    adminOnly?: boolean | string[];

    /**
     * Reject actors acting as an app that is not listed, whether carried
     * directly or through the app that issued their access token. Actors with
     * no app in the chain pass; see `allowedAppIdsGate`. Implies
     * `requireAuth`.
     */
    allowedAppIds?: string[];

    /**
     * Let accounts still pending a verification through. For the flows that
     * clear the pending state (logout, confirm-email, whoami, save-account).
     */
    allowUnconfirmed?: boolean;

    /**
     * Reject unless the email is confirmed. Inert unless
     * `config.strict_email_verification_required`. Implies `requireAuth`.
     */
    requireVerified?: boolean;

    /**
     * 403 `phone_verification_required` unless a phone was verified. Implies
     * `requireAuth`.
     */
    requirePhoneVerified?: boolean;

    /**
     * 403 `card_verification_required` unless a card was verified. Implies
     * `requireAuth`.
     */
    requireCardVerified?: boolean;

    /**
     * Reject unless one of the listed factors is verified; a paid plan counts
     * for `card`. Only factors this deployment can verify are asked for, so
     * with none verifiable the gate is inert. The 403 lists the verifiable
     * factors in `factors`. An empty list is a boot error.
     */
    requireAnyVerified?: readonly VerificationFactor[];

    /**
     * Override the global JSON parser: `false` opts out, `{ limit, type }`
     * changes the size limit or the matched content types.
     */
    bodyJson?: false | { limit?: string; type?: string | string[] };

    /**
     * Buffer body parser. Matches `application/octet-stream` unless `type`
     * overrides.
     */
    bodyRaw?: boolean | { limit?: string; type?: string | string[] };

    /** Text body parser. Matches `text/plain` by default. */
    bodyText?: boolean | { limit?: string; type?: string | string[] };

    /** Form parser. `extended: true` (default) uses `qs`. */
    bodyUrlencoded?: boolean | { limit?: string; extended?: boolean };

    /**
     * Require valid `captchaToken` + `captchaAnswer` in the body. No-op when
     * captcha is disabled.
     */
    captcha?: boolean;

    /**
     * Require a valid one-time `anti_csrf` body token. Needs an authenticated
     * user.
     */
    antiCsrf?: boolean;

    /**
     * Only allow pages on this deployment's GUI origin; requests with no
     * `Origin` header still pass. For routes returning a session credential;
     * see `guiOriginGate`.
     */
    guiOriginOnly?: boolean;

    /**
     * Sliding-window rate limit. `key` picks the bucket: `fingerprint`
     * (default; network hash refined by device fingerprint), `ip`, `user`, or a
     * function. `scope` namespaces the counter (defaults to the route path);
     * `backend` defaults to `config.rate_limit.backend`. An array applies every
     * limit independently; give each its own `scope`.
     */
    rateLimit?: RouteRateLimit | RouteRateLimit[];

    /**
     * Cap simultaneous in-flight requests per key; slots are released on
     * response finish or close. `bySubscription` overrides `limit` per
     * `SubscriptionPolicy.id` when metering is wired in. `key`, `scope`,
     * `backend` as in `rateLimit`.
     */
    concurrent?: {
        limit: number;
        bySubscription?: Record<string, number>;
        key?: 'fingerprint' | 'ip' | 'user' | ((req: Request) => string);
        scope?: string;
        backend?: 'memory' | 'redis' | 'kv';
    };

    /**
     * 402 `insufficient_funds` when the account has no usage budget left. For
     * routes that spend metered resources, not for the ones that let an account
     * see or free up what it has. Anonymous callers and worker sessions pass.
     */
    requireCredits?: boolean;

    /**
     * 402 `subscription_required` unless the plan qualifies: `true` accepts any
     * non-free plan, an array of `SubscriptionPolicy.id`s only those. Implies
     * `requireAuth`.
     */
    requireSubscription?: boolean | string[];

    /**
     * 403 `reputation_required` unless the account meets the named tier.
     * Thresholds come from `reputationGate.tiers`; an undefined tier is inert.
     * Implies `requireAuth`.
     */
    requireReputation?: string | false;

    // Reserved — wire as the corresponding features/services land:
    // bodyFiles?: string[];      // multer-style multipart fields
    // responseTimeout?: number;

    realMime?: boolean; // for legacy FS controller, see `LegacyFSController#serveFile`
}

/**
 * Normalized route record produced by PuterRouter (and the class/method
 * decorators). `path` is omitted only for `router.use(handler)` / `use(options,
 * handler)`.
 */
export interface RouteDescriptor {
    method: RouteMethod;
    path?: RoutePath;
    options: RouteOptions;
    handler: RequestHandler;
}

/**
 * Shape stored on decorated controller prototypes by `@Get` / `@Post` / etc.
 * `handler` is the method reference — still unbound at decoration time; the
 * installed `registerRoutes` binds it to the instance at walk time.
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

// -- Type narrowing helpers ------------------------------------------
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
 * Branches match readonly _and_ mutable arrays so callers don't need `as const`
 * on every options literal.
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
          : O extends { noUserSession: true }
            ? true
            : O extends { requirePhoneVerified: true }
              ? true
              : O extends { requireCardVerified: true }
                ? true
                : O extends {
                        requireAnyVerified:
                            | readonly VerificationFactor[]
                            | VerificationFactor[];
                    }
                  ? true
                  : O extends {
                          requireSubscription:
                              | true
                              | readonly string[]
                              | string[];
                      }
                    ? true
                    : O extends { requireReputation: string }
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
