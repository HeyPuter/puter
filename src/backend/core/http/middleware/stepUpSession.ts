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
import type { IConfig } from '../../../types';
import type { UserRow } from '../../../stores/user/UserStore';
import type { TokenService } from '../../../services/auth/TokenService';
import { sessionCookieFlags } from '../../../util/cookieFlags';
import { HttpError } from '../HttpError';

// Make sure the `Express.Request.actor` augmentation is in scope.
import '../expressAugmentation';

/**
 * Step-up ("elevation") sessions — a second factor layered on top of an
 * ordinary session for privileged endpoints (`adminOnly` routes).
 *
 * An ordinary session cookie proves only that someone holds the credential; for
 * privileged endpoints that isn't enough, since a leaked session would inherit
 * the privilege. Elevation makes the caller re-prove identity — a fresh TOTP
 * code when 2FA is enabled, otherwise the account password — via
 * `POST /auth/elevate`, which mints the cookie below.
 *
 * Both halves are required and neither is sufficient: gates demand a live
 * session actor AND this proof, and the proof is bound to that actor's
 * `user_uuid`. So a stolen session can't elevate itself, and a stolen elevation
 * proof is inert without the session.
 *
 * The proof travels as an httpOnly cookie for browsers, or as the
 * `x-puter-elevation` header for API clients (which have no cookie jar). The
 * two are equivalent — both are the same signed token, and obtaining either
 * requires the password/TOTP. Nothing is exempt from the requirement: there is
 * deliberately no carve-out for any credential kind, because any credential a
 * stolen session can obtain *without* re-proving identity would be a way around
 * this control rather than an exception to it.
 *
 * The token has its own scope and `purpose` claim and carries no auth `type`
 * claim, so `AuthService.authenticate` rejects it — it can never be spent as a
 * main auth token even though every scope shares `jwt_secret_v2`.
 */

export const STEP_UP_COOKIE_NAME = 'puter_elevated';
export const STEP_UP_HEADER_NAME = 'x-puter-elevation';
export const STEP_UP_SCOPE = 'step-up';
export const STEP_UP_PURPOSE = 'elevation';
export const STEP_UP_TTL_SECONDS = 7 * 24 * 60 * 60;

interface StepUpPayload {
    user_uuid: string;
    purpose: string;
}

/** Sign an elevation token bound to the user's uuid. */
export function signStepUpToken(
    tokenService: TokenService,
    user: Pick<UserRow, 'uuid'>,
): string {
    return tokenService.sign(
        STEP_UP_SCOPE,
        { user_uuid: user.uuid, purpose: STEP_UP_PURPOSE },
        { expiresIn: STEP_UP_TTL_SECONDS },
    );
}

/**
 * Cookie flags for the elevation cookie. `domain` and `maxAge` are what
 * `sessionCookieFlags` doesn't set: the domain keeps the cookie readable across
 * the site's subdomains (privileged endpoints aren't all on one origin), and
 * `maxAge` gives the elevation its lifetime.
 */
export function stepUpCookieOptions(config: IConfig): {
    httpOnly: true;
    sameSite: 'none' | 'lax';
    secure: boolean;
    maxAge: number;
    domain?: string;
} {
    return {
        ...sessionCookieFlags(config),
        httpOnly: true,
        maxAge: STEP_UP_TTL_SECONDS * 1000,
        ...(config.domain ? { domain: config.domain } : {}),
    };
}

/**
 * True iff a valid elevation proof (cookie or `x-puter-elevation` header) is
 * present AND bound to the acting user. Never throws — a missing/expired/
 * mismatched proof returns false so callers can prompt for the second factor
 * instead of erroring.
 */
export function verifyStepUpSession(
    req: Request,
    deps: { tokenService: TokenService },
): boolean {
    const header = req.headers?.[STEP_UP_HEADER_NAME];
    const token =
        req.cookies?.[STEP_UP_COOKIE_NAME] ??
        (typeof header === 'string' ? header : undefined);
    const actorUuid = req.actor?.user?.uuid;
    if (!token || !actorUuid) return false;
    try {
        const payload = deps.tokenService.verify<StepUpPayload>(
            STEP_UP_SCOPE,
            token,
        );
        return (
            payload?.purpose === STEP_UP_PURPOSE &&
            payload.user_uuid === actorUuid
        );
    } catch {
        return false;
    }
}

/**
 * Require an elevated session. Runs after the privilege gate it supplements
 * (`adminOnlyGate`), so it only adds the re-authentication requirement.
 *
 * Narrow by design — the only exemption is the app-gated path:
 *
 *   - Not env-conditional, so the flow exercised locally is the one that ships.
 *   - No carve-out for full-access tokens. That looks safe (a deliberately
 *     minted, header-borne credential) but isn't: `/auth/create-access-token`
 *     needs only a session, so a stolen session can mint a full-access token
 *     without ever re-proving identity and walk straight around this gate.
 *   - No carve-out based on how the credential arrived (cookie vs bearer). The
 *     holder of a token chooses which header to put it in, so that distinction
 *     is attacker-controlled and worthless as a gate.
 *   - `allowedAppUids`: the exemption is keyed off the *token*, not the route.
 *     An actor whose token carries one of these allowlisted app ids (an admin
 *     acting through an allowlisted app) is exempt — that actor can't elevate at
 *     all (apps have no password/TOTP and are blocked from `/auth/elevate`), so
 *     step-up is unsatisfiable for it. A token WITHOUT an allowlisted app id — a
 *     root/human session — still requires step-up, exactly as it would on a
 *     route with no `allowedAppIds`. So this is not a session or token-kind
 *     carve-out: reaching the exempt path needs an admin's OAuth grant to a
 *     specific allowlisted app.
 *
 * The invariant for the human path: reaching a privileged endpoint requires
 * proving the password or a TOTP code within the elevation's lifetime.
 *
 * A caller without a valid elevation proof is rejected with
 * `elevation_required`; `factor` tells the client which credential to collect.
 */
export function createStepUpGate(deps: {
    tokenService: TokenService;
    allowedAppUids?: readonly string[];
}): RequestHandler {
    return (req, _res, next) => {
        // Exempt only an actor whose token carries one of the route's
        // allowlisted app ids: an admin acting through an allowlisted app can't
        // elevate, so step-up is unsatisfiable for it. Any other actor — most
        // importantly a root/human session with no app id in its token — falls
        // through and must present the elevation proof.
        const appUid = req.actor?.app?.uid;
        if (appUid && deps.allowedAppUids?.includes(appUid)) {
            next();
            return;
        }
        if (verifyStepUpSession(req, deps)) {
            next();
            return;
        }
        next(
            new HttpError(403, 'Re-authentication required', {
                legacyCode: 'elevation_required',
                fields: {
                    code: 'elevation_required',
                    factor: req.actor?.user?.otp_enabled ? 'otp' : 'password',
                },
            }),
        );
    };
}
