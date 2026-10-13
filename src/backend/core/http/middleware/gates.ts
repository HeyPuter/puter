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

import type { NextFunction, Request, RequestHandler } from 'express';
import {
    assertActorHasCredits,
    assertActorHasSubscription,
    type CreditMetering,
    type SubscriptionGateHook,
    type SubscriptionMetering,
    type SubscriptionRequirement,
} from '../../../services/metering/enforcement.js';
import type { IConfig } from '../../../types';
import {
    isCardVerificationEnabled,
    type CardFallbackDeps,
} from '../../../util/cardFallback';
import { reserveUsernames } from '../../../util/reservedUsernames';
import {
    isAccountContext,
    isAppActor,
    isPlainUserActor,
    type Actor,
} from '../../actor';
import {
    assertActorMeetsReputation,
    type ReputationRequirement,
} from '../../reputation.js';
import { HttpError } from '../HttpError';
import type { AccountGateUser, VerificationFactor } from '../types';
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
 * Route middleware from an assertion: a throw or a rejection goes to
 * `next(err)`, anything else to `next()`. A synchronous check calls `next`
 * synchronously.
 */
export const gate = (
    check: (req: Request) => void | Promise<void>,
): RequestHandler => {
    return (req, _res, next) => {
        let pending: void | Promise<void>;
        try {
            pending = check(req);
        } catch (err) {
            next(err);
            return;
        }
        if (!pending) {
            next();
            return;
        }
        return settleGate(pending, next);
    };
};

const settleGate = async (
    pending: Promise<void>,
    next: NextFunction,
): Promise<void> => {
    try {
        await pending;
    } catch (err) {
        next(err);
        return;
    }
    next();
};

/**
 * Skip this route entirely (via `next('route')`) when the request's leftmost
 * subdomain doesn't match. This _isn't_ a rejection — it lets a different route
 * matcher handle the request.
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

/** 401 for anonymous requests, 403 for suspended accounts. */
export const requireAuthGate = (): RequestHandler =>
    gate((req) => {
        if (req.appBlocked) {
            throw new HttpError(
                403,
                'This app is not allowed to access Puter resources',
                { legacyCode: 'app_blocked' },
            );
        }
        if (!req.actor) throw rejectAuth(req);
        assertNotSuspended(req.actor.user);
    });

/**
 * Reject app-under-user and access-token actors with 403. `allowFullAccess`
 * (route option `allowFullAccessToken`) admits full-access personal access
 * tokens only; apps and scoped tokens are always rejected. Never set it on
 * account or security management routes.
 */
export const requireUserActorGate = (
    opts: { allowFullAccess?: boolean } = {},
): RequestHandler =>
    gate((req) => {
        const actor = req.actor;
        // requireAuth runs first; this gate just narrows the actor type.
        if (!actor) throw rejectAuth(req);
        const appBlocked = isAppActor(actor);
        // `isAccountContext`, not the `fullAccess` flag: an app anywhere in the
        // chain, or an actor that skipped `makeActor`, answers no.
        const tokenBlocked =
            !!actor.accessToken &&
            !(opts.allowFullAccess && isAccountContext(actor));
        if (appBlocked || tokenBlocked) {
            throw new HttpError(
                403,
                'This endpoint is only available to user sessions',
                { legacyCode: 'forbidden' },
            );
        }
    });

/**
 * Reject bare account-session actors (no app, no access token) so a session
 * token never doubles as an API credential. Only rejects that shape; which
 * delegated credentials are acceptable is decided by the gates it composes
 * with.
 */
export const assertNotUserSession = (
    actor: Pick<Actor, 'app' | 'accessToken' | 'session'> | null | undefined,
): void => {
    if (!actor) return; // anonymous requests are the auth gate's problem
    if (!isPlainUserActor(actor)) return;
    // App-less workers hold a session-type token with `kind='worker'`: a
    // revocable deployment credential, not a browser sign-in.
    if (actor.session?.kind === 'worker') return;
    throw new HttpError(
        403,
        'This API cannot be called with an account session token. ' +
            'Create an API token from the ' +
            'dashboard (Account → API Token).',
        { legacyCode: 'app_or_api_token_required' },
    );
};

/** Route-option form of {@link assertNotUserSession} (`noUserSession: true`). */
export const noUserSessionGate = (): RequestHandler =>
    gate((req) => {
        if (!req.actor) throw rejectAuth(req);
        assertNotUserSession(req.actor);
    });

export const requireNonAccessTokenGate = (): RequestHandler =>
    gate((req) => {
        const actor = req.actor;
        if (!actor) throw rejectAuth(req);
        // Full-access tokens pass; `requireUserActorGate` still keeps them
        // off account management.
        if (actor.accessToken && !actor.accessToken.fullAccess) {
            throw new HttpError(
                403,
                'Access tokens are not allowed to access this resource',
                { legacyCode: 'forbidden' },
            );
        }
    });

/** Built-in admin usernames that always pass `adminOnly`. */
export const DEFAULT_ADMIN_USERNAMES = ['admin', 'system'] as const;

/**
 * Reject unless the username is `admin`, `system`, or one of `extras`, and the
 * actor carries no app anywhere in its token chain (`effectiveApp`). With
 * `appGated` a direct app-under-user actor is deferred to `allowedAppIdsGate`
 * instead; app-issued access tokens are rejected even then, since that gate
 * cannot see them. Does not imply `requireUserActor`.
 */
export const adminOnlyGate = (
    extras: readonly string[] = [],
    opts: { appGated?: boolean } = {},
): RequestHandler => {
    // Match the username column's case-insensitive collation.
    const allowList = new Set<string>(
        [...DEFAULT_ADMIN_USERNAMES, ...extras].map((u) => u.toLowerCase()),
    );
    // Admin follows the name, so a name that grants it must never be claimable.
    reserveUsernames(allowList);
    return gate((req) => {
        const username = req.actor?.user.username;
        const chainApp = req.actor?.effectiveApp ?? null;
        if (
            !username ||
            !allowList.has(username.toLowerCase()) ||
            (chainApp && !(opts.appGated && isAppActor(req.actor)))
        ) {
            throw new HttpError(403, 'Only admins may request this resource', {
                legacyCode: 'forbidden',
            });
        }
    });
};

/**
 * Reject unless the user's email is confirmed. Inert unless
 * `strict_email_verification_required` is set, so deployments without email
 * delivery are not locked out.
 */
export const requireVerifiedGate = (strictFlag: boolean): RequestHandler =>
    gate((req) => assertVerifiedEmail(strictFlag, req.actor?.user));

/** Just the seat read the 2FA gate needs, so gates stay store-agnostic. */
export interface Team2faLookup {
    getOrgSeat(
        userId: number,
    ): Promise<{ require_2fa?: number | null } | null | undefined>;
}

/**
 * Reject a team-provisioned account whose team requires 2FA until it has some.
 * Derived, not stamped: a flag left behind by a member leaving would lock them
 * out of their own account with no team left to clear it.
 */
export const assertTeam2fa = async (
    user: AccountGateUser | undefined,
    teams: Team2faLookup | undefined,
): Promise<void> => {
    if (!user || user.otp_enabled) return;
    if (typeof user.id !== 'number' || !teams?.getOrgSeat) return;
    const seat = await teams.getOrgSeat(user.id);
    if (!seat || Number(seat.require_2fa) !== 1) return;
    throw new HttpError(
        403,
        'Your team requires two-factor authentication. Set it up to continue.',
        { legacyCode: 'two_factor_required' as never },
    );
};

/** {@link assertTeam2fa} as route middleware. */
export const requireTeam2fa = (
    teams: Team2faLookup | undefined,
): RequestHandler => gate((req) => assertTeam2fa(req.actor?.user, teams));

/**
 * Reject accounts still pending a signup-time verification (email, phone, card,
 * password change). Default-on for authenticated routes; the flows that clear
 * these flags opt out with `allowUnconfirmed: true`.
 */
export const requireVerifiedAccount = (): RequestHandler =>
    gate((req) => assertVerifiedAccount(req.actor?.user));

/**
 * The check behind {@link requireVerifiedAccount}, for auth paths that build
 * their own actor outside the route-option chain (e.g. WebDAV). Throws 403 with
 * a per-gate legacy code so clients can show the right prompt.
 */
export const assertVerifiedAccount = (
    user: AccountGateUser | undefined,
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
                legacyCode: 'phone_verification_required',
            },
        );
    }
    if (user?.requires_card_verification) {
        throw new HttpError(403, 'Please verify your card to continue', {
            legacyCode: 'card_verification_required',
        });
    }
    // A team seat signs in on a password its administrator still holds,
    // so it reaches nothing until it has replaced that password.
    if (user?.requires_password_change) {
        throw new HttpError(
            403,
            'Please choose your own password to continue',
            {
                legacyCode: 'password_change_required',
            },
        );
    }
};

// -- Per-verification gates ------------------------------------------
//
// Opt-in gates requiring a factor to have actually been verified, unlike
// `requireVerifiedAccount` which only rejects accounts still pending one.
// There is no "verified" column: the proof is the artifact (`phone`,
// `card_fingerprint`) plus a cleared pending flag, so an account mid-flow
// fails on the flag rather than passing on a stale artifact.

export const hasVerifiedPhone = (user: AccountGateUser | undefined): boolean =>
    Boolean(user?.phone) && !user?.requires_phone_verification;

export const hasVerifiedCard = (user: AccountGateUser | undefined): boolean =>
    Boolean(user?.card_fingerprint) && !user?.requires_card_verification;

const PHONE_REQUIRED_MESSAGE = 'Please verify your phone number to continue';
const CARD_REQUIRED_MESSAGE = 'Please verify your card to continue';

/** 403 `phone_verification_required` unless a verified phone is on file. */
export const assertPhoneVerified = (
    user: AccountGateUser | undefined,
): void => {
    if (hasVerifiedPhone(user)) return;
    throw new HttpError(403, PHONE_REQUIRED_MESSAGE, {
        legacyCode: 'phone_verification_required',
    });
};

/** Route-option form of {@link assertPhoneVerified} (`requirePhoneVerified`). */
export const requirePhoneVerifiedGate = (): RequestHandler =>
    gate((req) => assertPhoneVerified(req.actor?.user));

export interface AnyVerifiedDeps extends CardFallbackDeps {
    /** A paid plan implies a card on file, so it counts as card-verified. */
    hasPaidPlan: (actor: Actor) => Promise<boolean>;
}

const hasCardEvidence = async (
    actor: Actor | undefined,
    deps: Pick<AnyVerifiedDeps, 'hasPaidPlan'>,
): Promise<boolean> =>
    hasVerifiedCard(actor?.user) ||
    (actor !== undefined && (await deps.hasPaidPlan(actor)));

/**
 * 403 `card_verification_required` unless a card is on file or the plan is
 * paid.
 */
export const requireCardVerifiedGate = (
    deps: Pick<AnyVerifiedDeps, 'hasPaidPlan'>,
): RequestHandler =>
    gate(async (req) => {
        if (await hasCardEvidence(req.actor, deps)) return;
        throw new HttpError(403, CARD_REQUIRED_MESSAGE, {
            legacyCode: 'card_verification_required',
        });
    });

const isFactorVerified = (
    factor: VerificationFactor,
    actor: Actor | undefined,
    deps: Pick<AnyVerifiedDeps, 'hasPaidPlan'>,
): Promise<boolean> =>
    factor === 'phone'
        ? Promise.resolve(hasVerifiedPhone(actor?.user))
        : hasCardEvidence(actor, deps);

/** Whether this deployment can run the factor's verification flow at all. */
const isFactorVerifiable = async (
    factor: VerificationFactor,
    deps: CardFallbackDeps,
): Promise<boolean> =>
    factor === 'phone'
        ? deps.smsConfigured()
        : (await isCardVerificationEnabled(deps)) === true;

/**
 * Reject unless at least one of `factors` is verified. Only factors this
 * deployment can verify are asked for, so with none verifiable the gate is
 * inert. The 403 carries the first verifiable factor's code and lists every
 * verifiable one in `factors`.
 */
export const assertAnyVerified = async (
    actor: Actor | undefined,
    factors: readonly VerificationFactor[],
    deps: AnyVerifiedDeps,
): Promise<void> => {
    // In the route's order, so a verified phone never costs the plan lookup.
    for (const factor of factors) {
        if (await isFactorVerified(factor, actor, deps)) return;
    }
    const verifiable: VerificationFactor[] = [];
    for (const factor of factors) {
        if (verifiable.includes(factor)) continue;
        if (await isFactorVerifiable(factor, deps)) verifiable.push(factor);
    }
    if (verifiable.length === 0) return;
    const [lead] = verifiable;
    throw new HttpError(
        403,
        lead === 'phone' ? PHONE_REQUIRED_MESSAGE : CARD_REQUIRED_MESSAGE,
        {
            legacyCode:
                lead === 'phone'
                    ? 'phone_verification_required'
                    : 'card_verification_required',
            fields: { factors: verifiable },
        },
    );
};

/** Route-option form of {@link assertAnyVerified} (`requireAnyVerified`). */
export const requireAnyVerifiedGate = (
    factors: readonly VerificationFactor[],
    deps: AnyVerifiedDeps,
): RequestHandler => gate((req) => assertAnyVerified(req.actor, factors, deps));

export const assertNotSuspended = (user: AccountGateUser | undefined): void => {
    if (user?.suspended) {
        throw new HttpError(403, 'Account suspended', {
            legacyCode: 'forbidden',
        });
    }
};

/**
 * Reject actors acting as an app that is not allow-listed — the app they carry
 * directly, or the one that issued their access token. Actors with no app
 * anywhere in the chain pass. Use it to keep other apps out, never as proof an
 * app is present.
 */
export const allowedAppIdsGate = (
    allowedAppUids: readonly string[],
): RequestHandler => {
    const allowList = new Set(allowedAppUids);
    return gate((req) => {
        const appUid = req.actor?.effectiveApp?.uid;
        if (appUid && !allowList.has(appUid)) {
            throw new HttpError(403, 'This app may not request this resource', {
                legacyCode: 'forbidden',
            });
        }
    });
};

// -- Metering and reputation gates -----------------------------------
//
// The decisions live in their own modules because the driver dispatch path
// calls them directly: `/drivers/call` is one shared route, so a per-driver
// requirement can't ride on the route chain.

/**
 * Reject a caller whose account isn't trusted enough for this surface
 * (`requireReputation`). Inert unless the running config gives the named tier a
 * minimum score.
 */
export const requireReputationGate = (
    config: IConfig,
    requirement: ReputationRequirement,
): RequestHandler =>
    gate((req) => assertActorMeetsReputation(req.actor, requirement, config));

/**
 * Reject a caller whose plan doesn't include this surface
 * (`requireSubscription`): `true` accepts any non-free plan, an array of policy
 * ids only those.
 */
export const requireSubscriptionGate = (
    metering: SubscriptionMetering | undefined,
    config: IConfig,
    requirement: SubscriptionRequirement,
    hook?: Omit<SubscriptionGateHook, 'req'>,
): RequestHandler =>
    gate((req) =>
        assertActorHasSubscription(
            metering,
            req.actor,
            requirement,
            config,
            hook && { ...hook, req },
        ),
    );

/**
 * Reject an authenticated caller with nothing left of their budget
 * (`requireCredits`). Anonymous callers pass: signed-URL routes authorize on
 * the URL, with no account to charge. Answered from the metering service's
 * per-actor cache, so it normally costs a map lookup.
 */
export const requireCreditsGate = (
    metering: CreditMetering | undefined,
    config: IConfig,
): RequestHandler =>
    gate((req) => assertActorHasCredits(metering, req.actor, config));
