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

import bcrypt from 'bcrypt';
import type { Request, RequestHandler, Response } from 'express';
import crypto from 'node:crypto';
import { v4 as uuidv4, validate as validateUuid } from 'uuid';
import validator from 'validator';
import { Controller, Get, Post } from '../../core/http/decorators.js';
import type { HttpErrorOptions } from '../../core/http/HttpError.js';
import { HttpError } from '../../core/http/HttpError.js';
import { antiCsrf } from '../../core/http/middleware/antiCsrf.js';
import { generateCaptcha } from '../../core/http/middleware/captcha.js';
import type { Actor } from '../../core/actor.js';
import { checkRateLimit } from '../../core/http/middleware/rateLimit.js';
import {
    signStepUpToken,
    STEP_UP_COOKIE_NAME,
    stepUpCookieOptions,
} from '../../core/http/middleware/stepUpSession.js';
import {
    createUserProtectedGate,
    createWebSessionActorGate,
} from '../../core/http/middleware/userProtected.js';
import type { PuterRouter } from '../../core/http/PuterRouter.js';
import {
    ROUTES_METADATA_KEY,
    type CollectedRoute,
    type RouteMethod,
    type RouteOptions,
    type RoutePath,
} from '../../core/http/types.js';
import {
    createRecoveryCode,
    hashRecoveryCode,
    createSecret as otpCreateSecret,
    verify as verifyOtp,
} from '../../services/auth/OTPUtil.js';
import type { UserRow } from '../../stores/user/UserStore.js';
import { isOwnedEmailConflict } from '../../stores/user/UserStore.js';
import { sessionCookieFlags } from '../../util/cookieFlags.js';
import { cleanEmail, isBlockedEmail } from '../../util/email.js';
import { generate_identifier } from '../../util/identifier.js';
import { parsePhone } from '../../util/phone.js';
import { getTaskbarItems } from '../../util/taskbarItems.js';
import {
    generateDefaultFsentries,
    promoteToVerifiedGroup,
} from '../../util/userProvisioning.js';
import {
    APP_DATA_PERMISSION_PREFIX,
    appDataSharingAllowed,
    parseAppDataPermission,
} from '../../services/permission/appDataScopes.js';
import { PuterController } from '../types.js';

const USERNAME_REGEX = /^\w{1,}$/;
const USERNAME_MAX_LENGTH = 45;
const FINGERPRINT_MAX_LENGTH = 128;
// One consent prompt covers a handful of scopes at most. The cap keeps a
// crafted request from turning a single grant call into a bulk write.
const MAX_PERMISSIONS_PER_REQUEST = 16;
const DISPATCH_ID_MAX_LENGTH = 128;
// Default SMS send attempts before the card fallback opens.
const DEFAULT_CARD_FALLBACK_ATTEMPTS = 2;
// /send-confirm-phone route rate limit. Also caps the fallback's
// `after_attempts`: requests past the route limit are rejected in middleware
// and never reach the attempt counter, so a higher threshold could never be
// crossed.
const SEND_PHONE_RATE_LIMIT = 10;
const SEND_PHONE_RATE_WINDOW_MS = 60 * 60_000;

// -- Post-login route limits -----------------------------------------
//
// The credential legs above (login, signup, recovery, confirmation) each
// carry their own limit. Everything a session can reach *after* signing
// in shares the four shapes below, keyed on the actor rather than the
// network — a per-account ceiling is the meaningful one once we know who
// is calling.

/**
 * Mints or reconfigures a credential. Deliberately an hour-scale window: these
 * are human actions taken a handful of times, and an unbounded rate turns one
 * compromised session into a durable foothold.
 */
const CREDENTIAL_MINT_LIMIT = {
    scope: 'auth-credential-mint',
    limit: 20,
    window: 60 * 60_000,
    key: 'user',
} as const;

/**
 * Second-factor configuration, including the verify leg. Shorter window than
 * the mint limit because enabling 2FA legitimately involves a few attempts in a
 * row, but unbounded verification is a TOTP brute force.
 */
const TWO_FACTOR_LIMIT = {
    scope: 'auth-2fa-configure',
    limit: 30,
    window: 15 * 60_000,
    key: 'user',
} as const;

/** Permission and membership writes. Never called in a loop by a client. */
const GRANT_LIMIT = {
    scope: 'auth-grant',
    limit: 60,
    window: 60_000,
    key: 'user',
} as const;

/**
 * Read-only checks the GUI makes on nearly every interaction. The ceiling is
 * high enough that only a runaway loop reaches it.
 */
const AUTH_CHECK_LIMIT = {
    scope: 'auth-check',
    limit: 300,
    window: 60_000,
    key: 'user',
} as const;

/**
 * Anti-CSRF token issuance. Clients mint a fresh token per protected mutation
 * and cache nothing, so this ceiling has to clear the SUM of the budgets that
 * spend tokens — matching any single one of them guarantees the gate fires
 * before the mutation it guards does.
 *
 * What spends them: the session-authenticated download path, one token per
 * file, at the read budget of 600/min — a multi-selection download burns tokens
 * exactly the way a bulk delete burns its own budget, so this tracks the bulk
 * figure used for filesystem mutations; logout at 60/min; and the
 * session-management writes (revoke, rename), which a person triggers a handful
 * of times. Call it ~700/min of real demand, and leave enough on top that a
 * bulk operation runs out of files before it runs out of tokens.
 */
const ANTI_CSRF_MINT_LIMIT = {
    scope: 'anticsrf',
    limit: 1200,
    window: 60_000,
    key: 'user',
} as const;

/** Settings-page reads — enumerating sessions, permissions, groups. */
const AUTH_LIST_LIMIT = {
    scope: 'auth-list',
    limit: 120,
    window: 60_000,
    key: 'user',
} as const;

/** Session plumbing: logout, GUI token, cookie sync. */
const SESSION_LIMIT = {
    scope: 'auth-session',
    limit: 60,
    window: 60_000,
    key: 'user',
} as const;
// Once the threshold is crossed the fallback stays open this long, so the
// user can finish the card flow without racing the attempt counter's expiry.
const CARD_FALLBACK_OPEN_TTL_SECONDS = 24 * 60 * 60;
// How long a failed-SMS-send record stays readable by its error_id — long
// enough to cover the typical support round-trip.
const SMS_SEND_ERROR_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * Whether this account has already been through the card flow. Both halves
 * matter: the pending flag being clear only says nobody asked, while the
 * fingerprint is the artifact a completed check leaves behind. A route that
 * requires a verified card (`requireCardVerified`) sends users here with the
 * flag clear and no card on file, and answering "already verified" on the flag
 * alone would bounce them between a dialog that reports success and a route
 * that keeps refusing.
 */
const cardAlreadyVerified = (user: {
    card_fingerprint?: string | null;
    requires_card_verification?: boolean;
}): boolean =>
    Boolean(user.card_fingerprint) && !user.requires_card_verification;
const RESERVED_USERNAMES = new Set([
    'admin',
    'administrator',
    'root',
    'system',
    'puter',
    'www',
    'api',
    'support',
    'help',
    'info',
    'contact',
    'mail',
    'email',
    'null',
    'undefined',
    'test',
    'guest',
    'anonymous',
    'user',
    'users',
]);

/**
 * Auth controller — login/logout, permission grants/revokes, session
 * management, OTP, and permission checks.
 *
 * Routes are declared via decorators (@Get/@Post on each handler). The five
 * `/user-protected/*` and `/user-protected/delete-own-user` routes also need a
 * per-instance `createUserProtectedGate(...)` middleware built from
 * `this.config / this.stores / this.services`, which can't live in a static
 * decorator literal — those are wired imperatively in the `registerRoutes`
 * override below. The override also re-runs the default decorator-walker logic
 * so the rest of the routes register normally.
 */
@Controller('')
export class AuthController extends PuterController {
    @Post('/login/wait', {
        subdomain: ['api'],
        rateLimit: [
            // A client will make a request to this every 10 seconds while waiting for the login to complete, so we allow a higher limit than the main /login endpoint.
            { scope: 'login-wait', limit: 100, window: 15 * 60_000, key: 'ip' },
        ],
    })
    async loginWait(req: Request, res: Response) {
        const { session } = req.body;
        // validate uuid to prevent ultra long key or listening on pubsub.login.*
        if (!session || !validateUuid(session)) {
            throw new HttpError(400, 'session is required.', {
                legacyCode: 'bad_request',
            });
        }

        // Browser-only gate. The session id is client-chosen and travels in a
        // link, so it is not a secret — the `Origin` header is what actually
        // says who is asking, and only a browser is prevented from lying about
        // it. A caller with no `Origin` (curl, a server-side fetch) could
        // otherwise collect a token minted for someone else's app just by
        // knowing the id.
        //
        // `"null"` is rejected too: sandboxed iframes and `file://` documents
        // serialise their opaque origin that way, and two *unrelated* opaque
        // origins would compare equal to each other.
        const reqOrigin = req.headers.origin;
        if (!reqOrigin || reqOrigin === 'null') {
            throw new HttpError(403, 'Origin not allowed', {
                legacyCode: 'forbidden',
            });
        }

        // The app identity this caller is allowed to collect a token for,
        // derived from the browser-attested header rather than anything in
        // the request body — so no client, honest or not, can influence the
        // comparison made after the token arrives.
        const expectedAppUid =
            await this.services.auth.appUidFromOrigin(reqOrigin);

        const { resolve, promise } = Promise.withResolvers<void>();

        let token: string | null = null;
        const listener = (_key: string, value: { authtoken: string }) => {
            token = value.authtoken;
            resolve();
        };
        this.clients.event.on(`pubsub.login.${session}`, listener);

        const timeout = new Promise<void>((resolve) =>
            setTimeout(resolve, 10000),
        );
        await Promise.race([promise, timeout]);
        this.clients.event.off(`pubsub.login.${session}`, listener);
        if (!token) {
            throw new HttpError(408, 'Request timeout.', {
                legacyCode: 'request_timeout',
            });
        }

        // Audience check. The postMessage hand-off this relay stands in for
        // is origin-bound for free — it posts with `targetOrigin`, so a page
        // can only ever receive a token minted for *itself*. Delivering
        // server-side dropped that binding; this restores it. Without it a
        // popup talked into minting for app X (see `trustsOpenerOriginParam`
        // in the GUI) hands X's token to whoever holds the session id.
        if (!this.#tokenIsForApp(token, expectedAppUid)) {
            // Deliberately the same 408 the no-token path returns: a caller
            // learns only that nothing arrived for them, not that a token
            // for a different app went past.
            throw new HttpError(408, 'Request timeout.', {
                legacyCode: 'request_timeout',
            });
        }

        res.json({
            auth_token: token,
        });
    }

    /**
     * Whether a relayed token is an app-under-user token minted for
     * `expectedAppUid`. Verifies the signature — an unverified decode would let
     * a caller relay a token whose claims it wrote itself.
     */
    #tokenIsForApp(token: string, expectedAppUid: string): boolean {
        try {
            const payload = this.services.token.verify<{
                type?: string;
                app_uid?: string;
            }>('auth', token);
            return (
                payload.type === 'app-under-user' &&
                !!payload.app_uid &&
                payload.app_uid === expectedAppUid
            );
        } catch {
            // Malformed, expired, or signed with a key we don't hold.
            return false;
        }
    }
    @Post('/login/set', {
        subdomain: ['api'],
        // Unauthenticated fan-out to every `/login/wait` listener on the
        // session id. A legitimate popup posts here exactly once per sign-in,
        // so a generous per-IP cap costs honest traffic nothing while denying
        // an attacker unbounded attempts to land a token on a guessed id.
        rateLimit: [
            { scope: 'login-set', limit: 60, window: 15 * 60_000, key: 'ip' },
        ],
    })
    async loginSet(req: Request, res: Response) {
        const { session, auth_token } = req.body;
        if (!session || !auth_token || !validateUuid(session)) {
            throw new HttpError(400, 'session and auth_token are required.', {
                legacyCode: 'bad_request',
            });
        }

        this.clients.event.emit(
            `pubsub.login.${session}`,
            {
                authtoken: auth_token,
            },
            {},
        );

        res.json({ success: true });
    }

    // -- Login -------------------------------------------------------

    @Post('/login', {
        // Returns a full session token in the response body. Reflected CORS
        // would otherwise let any page trade a password for that token and
        // read it — third-party sign-in goes through `puter.auth.signIn()`,
        // whose popup runs on this origin and yields an app-scoped token.
        guiOriginOnly: true,
        captcha: true,
        // Two limits: per-fingerprint keeps users behind a shared IP
        // (offices, campuses) from throttling each other, while the
        // coarser per-IP backstop stops an attacker from minting fresh
        // fingerprint buckets by rotating client-controlled headers
        // (User-Agent etc.). Same pattern on the other unauthenticated
        // credential endpoints below.
        rateLimit: [
            { scope: 'login', limit: 10, window: 15 * 60_000 },
            { scope: 'login-ip', limit: 50, window: 15 * 60_000, key: 'ip' },
        ],
    })
    async handleLogin(req: Request, res: Response): Promise<void> {
        const { username, email, password } = req.body;

        if (!username && !email) {
            throw new HttpError(400, 'Username or email is required.', {
                legacyCode: 'bad_request',
            });
        }
        if (!password || typeof password !== 'string') {
            throw new HttpError(400, 'Password is required.', {
                legacyCode: 'password_required',
            });
        }
        if (password.length < (this.config.min_pass_length || 6)) {
            throw new HttpError(400, 'Invalid password.', {
                legacyCode: 'bad_request',
            });
        }

        // Look up user
        let user;
        if (username) {
            if (typeof username !== 'string')
                throw new HttpError(400, 'username must be a string.', {
                    legacyCode: 'bad_request',
                });
            user = await this.stores.user.getByUsername(username);
        } else {
            user = await this.stores.user.getByEmail(email);
        }

        if (!user) {
            throw new HttpError(
                404,
                username ? 'Username not found.' : 'Email not found.',
                { legacyCode: 'not_found' },
            );
        }
        if (
            user.username === 'system' &&
            !(this.config as { allow_system_login?: boolean })
                .allow_system_login
        ) {
            throw new HttpError(
                404,
                username ? 'Username not found.' : 'Email not found.',
                { legacyCode: 'not_found' },
            );
        }
        if (user.suspended) {
            throw new HttpError(401, 'This account is suspended.', {
                legacyCode: 'account_suspended',
            });
        }
        if (user.password === null) {
            throw new HttpError(401, 'Incorrect password.', {
                legacyCode: 'unauthorized',
            });
        }

        // Verify password
        const passwordMatch = await bcrypt.compare(
            password,
            user.password as string,
        );
        if (!passwordMatch) {
            throw new HttpError(401, 'Incorrect password.', {
                legacyCode: 'password_mismatch',
            });
        }

        const reauthAuthId = this.#extractAuthIdFromReauthToken(
            req.body.reauth_token,
        );
        await this.#enforceAuthIdMatch(req, user, reauthAuthId);

        // OTP branching — if 2FA enabled, return a short-lived OTP JWT.
        // Re-bind the verified `auth_id` into the JWT so the follow-up
        // OTP/recovery call can re-enforce the match without re-trusting
        // a free-form claim from the client.
        if (user.otp_enabled) {
            const otpClaims: Record<string, unknown> = {
                user_uid: user.uuid,
                purpose: 'otp-login',
            };
            if (reauthAuthId) otpClaims.auth_id = reauthAuthId;
            const otp_jwt_token = this.services.token.sign('otp', otpClaims, {
                expiresIn: '5m',
            });

            res.status(202).json({
                proceed: true,
                next_step: 'otp',
                otp_jwt_token,
            });
            return;
        }

        await this.#completeLogin(req, res, user);
    }

    // -- Login: OTP verification -------------------------------------

    @Post('/login/otp', {
        // Second leg of `/login` — also completes into `#completeLogin`.
        guiOriginOnly: true,
        captcha: true,
        rateLimit: [
            { scope: 'login-otp', limit: 15, window: 30 * 60_000 },
            {
                scope: 'login-otp-ip',
                limit: 60,
                window: 30 * 60_000,
                key: 'ip',
            },
        ],
    })
    async handleLoginOtp(req: Request, res: Response): Promise<void> {
        const { token, code } = req.body;
        if (!token)
            throw new HttpError(400, 'token is required.', {
                legacyCode: 'bad_request',
            });
        if (!code)
            throw new HttpError(400, 'code is required.', {
                legacyCode: 'bad_request',
            });

        let decoded;
        try {
            decoded = this.services.token.verify<{
                user_uid: string;
                purpose: string;
                auth_id?: string;
            }>('otp', token);
        } catch {
            throw new HttpError(400, 'Invalid token.', {
                legacyCode: 'bad_request',
            });
        }
        if (!decoded.user_uid || decoded.purpose !== 'otp-login') {
            throw new HttpError(400, 'Invalid token.', {
                legacyCode: 'bad_request',
            });
        }

        const user = await this.stores.user.getByUuid(decoded.user_uid);
        if (!user)
            throw new HttpError(404, 'User not found.', {
                legacyCode: 'not_found',
            });
        if (user.suspended) {
            throw new HttpError(401, 'This account is suspended.', {
                legacyCode: 'account_suspended',
            });
        }

        if (!verifyOtp(user.username, user.otp_secret, code)) {
            res.json({ proceed: false });
            return;
        }

        await this.#enforceAuthIdMatch(req, user, decoded.auth_id ?? null);

        await this.#completeLogin(req, res, user);
    }

    // -- Login: recovery code ----------------------------------------

    @Post('/login/recovery-code', {
        // Second leg of `/login` — also completes into `#completeLogin`.
        guiOriginOnly: true,
        captcha: true,
        rateLimit: [
            { scope: 'login-recovery', limit: 10, window: 60 * 60_000 },
            {
                scope: 'login-recovery-ip',
                limit: 40,
                window: 60 * 60_000,
                key: 'ip',
            },
        ],
    })
    async handleLoginRecoveryCode(req: Request, res: Response): Promise<void> {
        const { token, code } = req.body;
        if (!token)
            throw new HttpError(400, 'token is required.', {
                legacyCode: 'bad_request',
            });
        if (!code)
            throw new HttpError(400, 'code is required.', {
                legacyCode: 'bad_request',
            });

        let decoded;
        try {
            decoded = this.services.token.verify<{
                user_uid: string;
                purpose: string;
                auth_id?: string;
            }>('otp', token);
        } catch {
            throw new HttpError(400, 'Invalid token.', {
                legacyCode: 'bad_request',
            });
        }
        if (!decoded.user_uid || decoded.purpose !== 'otp-login') {
            throw new HttpError(400, 'Invalid token.', {
                legacyCode: 'bad_request',
            });
        }

        const user = await this.stores.user.getByUuid(decoded.user_uid);
        if (!user)
            throw new HttpError(404, 'User not found.', {
                legacyCode: 'not_found',
            });
        if (user.suspended) {
            throw new HttpError(401, 'This account is suspended.', {
                legacyCode: 'account_suspended',
            });
        }

        const hashed = hashRecoveryCode(code);
        const codes = ((user.otp_recovery_codes as string) || '')
            .split(',')
            .filter(Boolean);
        const idx = codes.indexOf(hashed);
        if (idx === -1) {
            res.json({ proceed: false });
            return;
        }

        // Consume the recovery code
        codes.splice(idx, 1);
        await this.clients.db.write(
            'UPDATE `user` SET `otp_recovery_codes` = ? WHERE `uuid` = ?',
            [codes.join(','), user.uuid],
        );
        await this.stores.user.invalidateById(user.id);

        await this.#enforceAuthIdMatch(req, user, decoded.auth_id ?? null);

        await this.#completeLogin(req, res, user);
    }

    // -- Signup ------------------------------------------------------

    @Post('/signup', {
        // Completes into `#completeLogin`, so it hands back a session token
        // exactly like `/login`. Same reasoning.
        guiOriginOnly: true,
        captcha: true,
        rateLimit: [
            { scope: 'signup', limit: 10, window: 15 * 60_000 },
            { scope: 'signup-ip', limit: 50, window: 15 * 60_000, key: 'ip' },
        ],
    })
    async handleSignup(req: Request, res: Response): Promise<void> {
        const body = req.body ?? {};
        const is_temp = Boolean(body.is_temp);

        // Bot honeypot — only applies to non-temp signups
        if (
            !is_temp &&
            body.p102xyzname !== '' &&
            body.p102xyzname !== undefined
        ) {
            res.json({});
            return;
        }

        // Optional device signal (browser fingerprint hash). Core only enforces
        // shape and forwards the value verbatim — signup-abuse policy built on it
        // lives in extensions. Checked before the reauth short-circuit so a
        // malformed value is rejected on every /signup path.
        if (body.fingerprint !== undefined && body.fingerprint !== null) {
            if (typeof body.fingerprint !== 'string')
                throw new HttpError(400, 'fingerprint must be a string.', {
                    legacyCode: 'bad_request',
                });
            if (body.fingerprint.length > FINGERPRINT_MAX_LENGTH)
                throw new HttpError(
                    400,
                    `fingerprint cannot be longer than ${FINGERPRINT_MAX_LENGTH} characters.`,
                    { legacyCode: 'bad_request' },
                );
        }
        // Empty strings are treated as absent — a signal that wasn't
        // collected, not a malformed request.
        const fingerprint: string | null = body.fingerprint || null;

        // Temp-user reauth short-circuit: when an existing temp user is
        // forced through the reauth flow, the GUI re-submits /signup with
        // is_temp=true plus the server-signed reauth_token from the 401.
        // Verifying the token (not a raw auth_id) means a leaked uuid alone
        // can't re-attach a session to someone else's temp account.
        // Permanent users must go through /login (they have credentials),
        // so we reject that path here.
        if (
            is_temp &&
            body.reauth_token !== undefined &&
            body.reauth_token !== null
        ) {
            const reauthAuthId = this.#extractAuthIdFromReauthToken(
                body.reauth_token,
            );
            if (!reauthAuthId) {
                throw new HttpError(400, 'Invalid `reauth_token`.', {
                    legacyCode: 'bad_request',
                });
            }
            await this.#checkAuthIdRateLimit(req);
            const existing = await this.stores.user.getByUuid(reauthAuthId);
            if (!existing) {
                throw new HttpError(404, 'auth_id not found.', {
                    legacyCode: 'not_found',
                });
            }
            if (existing.password !== null || existing.email !== null) {
                throw new HttpError(
                    400,
                    'auth_id resolves to a non-temp account; use /login instead.',
                    { legacyCode: 'bad_request' },
                );
            }
            if (existing.suspended) {
                throw new HttpError(401, 'This account is suspended.', {
                    legacyCode: 'account_suspended',
                });
            }
            await this.#completeLogin(req, res, existing);
            return;
        }

        // Fill in temp user defaults
        if (is_temp) {
            body.username ??= await this.#generateRandomUsername();
            body.email ??= `${body.username}@gmail.com`;
            body.password ??= uuidv4();
        }

        // Validation
        if (!body.username)
            throw new HttpError(400, 'Username is required', {
                legacyCode: 'bad_request',
            });
        if (typeof body.username !== 'string')
            throw new HttpError(400, 'username must be a string.', {
                legacyCode: 'bad_request',
            });
        if (!USERNAME_REGEX.test(body.username)) {
            throw new HttpError(
                400,
                'Username can only contain letters, numbers and underscore (_).',
                { legacyCode: 'bad_request' },
            );
        }
        if (body.username.length > USERNAME_MAX_LENGTH) {
            throw new HttpError(
                400,
                `Username cannot be longer than ${USERNAME_MAX_LENGTH} characters.`,
                { legacyCode: 'bad_request' },
            );
        }
        if (RESERVED_USERNAMES.has(body.username.toLowerCase())) {
            throw new HttpError(400, 'This username is not available.', {
                legacyCode: 'username_already_in_use',
            });
        }
        if (!is_temp) {
            if (!body.email)
                throw new HttpError(400, 'Email is required', {
                    legacyCode: 'bad_request',
                });
            if (typeof body.email !== 'string')
                throw new HttpError(400, 'email must be a string.', {
                    legacyCode: 'bad_request',
                });
            if (!validator.isEmail(body.email))
                throw new HttpError(
                    400,
                    'Please enter a valid email address.',
                    { legacyCode: 'bad_request' },
                );
            await this.#validateEmail(body.email);
            if (!body.password)
                throw new HttpError(400, 'Password is required', {
                    legacyCode: 'bad_request',
                });
            if (typeof body.password !== 'string')
                throw new HttpError(400, 'password must be a string.', {
                    legacyCode: 'bad_request',
                });
            const minLen = this.config.min_pass_length || 6;
            if (body.password.length < minLen) {
                throw new HttpError(
                    400,
                    `Password must be at least ${minLen} characters long.`,
                    { legacyCode: 'bad_request' },
                );
            }
        }

        // Signup-disabled gate. Runs before the duplicate checks so a
        // disabled endpoint doesn't reveal which usernames or emails
        // exist. Claiming a pre-existing placeholder row is still
        // allowed, so permanent signups look the email up first.
        if (this.config.disable_user_signup) {
            let claimable = false;
            if (!is_temp) {
                const existing = await this.stores.user.findEmailOwner(
                    body.email,
                );
                claimable = Boolean(
                    existing &&
                    !existing.email_confirmed &&
                    existing.password === null,
                );
            }
            if (!claimable) {
                throw new HttpError(403, 'User registration is disabled.', {
                    legacyCode: 'signup_disabled',
                });
            }
        }

        // Duplicate username check
        if (await this.stores.user.getByUsername(body.username)) {
            throw new HttpError(
                400,
                'This username already exists in our database. Please use another one.',
                { legacyCode: 'bad_request' },
            );
        }

        // Duplicate confirmed-email check. A confirmed account (any
        // credential type — password OR OIDC) on this email → reject.
        //
        // A pseudo-user is an UNCONFIRMED placeholder row: email
        // present, password null, email_confirmed = 0. Those rows
        // (e.g. admin-created pre-provisioning) are NOT a block —
        // signup claims them: the INSERT becomes an UPDATE on the
        // pseudo row.
        //
        // OIDC-created accounts have password null but email_confirmed
        // = 1, so they fall in the reject branch — signup can't hijack
        // someone's OIDC account by knowing their email. To add a
        // password to an OIDC account, the owner logs in via OIDC and
        // uses the authenticated change-password flow.
        //
        // Matching runs against both raw `email` and canonical `clean_email` so
        // gmail-style aliases (`foo.bar+tag@gmail.com` vs
        // `foobar@gmail.com`) collapse to the same account.
        //
        // This is the cheap early check: it keeps an obvious duplicate from
        // paying for the validate hook and a bcrypt round. It is NOT the
        // guarantee — everything between here and the insert widens the window,
        // so the check runs again against the primary immediately before the
        // write, and the unique index catches whatever still slips through.
        let pseudo_user = is_temp
            ? null
            : await this.#resolveSignupEmailClaim(body.email);

        // Extension-level validation gate. Abuse-prevention extensions
        // inspect the incoming signup and can:
        //   - block it outright via `event.allow = false`
        //   - force email confirmation via `event.requires_email_confirmation = true`
        //   - skip temp-user creation via `event.no_temp_user = true`
        // Listeners run sequentially so multi-signal checks (rate limit +
        // IP reputation + domain reputation) can short-circuit cleanly.
        const validateEvent = {
            req,
            data: body,
            ip: ((req.headers?.['x-forwarded-for'] as string | undefined) ||
                (req as unknown as { connection?: { remoteAddress?: string } })
                    .connection?.remoteAddress ||
                req.ip ||
                req.socket?.remoteAddress ||
                null) as string | null,
            email: body.email,
            allow: true,
            no_temp_user: false,
            requires_email_confirmation: false,
            // Set by the abuse harness for low-reputation signups: the account is
            // created + logged in but gated behind SMS phone verification (in
            // addition to email confirmation) instead of being blocked.
            requires_phone_verification: false,
            // Same idea, one rung up the ladder: gate the account behind
            // credit-card verification (a $0 auth handled by an extension).
            requires_card_verification: false,
            message: null,
            code: null,
            user_agent: req?.headers?.['user-agent'] ?? null,
            fingerprint,
            // Populated by the abuse extension's v2 harness; persisted to the
            // user row below so the signup-time reputation is referable later.
            reputation: null as number | null,
            // Stamped by the abuse harness for flagged signups — the id keying
            // the `abuse:trail:<id>` decision trail (carrying both the live and
            // shadow trails). Surfaced to a blocked user as the Request Code so
            // the code they quote support leads straight to their trail.
            trail_id: undefined as string | undefined,
        };
        try {
            await this.clients.event?.emitAndWait(
                'puter.signup.validate',
                validateEvent,
                {},
            );
        } catch (e) {
            console.warn('[signup] validate hook failed:', e);
        }
        if (!validateEvent.allow) {
            // Pass the trail id back to a blocked user as the Request Code (when
            // the harness stamped one), embedded in the message so the existing
            // signup-block UI surfaces it without a GUI change.
            const requestCode = validateEvent.trail_id;
            throw new HttpError(
                403,
                (validateEvent.message ?? 'Signup blocked') +
                    (requestCode ? ` Request Code: ${requestCode}` : ''),
                {
                    ...(validateEvent.code
                        ? { legacyCode: validateEvent.code as never }
                        : {}),
                },
            );
        }
        if (is_temp && validateEvent.no_temp_user) {
            throw new HttpError(
                403,
                validateEvent.message ?? 'Temporary accounts are disabled',
                {
                    legacyCode: 'must_login_or_signup',
                    ...(validateEvent.code
                        ? { legacyCode: validateEvent.code as never }
                        : {}),
                },
            );
        }
        const force_email_confirmation = Boolean(
            validateEvent.requires_email_confirmation,
        );
        const force_phone_verification =
            Boolean(validateEvent.requires_phone_verification) ||
            // Test/QA switch: force the SMS gate on every signup regardless of
            // reputation (see config.always_require_phone_verification).
            Boolean(this.config.always_require_phone_verification);
        const force_card_verification = Boolean(
            validateEvent.requires_card_verification ||
            // Test/QA switch: force the card gate on every signup regardless of
            // reputation (see config.always_require_card_verification).
            this.config.always_require_card_verification,
        );

        // Prepare shared fields
        const user_uuid = uuidv4();
        const email_confirm_code = String(crypto.randomInt(100000, 1000000));
        const email_confirm_token = uuidv4();
        const password_hash = is_temp
            ? null
            : await bcrypt.hash(body.password, 8);

        const signupSqlTs = new Date()
            .toISOString()
            .slice(0, 19)
            .replace('T', ' ');

        // Re-run the claim against the primary now that the slow work is done.
        // The check above ran before the validate hook (network round-trips to
        // the abuse listeners) and before bcrypt — hundreds of milliseconds in
        // which a concurrent signup can take the address, or claim the very
        // placeholder row we were about to convert.
        if (!is_temp) {
            pseudo_user = await this.#resolveSignupEmailClaim(body.email, {
                force: true,
            });
        }

        let user;
        if (pseudo_user) {
            // -- Pseudo-user claim (convert the placeholder row) --
            //
            // Guarded, not a plain update: the address never changes hands here
            // (the row already holds it), so the unique index has nothing to
            // catch. Two signups that both read this row as claimable would
            // otherwise both "succeed", the second overwriting the first's
            // username and password on a row the first was already given a
            // session for.
            const claimed = await this.stores.user.claimPlaceholder(
                pseudo_user.id,
                {
                    username: body.username,
                    password: password_hash,
                    uuid: user_uuid,
                    email_confirm_code,
                    email_confirm_token,
                    email_confirmed: 0,
                    requires_email_confirmation: 1,
                    last_activity_ts: signupSqlTs,
                    ...(validateEvent.reputation != null
                        ? { reputation: validateEvent.reputation }
                        : {}),
                    requires_phone_verification: force_phone_verification
                        ? 1
                        : 0,
                    requires_card_verification: force_card_verification ? 1 : 0,
                },
            );
            if (!claimed) {
                throw new HttpError(
                    400,
                    'This email already exists in our database. Please use another one.',
                    { legacyCode: 'bad_request' },
                );
            }

            // Move from temp group to regular user group
            if (this.config.default_temp_group) {
                try {
                    await this.stores.group.removeUsers(
                        this.config.default_temp_group,
                        [body.username],
                    );
                } catch {
                    // Best-effort — missing membership shouldn't block signup
                }
            }
            if (this.config.default_user_group) {
                try {
                    await this.stores.group.addUsers(
                        this.config.default_user_group,
                        [body.username],
                    );
                } catch (e) {
                    console.warn('[signup] group assignment failed:', e);
                }
            }

            user = await this.stores.user.getById(pseudo_user.id, {
                force: true,
            });
        } else {
            // -- New user ----------------------------------------
            const clientIp = req.ip || req.socket?.remoteAddress || null;
            const proxyIpChain = req.headers['x-forwarded-for'];

            try {
                user = await this.stores.user.create({
                    username: body.username,
                    uuid: user_uuid,
                    password: password_hash,
                    email: is_temp ? null : body.email,
                    clean_email: is_temp ? null : cleanEmail(body.email),
                    free_storage: this.config.storage_capacity ?? null,
                    requires_email_confirmation:
                        !is_temp || force_email_confirmation,
                    email_confirm_code,
                    email_confirm_token,
                    audit_metadata: {
                        ip: clientIp,
                        ip_fwd: proxyIpChain,
                        user_agent: req.headers?.['user-agent'],
                        origin: req.headers?.origin,
                        fingerprint,
                    },
                    signup_ip: clientIp,
                    signup_ip_forwarded: proxyIpChain,
                    signup_user_agent: req.headers?.['user-agent'] ?? null,
                    signup_origin:
                        (req.headers?.origin as string | null) ?? null,
                    signup_server: (this.config as { serverId?: string })
                        .serverId,
                    referrer: req.body.referrer ?? null,
                    last_activity_ts: signupSqlTs,
                    reputation: validateEvent.reputation,
                    // Phone collected later in the verification dialog (null now).
                    phone: null,
                    requires_phone_verification: force_phone_verification,
                    requires_card_verification: force_card_verification,
                } as never);
            } catch (e) {
                // Lost the race to another signup between the re-check above and
                // this insert. The index is the only thing that can see that, so
                // translate it into the answer the pre-check would have given.
                if (!isOwnedEmailConflict(e)) throw e;
                throw new HttpError(
                    400,
                    'This email already exists in our database. Please use another one.',
                    { legacyCode: 'bad_request' },
                );
            }

            // Add to default group
            const defaultGroup = is_temp
                ? this.config.default_temp_group
                : this.config.default_user_group;
            if (defaultGroup) {
                try {
                    await this.stores.group.addUsers(defaultGroup, [
                        user.username,
                    ]);
                } catch (e) {
                    console.warn('[signup] group assignment failed:', e);
                }
            }
        }

        // -- Provision FS home + default folders -----------------
        // Idempotent — skips if `user.trash_uuid` is already set (pseudo
        // users who went through a prior signup won't double-create).
        try {
            await generateDefaultFsentries(
                this.clients.db,
                this.stores.user,
                user!,
            );
        } catch (e) {
            console.warn('[signup] generateDefaultFsentries failed:', e);
        }

        // -- Send email confirmation -----------------------------
        if (
            !is_temp &&
            user!.requires_email_confirmation &&
            this.clients.email
        ) {
            const sendCode = body.send_confirmation_code ?? true;
            try {
                if (sendCode) {
                    await this.clients.email.send(
                        user!.email!,
                        'email_verification_code',
                        {
                            code: email_confirm_code,
                        },
                    );
                } else {
                    const link = `${this.config.origin ?? ''}/confirm-email-by-token?token=${email_confirm_token}&user_uuid=${user!.uuid}`;
                    await this.clients.email.send(
                        user!.email!,
                        'email_verification_link',
                        { link },
                    );
                }
            } catch (e) {
                console.warn('[signup] email send failed:', e);
            }
        }

        // Fire signup events (best-effort). `user.save_account` is fired
        // for every non-temp signup (fresh or pseudo-claim) — downstream
        // consumers (mailchimp sync, welcome email, etc.) key off it.
        try {
            this.clients.event?.emit(
                'puter.signup.success' as never,
                {
                    user_id: user!.id,
                    user_uuid: user!.uuid,
                    email: user!.email,
                    username: user!.username,
                    fingerprint,
                    // Reflects the row that was actually created/claimed —
                    // a pseudo-user claim ends up with credentials, so it
                    // reports false here. Same signal completeLogin uses.
                    is_temp: user!.password === null && user!.email === null,
                    ip:
                        (req?.headers?.['x-forwarded-for'] as
                            string | undefined) ||
                        (
                            req as unknown as {
                                connection?: { remoteAddress?: string };
                            }
                        )?.connection?.remoteAddress ||
                        req?.ip ||
                        req?.socket?.remoteAddress ||
                        null,
                } as never,
                {},
            );
        } catch {
            // ignore — event emission shouldn't block signup
        }
        if (!is_temp) {
            try {
                this.clients.event?.emit(
                    'user.save_account' as never,
                    { user_id: user!.id } as never,
                    {},
                );
            } catch {
                // ignore
            }
        }

        await this.#completeLogin(req, res, user!);
    }

    // -- Logout ------------------------------------------------------

    @Post('/logout', {
        requireUserActor: true,
        allowUnconfirmed: true,
        antiCsrf: true,
        rateLimit: SESSION_LIMIT,
    })
    async handleLogout(req: Request, res: Response): Promise<void> {
        // Clear the session cookie + `puter_token_v2`. Nothing issues the
        // latter any more (it came from the retired token migration), but
        // authProbe still reads it as a fallback, so a value left in a
        // browser would re-authenticate the next request.
        res.clearCookie(this.config.cookie_name ?? 'puter_token');
        res.clearCookie('puter_token_v2');
        // Drop any step-up elevation too, so it can't reactivate on a shared
        // machine.
        res.clearCookie(STEP_UP_COOKIE_NAME, {
            ...(this.config.domain ? { domain: this.config.domain } : {}),
        });

        // Remove the session (fire-and-forget)
        if (req.token) {
            this.services.auth.removeSessionByToken(req.token).catch(() => {});
        }

        // Delete temp users (no password + no email). Full cascade —
        // same path as /user-protected/delete-own-user — so we don't
        // orphan fsentries/sessions/permissions.
        if (req.actor?.user && !req.actor.user.email) {
            const user = await this.stores.user.getByUuid(
                req.actor.user.uuid as string,
            );
            if (user && user.password === null && user.email === null) {
                this.#cascadeDeleteUser(user.id).catch((e) => {
                    console.warn('[logout] temp-user cleanup failed:', e);
                });
            }
        }

        res.send('logged out');
    }

    // -- Email confirmation ------------------------------------------

    @Post('/send-confirm-email', {
        subdomain: ['api', ''],
        requireUserActor: true,
        allowUnconfirmed: true,
        rateLimit: {
            scope: 'send-confirm-email',
            limit: 10,
            window: 60 * 60_000,
            key: 'user',
        },
    })
    async handleSendConfirmEmail(req: Request, res: Response): Promise<void> {
        const user = await this.stores.user.getById(req.actor!.user.id!, {
            force: true,
        });
        if (!user)
            throw new HttpError(404, 'User not found.', {
                legacyCode: 'user_not_found' as never,
            });
        if (user.suspended)
            throw new HttpError(403, 'Account suspended.', {
                legacyCode: 'account_suspended',
            });
        if (!user.email)
            throw new HttpError(400, 'No email on file.', {
                legacyCode: 'bad_request',
            });

        const code = String(crypto.randomInt(100000, 1000000));
        await this.stores.user.update(user.id, {
            email_confirm_code: code,
        });

        if (this.clients.email) {
            try {
                await this.clients.email.send(
                    user.email,
                    'email_verification_code',
                    { code },
                );
            } catch (e) {
                console.warn('[send-confirm-email] send failed:', e);
            }
        }
        res.json({});
    }

    @Post('/confirm-email', {
        subdomain: ['api', ''],
        requireUserActor: true,
        allowUnconfirmed: true,
        rateLimit: {
            scope: 'confirm-email',
            limit: 10,
            window: 10 * 60_000,
            key: 'user',
        },
    })
    async handleConfirmEmail(req: Request, res: Response): Promise<void> {
        const { code, original_client_socket_id } = req.body ?? {};
        if (!code)
            throw new HttpError(400, 'Missing `code`.', {
                legacyCode: 'bad_request',
            });

        const user = await this.stores.user.getById(req.actor!.user.id!, {
            force: true,
        });
        if (!user)
            throw new HttpError(404, 'User not found.', {
                legacyCode: 'not_found',
            });
        if (user.email_confirmed) {
            res.json({
                email_confirmed: true,
                original_client_socket_id,
            });
            return;
        }
        // Reject before comparing when no code is stored: `String(null)` would
        // otherwise equal a submitted `"null"` and confirm the email without
        // the real code.
        if (
            !user.email_confirm_code ||
            String(user.email_confirm_code) !== String(code)
        ) {
            res.json({
                email_confirmed: false,
                original_client_socket_id,
            });
            return;
        }

        // Re-validate the email at confirmation time — the address may
        // have been added to the blocklist (or flagged by an extension)
        // after signup but before confirmation.
        await this.#validateEmail(user.email!);

        // An account that already confirmed this address proved access to the
        // inbox, and revoking it below would hand the address to whoever
        // confirmed second. Refuse instead — a duplicate this old is data to
        // repair, not a race to resolve.
        const canonical = cleanEmail(user.email!);
        const confirmedRival = await this.stores.user.findConfirmedOtherByEmail(
            user.id,
            user.email!,
            canonical,
        );
        if (confirmedRival) {
            throw new HttpError(
                400,
                'This email was confirmed on a different account.',
                { legacyCode: 'email_already_in_use' as never },
            );
        }

        // Revoke the address from every remaining (unconfirmed) account holding
        // it, THEN confirm this one. Only one row may own an address, so
        // confirming first would momentarily create a second owner — which the
        // unique index rejects, turning a legitimate confirmation into a 500.
        await this.stores.user.unconfirmOthersByEmail(
            user.id,
            user.email!,
            canonical,
        );

        await this.stores.user.update(user.id, {
            email_confirmed: 1,
            requires_email_confirmation: 0,
            email_confirm_code: null,
            email_confirm_token: null,
        });

        await promoteToVerifiedGroup(this.stores.group, this.config, user);

        try {
            this.clients.event?.emit(
                'user.email-confirmed' as never,
                {
                    user_id: user.id,
                    user_uid: user.uuid,
                    email: user.email,
                } as never,
                {},
            );
        } catch {
            // ignore — event is a side-channel signal, not load-bearing
        }

        res.json({ email_confirmed: true, original_client_socket_id });
    }

    // -- Phone verification (SMS via Prelude) ------------------------

    /**
     * Build the error thrown when a verification SMS can't be sent (a delivery
     * failure, or a refused/blocked send). Mints a short `error_id`, writes a
     * single greppable line tying that id to the real reason (so support can
     * look it up in CloudWatch with the id the user quotes), stores the same
     * record in KV under `sms-send-error:<error_id>` for a week (the admin
     * abuse page looks it up there without needing log access), and returns the
     * `HttpError` with the id attached as `error_id` for the GUI to surface.
     * The phone number is deliberately omitted from the log line and the KV
     * record (PII); the user + country are enough to correlate.
     */
    private async smsSendError(
        statusCode: number,
        clientMessage: string,
        reason: string,
        ctx: {
            userId?: number;
            userUid?: string;
            country?: string;
            detail?: unknown;
        },
        options: HttpErrorOptions = {},
    ): Promise<HttpError> {
        const errorId = uuidv4();
        const detail =
            ctx.detail instanceof Error ? ctx.detail.message : ctx.detail;
        console.warn(
            `[send-confirm-phone] send_failed error_id=${errorId} ` +
                `reason=${reason} status=${statusCode} ` +
                `user_id=${ctx.userId ?? ''} user_uid=${ctx.userUid ?? ''} ` +
                `country=${ctx.country ?? ''}` +
                (detail ? ` detail=${JSON.stringify(String(detail))}` : ''),
        );
        // Best-effort: the record backs a support lookup, so a KV failure
        // must never mask the error actually being reported.
        try {
            const now = Math.floor(Date.now() / 1000);
            await this.stores.kv.set({
                key: `sms-send-error:${errorId}`,
                value: {
                    reason,
                    status: statusCode,
                    user_id: ctx.userId ?? null,
                    user_uid: ctx.userUid ?? null,
                    country: ctx.country ?? null,
                    detail: detail != null ? String(detail) : null,
                    t: now,
                },
                expireAt: now + SMS_SEND_ERROR_TTL_SECONDS,
            });
        } catch (e) {
            console.warn('[send-confirm-phone] error-record store failed:', e);
        }
        return new HttpError(statusCode, clientMessage, {
            ...options,
            fields: { ...options.fields, error_id: errorId },
        });
    }

    // -- SMS-to-card fallback -----------------------------------------
    //
    // Once a user has made enough SMS send attempts in the rate-limit window
    // without getting through, they can verify a card instead to clear the
    // phone gate. Off unless config enables it.
    //
    // Two KV keys: a short-lived counter tied to the send rate-limit window
    // triggers the fallback, and a longer-lived "open" flag holds eligibility
    // once the threshold is crossed. The card endpoints check only the flag —
    // deriving eligibility from the raw counter would let it expire while the
    // user is mid-way through the card flow. Every KV failure fails closed
    // (fallback unavailable), never open.

    private cardFallbackConfig(): { enabled: boolean; afterAttempts: number } {
        const cfg = this.config.phone_verification_card_fallback;
        const afterAttempts = Math.min(
            typeof cfg?.after_attempts === 'number' && cfg.after_attempts > 0
                ? cfg.after_attempts
                : DEFAULT_CARD_FALLBACK_ATTEMPTS,
            SEND_PHONE_RATE_LIMIT,
        );
        return { enabled: Boolean(cfg?.enabled), afterAttempts };
    }

    private phoneAttemptsKey(userId: number): string {
        return `phone-verify-attempts:${userId}`;
    }

    private cardFallbackFlagKey(userId: number): string {
        return `card-fallback-open:${userId}`;
    }

    // TTL ties the counter to the send rate-limit window, so it resets with it.
    private async bumpPhoneAttempts(userId: number): Promise<number> {
        try {
            const { res } = await this.stores.kv.incr({
                key: this.phoneAttemptsKey(userId),
                pathAndAmountMap: { attempts: 1 },
                expireAt:
                    Math.floor(Date.now() / 1000) +
                    SEND_PHONE_RATE_WINDOW_MS / 1000,
            });
            const count = (res as { attempts?: number } | null)?.attempts;
            return typeof count === 'number' ? count : 0;
        } catch (e) {
            console.warn('[send-confirm-phone] attempt-count bump failed:', e);
            return 0;
        }
    }

    /**
     * Count a send attempt and, once the threshold is crossed, stamp the
     * eligibility flag the card endpoints check. Returns whether the fallback
     * is open so send responses (success or 429) can advertise it.
     */
    private async recordPhoneAttemptForFallback(user: {
        id: number;
        requires_phone_verification?: boolean | number | null;
    }): Promise<boolean> {
        const attempts = await this.bumpPhoneAttempts(user.id);
        const { enabled, afterAttempts } = this.cardFallbackConfig();
        const open =
            enabled &&
            Boolean(user.requires_phone_verification) &&
            attempts >= afterAttempts;
        if (open) {
            try {
                // Plain set, so each eligible attempt refreshes the window.
                await this.stores.kv.set({
                    key: this.cardFallbackFlagKey(user.id),
                    value: true,
                    expireAt:
                        Math.floor(Date.now() / 1000) +
                        CARD_FALLBACK_OPEN_TTL_SECONDS,
                });
            } catch (e) {
                console.warn(
                    '[send-confirm-phone] fallback flag stamp failed:',
                    e,
                );
                return false;
            }
        }
        return open;
    }

    private async isCardFallbackEligible(user: {
        id: number;
        requires_phone_verification?: boolean | number | null;
    }): Promise<boolean> {
        const { enabled } = this.cardFallbackConfig();
        if (!enabled || !user.requires_phone_verification) return false;
        try {
            const { res } = await this.stores.kv.get({
                key: this.cardFallbackFlagKey(user.id),
            });
            return res === true;
        } catch (e) {
            console.warn('[card-verification] fallback flag read failed:', e);
            return false;
        }
    }

    @Post('/send-confirm-phone', {
        subdomain: ['api', ''],
        requireUserActor: true,
        allowUnconfirmed: true,
        rateLimit: {
            scope: 'send-confirm-phone',
            limit: SEND_PHONE_RATE_LIMIT,
            window: SEND_PHONE_RATE_WINDOW_MS,
            key: 'user',
        },
    })
    async handleSendConfirmPhone(req: Request, res: Response): Promise<void> {
        const user = await this.stores.user.getById(req.actor!.user.id!, {
            force: true,
        });
        if (!user)
            throw new HttpError(404, 'User not found.', {
                legacyCode: 'user_not_found' as never,
            });
        if (user.suspended)
            throw new HttpError(403, 'Account suspended.', {
                legacyCode: 'account_suspended',
            });
        if (!this.clients.prelude?.isConfigured())
            throw await this.smsSendError(
                503,
                'Phone verification is unavailable.',
                'prelude_not_configured',
                { userId: user.id, userUid: user.uuid },
                { legacyCode: 'service_unavailable' as never },
            );

        // Parse to E.164 (Prelude's required form + the stored form) and the
        // country, so we can apply the per-country cost cap.
        const parsed = parsePhone(
            req.body?.phone,
            this.clients.prelude.defaultCountry,
        );
        if (!parsed)
            throw new HttpError(400, 'Invalid phone number.', {
                legacyCode: 'bad_request',
            });

        // Optional Prelude dispatch id (browser signals gathered by the JS
        // Signals SDK on the number-entry page). Shape-checked and forwarded
        // verbatim to Prelude; an empty / oversized / non-string value is just
        // dropped so a bad client signal never blocks a real verification.
        const rawDispatchId = req.body?.dispatch_id;
        const dispatchId =
            typeof rawDispatchId === 'string' &&
            rawDispatchId.length > 0 &&
            rawDispatchId.length <= DISPATCH_ID_MAX_LENGTH
                ? rawDispatchId
                : undefined;

        // Cost cap: skip countries with no SMS channel or rates above the cap
        // (see PreludeClient / countries.ts). Avoids paying exorbitant per-SMS
        // rates in low-revenue, high-fraud geographies.
        if (!this.clients.prelude.isCountrySupported(parsed.country))
            throw await this.smsSendError(
                400,
                'Phone verification is not available for this country.',
                'country_not_supported',
                {
                    userId: user.id,
                    userUid: user.uuid,
                    country: parsed.country,
                },
                { legacyCode: 'phone_country_not_supported' as never },
            );

        // Counted before the abuse / Prelude checks so a blocked attempt still
        // counts toward the fallback threshold.
        const fallbackAvailable =
            await this.recordPhoneAttemptForFallback(user);
        const fallbackFields = fallbackAvailable
            ? { card_fallback_available: true }
            : {};

        // Abuse caps live ENTIRELY in a listening abuse extension, consulted
        // via `puter.phone-verification.check`. The backend ships no thresholds
        // or detection of its own (so none of it is readable in the open-source
        // repo): it forwards the user / number / ip, and the extension decides
        // `allowed` plus an opaque `reason` (per-account + per-number send
        // velocity, cross-account reuse, …). With no extension listening
        // `allowed` stays true. Fail-open on a hook error — this is abuse/cost
        // control, not a security boundary (the route rate limit and the country
        // cost cap remain), so a flaky hook must not lock signups out.
        const abuseCheck = {
            user_id: user.id,
            user_uid: user.uuid,
            phone: parsed.e164,
            device_fingerprint: req.deviceFingerprint ?? null,
            allowed: true,
            reason: null as string | null,
        };
        try {
            await this.clients.event?.emitAndWait(
                'puter.phone-verification.check',
                abuseCheck,
                {},
            );
        } catch (e) {
            console.warn('[send-confirm-phone] abuse-check hook failed:', e);
        }
        // Forward the verdict verbatim: a generic 429 plus the opaque reason for
        // the client to message on. The backend never interprets the reason —
        // its meaning lives in the extension (which sets it) and the GUI (which
        // displays it), so no abuse semantics leak into the OSS repo.
        if (abuseCheck.allowed === false)
            throw await this.smsSendError(
                429,
                'Phone verification is unavailable for this number right now.',
                `not_allowed:${abuseCheck.reason ?? 'unspecified'}`,
                {
                    userId: user.id,
                    userUid: user.uuid,
                    country: parsed.country,
                },
                {
                    legacyCode: 'phone_verification_unavailable' as never,
                    fields: {
                        ...fallbackFields,
                        ...(abuseCheck.reason
                            ? { reason: abuseCheck.reason }
                            : {}),
                    },
                },
            );

        // Stage the parsed number as pending in KV (NOT on the user row) so a
        // never-confirmed number is never written to the indexed `phone`
        // column. /confirm-phone reads it back and persists it to the row only
        // once Prelude confirms the code. ~1h TTL covers the code's lifetime.
        // Stored before the send so we never dispatch an SMS we couldn't later
        // confirm against.
        const pendingPhoneKey = `phone-verify-pending:${user.id}`;
        try {
            await this.stores.kv.set({
                key: pendingPhoneKey,
                value: parsed.e164,
                expireAt: Math.floor(Date.now() / 1000) + 60 * 60,
            });
        } catch (e) {
            throw await this.smsSendError(
                503,
                'Could not start phone verification.',
                'pending_store_failed',
                {
                    userId: user.id,
                    userUid: user.uuid,
                    country: parsed.country,
                    detail: e,
                },
                { legacyCode: 'service_unavailable' as never },
            );
        }

        const ip = req.ip || req.socket?.remoteAddress || undefined;
        const userAgent =
            typeof req.headers['user-agent'] === 'string'
                ? req.headers['user-agent']
                : undefined;
        // First entry of Prelude's delivery sequence — where the code actually
        // went. Returned to the client so it can point the user at the right
        // app (e.g. "check WhatsApp" instead of "check your texts").
        let deliveryChannel: string | undefined;
        try {
            const result = await this.clients.prelude.createVerification(
                parsed.e164,
                {
                    ip,
                    device_id: req.deviceFingerprint ?? undefined,
                    user_agent: userAgent,
                    dispatch_id: dispatchId,
                },
            );
            deliveryChannel = result.channels?.[0];
            // Prelude rejected the attempt as abusive — surface as rate-limit.
            if (
                result.status === 'blocked' ||
                result.status === 'shadow_blocked'
            ) {
                throw await this.smsSendError(
                    429,
                    'Phone verification is temporarily unavailable for this number.',
                    `prelude_${result.status}`,
                    {
                        userId: user.id,
                        userUid: user.uuid,
                        country: parsed.country,
                    },
                    {
                        legacyCode: 'too_many_requests' as never,
                        fields: fallbackFields,
                    },
                );
            }
        } catch (e) {
            if (e instanceof HttpError) throw e;
            throw await this.smsSendError(
                502,
                'Could not send verification code.',
                'prelude_request_failed',
                {
                    userId: user.id,
                    userUid: user.uuid,
                    country: parsed.country,
                    detail: e,
                },
                { legacyCode: 'upstream_error' as never },
            );
        }

        // Tell the abuse extension a code was actually sent, so it can bump its
        // send-velocity counters (per number + per account). Fire-and-forget;
        // the backend keeps no send counts of its own. Only reached after a
        // successful send, so an upstream error never burns quota.
        try {
            this.clients.event?.emit(
                'puter.phone-verification.sent' as never,
                {
                    user_id: user.id,
                    user_uid: user.uuid,
                    phone: parsed.e164,
                    device_fingerprint: req.deviceFingerprint ?? null,
                } as never,
                {},
            );
        } catch {
            // ignore — best-effort velocity signal
        }
        res.json({
            ...fallbackFields,
            ...(deliveryChannel ? { channel: deliveryChannel } : {}),
        });
    }

    @Post('/confirm-phone', {
        subdomain: ['api', ''],
        requireUserActor: true,
        allowUnconfirmed: true,
        rateLimit: {
            scope: 'confirm-phone',
            limit: 10,
            window: 10 * 60_000,
            key: 'user',
        },
    })
    async handleConfirmPhone(req: Request, res: Response): Promise<void> {
        const { code, original_client_socket_id } = req.body ?? {};
        if (!code)
            throw new HttpError(400, 'Missing `code`.', {
                legacyCode: 'bad_request',
            });

        const user = await this.stores.user.getById(req.actor!.user.id!, {
            force: true,
        });
        if (!user)
            throw new HttpError(404, 'User not found.', {
                legacyCode: 'not_found',
            });
        if (!user.requires_phone_verification) {
            res.json({ phone_verified: true, original_client_socket_id });
            return;
        }
        // The number being verified is the one staged at send time (KV
        // pending), not the user row — we don't persist an unverified number.
        // Fall back to a row value for accounts that already have one on file
        // (legacy / a number persisted by a prior verified flow).
        const pendingPhoneKey = `phone-verify-pending:${user.id}`;
        let pendingPhone: string | null = null;
        try {
            const { res: staged } = await this.stores.kv.get({
                key: pendingPhoneKey,
            });
            if (typeof staged === 'string' && staged) pendingPhone = staged;
        } catch (e) {
            console.warn('[confirm-phone] pending read failed:', e);
        }
        if (!pendingPhone) pendingPhone = user.phone ?? null;
        if (!pendingPhone)
            throw new HttpError(
                400,
                'No phone number on file. Request a code first.',
                { legacyCode: 'bad_request' },
            );
        if (!this.clients.prelude?.isConfigured())
            throw new HttpError(503, 'Phone verification is unavailable.', {
                legacyCode: 'service_unavailable' as never,
            });

        let status;
        try {
            ({ status } = await this.clients.prelude.checkVerification(
                pendingPhone,
                String(code),
            ));
        } catch (e) {
            console.warn('[confirm-phone] checkVerification failed:', e);
            throw new HttpError(502, 'Could not verify code.', {
                legacyCode: 'upstream_error' as never,
            });
        }

        if (status !== 'success') {
            res.json({ phone_verified: false, original_client_socket_id });
            return;
        }

        // Verified — persist the number now (and only now) and clear the gate.
        await this.stores.user.update(user.id, {
            requires_phone_verification: 0,
            phone: pendingPhone,
        });

        // Run the verified-event listeners synchronously (emitAndWait, not
        // fire-and-forget emit) so a carrier-based card-verification waiver in
        // the abuse extension lands BEFORE we broadcast "refresh" and respond —
        // otherwise the client re-fetches and still sees the card gate. Load-
        // bearing now; emitAndWait swallows listener errors, so this stays
        // best-effort and never blocks confirm on a listener.
        try {
            await this.clients.event?.emitAndWait(
                'user.phone-verified' as never,
                {
                    user_id: user.id,
                    user_uid: user.uuid,
                    phone: pendingPhone,
                } as never,
                {},
            );
        } catch {
            // ignore — listeners are best-effort
        }
        // Notify other tabs/devices for this user so they refresh + drop the gate.
        try {
            await this.services.socket?.send(
                { room: user.id },
                'user.phone_verified',
                { original_client_socket_id },
            );
        } catch {
            // ignore — best-effort
        }

        res.json({ phone_verified: true, original_client_socket_id });
    }

    // -- Card verification ($0 auth via a payments extension) --------

    /**
     * Start card verification for the calling user. Pure mechanism: the
     * endpoint emits `puter.card-verification.setup` and a payments extension
     * fills in the client credentials — the OSS backend holds no provider
     * knowledge or config. Phone verification (when required) must be completed
     * first; the ordering is enforced here so a client can't skip the cheaper
     * gate.
     */
    @Post('/card-verification/setup', {
        subdomain: ['api', ''],
        requireUserActor: true,
        allowUnconfirmed: true,
        rateLimit: {
            scope: 'card-verification-setup',
            limit: 5,
            window: 60 * 60_000,
            key: 'user',
        },
    })
    async handleCardVerificationSetup(
        req: Request,
        res: Response,
    ): Promise<void> {
        const user = await this.stores.user.getById(req.actor!.user.id!, {
            force: true,
        });
        if (!user)
            throw new HttpError(404, 'User not found.', {
                legacyCode: 'user_not_found' as never,
            });
        if (user.suspended)
            throw new HttpError(403, 'Account suspended.', {
                legacyCode: 'account_suspended',
            });
        // Phone normally comes first, but the fallback lets a phone-gated user
        // in once they've exhausted SMS attempts.
        const fallbackEligible = await this.isCardFallbackEligible(user);
        if (cardAlreadyVerified(user) && !fallbackEligible) {
            res.json({ card_verified: true });
            return;
        }
        if (user.requires_phone_verification && !fallbackEligible)
            throw new HttpError(
                409,
                'Phone verification must be completed first.',
                { legacyCode: 'conflict' },
            );

        // `enabled` stays null when no extension is listening; an installed
        // extension always sets it (true/false) before doing any work.
        const setupEvent = {
            user_id: user.id,
            user_uid: user.uuid,
            ip: (req.ip || req.socket?.remoteAddress || null) as string | null,
            device_fingerprint: req.deviceFingerprint ?? null,
            enabled: null as boolean | null,
            allowed: true,
            reason: null as string | null,
            client_secret: null as string | null,
            publishable_key: null as string | null,
        };
        try {
            await this.clients.event?.emitAndWait(
                'puter.card-verification.setup',
                setupEvent,
                {},
            );
        } catch (e) {
            console.warn('[card-verification/setup] setup hook failed:', e);
        }

        // Abuse veto (e.g. per-device setup-velocity cap): the extension refused
        // before any Stripe work. Forward the opaque reason verbatim as a 429,
        // same as the phone gate — the backend never interprets it.
        if (setupEvent.allowed === false)
            throw new HttpError(
                429,
                'Card verification is unavailable right now.',
                {
                    legacyCode: 'too_many_requests' as never,
                    fields: setupEvent.reason
                        ? { reason: setupEvent.reason }
                        : {},
                },
            );

        // Kill switch: the extension reports the feature disabled — unstick
        // any user still carrying the flag instead of dead-ending them.
        if (setupEvent.enabled === false) {
            // A fallback user is here BECAUSE SMS isn't working for them, and
            // now the card path is off too — they stay phone-gated with no
            // way through. Surface it; don't clear a gate with nothing
            // verified.
            if (fallbackEligible)
                console.warn(
                    '[card-verification/setup] card verification disabled;' +
                        ` fallback-eligible user ${user.uuid} remains` +
                        ' phone-gated with no working verification path',
                );
            await this.stores.user.update(user.id, {
                requires_card_verification: 0,
            });
            res.json({ card_verified: true, disabled: true });
            return;
        }
        if (!setupEvent.client_secret || !setupEvent.publishable_key)
            throw new HttpError(503, 'Card verification is not available.', {
                legacyCode: 'service_unavailable' as never,
            });

        res.json({
            client_secret: setupEvent.client_secret,
            publishable_key: setupEvent.publishable_key,
        });
    }

    /**
     * Complete card verification. The client confirms the setup intent with the
     * payment provider directly, then posts the resulting id here; the payments
     * extension checks it (and applies its own abuse limits) via
     * `puter.card-verification.confirm`. On success the gate clears exactly
     * like `/confirm-phone` clears the phone gate.
     */
    @Post('/card-verification/confirm', {
        subdomain: ['api', ''],
        requireUserActor: true,
        allowUnconfirmed: true,
        rateLimit: {
            scope: 'card-verification-confirm',
            limit: 10,
            window: 10 * 60_000,
            key: 'user',
        },
    })
    async handleCardVerificationConfirm(
        req: Request,
        res: Response,
    ): Promise<void> {
        const { setup_intent_id, original_client_socket_id } = req.body ?? {};
        if (
            typeof setup_intent_id !== 'string' ||
            setup_intent_id.length === 0 ||
            setup_intent_id.length > 255
        )
            throw new HttpError(400, 'Invalid `setup_intent_id`.', {
                legacyCode: 'bad_request',
            });

        const user = await this.stores.user.getById(req.actor!.user.id!, {
            force: true,
        });
        if (!user)
            throw new HttpError(404, 'User not found.', {
                legacyCode: 'not_found',
            });
        // Same fallback exception as setup: card may come before phone.
        const fallbackEligible = await this.isCardFallbackEligible(user);
        if (cardAlreadyVerified(user) && !fallbackEligible) {
            res.json({ card_verified: true });
            return;
        }
        if (user.requires_phone_verification && !fallbackEligible)
            throw new HttpError(
                409,
                'Phone verification must be completed first.',
                { legacyCode: 'conflict' },
            );

        const confirmEvent = {
            user_id: user.id,
            user_uid: user.uuid,
            setup_intent_id,
            enabled: null as boolean | null,
            verified: false,
            reason: null as string | null,
            fingerprint: null as string | null,
            funding: null as string | null,
            country: null as string | null,
            customer_id: null as string | null,
        };
        try {
            await this.clients.event?.emitAndWait(
                'puter.card-verification.confirm',
                confirmEvent,
                {},
            );
        } catch (e) {
            console.warn('[card-verification/confirm] confirm hook failed:', e);
        }

        // Kill switch — same semantics as /card-verification/setup.
        if (confirmEvent.enabled === false) {
            if (fallbackEligible)
                console.warn(
                    '[card-verification/confirm] card verification disabled;' +
                        ` fallback-eligible user ${user.uuid} remains` +
                        ' phone-gated with no working verification path',
                );
            await this.stores.user.update(user.id, {
                requires_card_verification: 0,
            });
            res.json({ card_verified: true, disabled: true });
            return;
        }
        // No extension listening — nothing could have verified anything.
        if (confirmEvent.enabled === null)
            throw new HttpError(503, 'Card verification is not available.', {
                legacyCode: 'service_unavailable' as never,
            });

        if (confirmEvent.verified !== true) {
            res.json({ card_verified: false, reason: confirmEvent.reason });
            return;
        }

        // A fallback card clears the phone gate too — the point of the
        // fallback. `fallbackEligible &&` makes the invariant local instead
        // of leaning on the 409 guard above: only a fallback user's card can
        // ever clear a phone gate.
        const clearedPhoneGate =
            fallbackEligible && Boolean(user.requires_phone_verification);
        await this.stores.user.update(user.id, {
            requires_card_verification: 0,
            ...(clearedPhoneGate ? { requires_phone_verification: 0 } : {}),
        });

        try {
            this.clients.event?.emit(
                'user.card-verified' as never,
                {
                    user_id: user.id,
                    user_uid: user.uuid,
                    fingerprint: confirmEvent.fingerprint,
                    funding: confirmEvent.funding,
                    country: confirmEvent.country,
                    customer_id: confirmEvent.customer_id,
                } as never,
                {},
            );
        } catch {
            // ignore — event is a side-channel signal, not load-bearing
        }
        // Notify other tabs/devices for this user so they refresh + drop the gate.
        try {
            await this.services.socket?.send(
                { room: user.id },
                'user.card_verified',
                { original_client_socket_id },
            );
            // The fallback cleared the phone gate too — tell phone-gate UIs.
            if (clearedPhoneGate)
                await this.services.socket?.send(
                    { room: user.id },
                    'user.phone_verified',
                    { original_client_socket_id },
                );
        } catch {
            // ignore — best-effort
        }

        res.json({
            card_verified: true,
            ...(clearedPhoneGate ? { phone_verified: true } : {}),
        });
    }

    // -- Password recovery -------------------------------------------

    @Post('/send-pass-recovery-email', {
        subdomain: ['api', ''],
        rateLimit: {
            scope: 'send-pass-recovery-email',
            limit: 10,
            window: 60 * 60_000,
        },
    })
    async handleSendPassRecoveryEmail(
        req: Request,
        res: Response,
    ): Promise<void> {
        const { username, email } = req.body ?? {};
        if (!username && !email) {
            throw new HttpError(400, 'username or email is required.', {
                legacyCode: 'bad_request',
            });
        }

        const genericMessage =
            'If that account exists, a password recovery email was sent.';

        let user;
        if (username) {
            user = await this.stores.user.getByUsername(username);
        } else {
            if (!validator.isEmail(email))
                throw new HttpError(400, 'Invalid email.', {
                    legacyCode: 'bad_request',
                });
            user = await this.stores.user.getByEmail(email);
        }

        if (!user || user.suspended || !user.email) {
            res.json({ message: genericMessage });
            return;
        }

        const pass_recovery_token = uuidv4();
        await this.stores.user.update(user.id, { pass_recovery_token });

        const jwt = this.services.token.sign(
            'otp',
            {
                token: pass_recovery_token,
                user_uid: user.uuid,
                email: user.email,
                purpose: 'pass-recovery',
            },
            { expiresIn: '1h' },
        );

        const origin = this.config.origin ?? '';
        const link = `${origin}/action/set-new-password?token=${encodeURIComponent(jwt)}`;

        if (this.clients.email) {
            try {
                await this.clients.email.send(
                    user.email,
                    'email_password_recovery',
                    { link },
                );
            } catch (e) {
                console.warn('[send-pass-recovery-email] send failed:', e);
            }
        }

        res.json({ message: genericMessage });
    }

    @Post('/verify-pass-recovery-token', {
        subdomain: ['api', ''],
        rateLimit: {
            scope: 'verify-pass-recovery-token',
            limit: 10,
            window: 15 * 60_000,
        },
    })
    async handleVerifyPassRecoveryToken(
        req: Request,
        res: Response,
    ): Promise<void> {
        const { token } = req.body ?? {};
        if (!token)
            throw new HttpError(400, 'Missing `token`.', {
                legacyCode: 'token_missing' as never,
            });

        let decoded;
        try {
            decoded = this.services.token.verify<{
                user_uid: string;
                email: string;
                exp: number;
                purpose: string;
            }>('otp', token);
        } catch {
            throw new HttpError(400, 'Invalid or expired token.', {
                legacyCode: 'token_expired' as never,
            });
        }
        if (decoded.purpose !== 'pass-recovery') {
            throw new HttpError(400, 'Invalid or expired token.', {
                legacyCode: 'token_expired' as never,
            });
        }

        const user = await this.stores.user.getByUuid(decoded?.user_uid);
        if (!user || user.email !== decoded.email) {
            throw new HttpError(400, 'Token is no longer valid.', {
                legacyCode: 'bad_request',
            });
        }
        if (user.suspended) {
            throw new HttpError(401, 'This account is suspended.', {
                legacyCode: 'account_suspended',
            });
        }

        const exp = decoded.exp as number;
        const time_remaining = exp
            ? Math.max(0, exp - Math.floor(Date.now() / 1000))
            : 0;
        res.json({ time_remaining });
    }

    @Post('/set-pass-using-token', {
        subdomain: ['api', ''],
        rateLimit: {
            scope: 'set-pass-using-token',
            limit: 10,
            window: 60 * 60_000,
        },
    })
    async handleSetPassUsingToken(req: Request, res: Response): Promise<void> {
        const { token, password } = req.body ?? {};
        if (!token || !password) {
            throw new HttpError(400, 'Missing `token` or `password`.', {
                legacyCode: 'token_missing' as never,
            });
        }
        const minLen = this.config.min_pass_length || 6;
        if (password.length < minLen) {
            throw new HttpError(
                400,
                `Password must be at least ${minLen} characters long.`,
                { legacyCode: 'bad_request' },
            );
        }

        let decoded;
        try {
            decoded = this.services.token.verify<{
                user_uid: string;
                email: string;
                token: string;
                purpose: string;
            }>('otp', token);
        } catch {
            throw new HttpError(400, 'Invalid or expired token.', {
                legacyCode: 'token_expired' as never,
            });
        }
        if (decoded.purpose !== 'pass-recovery') {
            throw new HttpError(400, 'Invalid or expired token.', {
                legacyCode: 'token_expired' as never,
            });
        }

        const user = await this.stores.user.getByUuid(decoded.user_uid);
        if (!user || user.email !== decoded.email) {
            throw new HttpError(400, 'Token is no longer valid.', {
                legacyCode: 'bad_request',
            });
        }
        if (user.suspended) {
            throw new HttpError(401, 'This account is suspended.', {
                legacyCode: 'account_suspended',
            });
        }

        // Atomic check: only update if the recovery token still matches
        const password_hash = await bcrypt.hash(password, 8);
        let result;
        try {
            result = await this.clients.db.write(
                'UPDATE `user` SET `password` = ?, `pass_recovery_token` = NULL, `change_email_confirm_token` = NULL WHERE `id` = ? AND `pass_recovery_token` = ?',
                [password_hash, user.id, decoded.token],
            );
        } catch (e) {
            if (!isOwnedEmailConflict(e)) throw e;
            // Recovery can be requested by username, so this row may be an
            // unconfirmed placeholder that shares its address with a real
            // account. Giving it a password would make it a second account able
            // to drive recovery for that inbox, which is the thing the address
            // constraint exists to stop. The inbox owner has an account
            // already — they should be recovering that one.
            throw new HttpError(
                400,
                'This email is already in use. Recover the account that uses it instead.',
                { legacyCode: 'email_already_in_use' as never },
            );
        }
        const affected =
            (result as { affectedRows?: number; changes?: number })
                ?.affectedRows ??
            (result as { affectedRows?: number; changes?: number })?.changes ??
            0;
        if (affected === 0) {
            throw new HttpError(400, 'Token has already been used.', {
                legacyCode: 'bad_request',
            });
        }
        await this.stores.user.invalidateById(user.id);

        // A password reset is the "I think someone else has access" flow —
        // evict every interactive session so a hijacked one doesn't survive.
        await this.services.auth.revokeInteractiveSessionsForUserId(
            user.id as number,
        );

        res.send('Password successfully updated.');
    }

    // -- User-protected mutations ------------------------------------
    //
    // The five `/user-protected/*` and `/user-protected/delete-own-user`
    // routes are wired in the `registerRoutes` override below because
    // their `middleware: createUserProtectedGate(...)` argument depends
    // on `this.config / this.stores / this.services` and so can't live
    // in a static decorator literal. The handler bodies stay here as
    // ordinary methods so tests can call them directly.

    async handleChangePassword(req: Request, res: Response): Promise<void> {
        const { new_pass } = req.body ?? {};
        if (!new_pass)
            throw new HttpError(400, 'Missing `new_pass`.', {
                legacyCode: 'bad_request',
            });
        const minLen = this.config.min_pass_length || 6;
        if (new_pass.length < minLen) {
            throw new HttpError(
                400,
                `Password must be at least ${minLen} characters long.`,
                { legacyCode: 'bad_request' },
            );
        }

        const user = req.userProtected!.user;

        const password_hash = await bcrypt.hash(new_pass, 8);
        await this.stores.user.update(user.id, {
            password: password_hash,
            pass_recovery_token: null,
            change_email_confirm_token: null,
        });

        // Sign out every other web session (cascading to their derived
        // rows); only the session that changed the password survives.
        await this.services.auth.revokeAllSessions(req.actor!);

        if (this.clients.email && user.email) {
            try {
                await this.clients.email.send(
                    user.email,
                    'password_change_notification',
                    {
                        username: user.username,
                    },
                );
            } catch (e) {
                console.warn('[change-password] notification send failed:', e);
            }
        }

        res.send('Password successfully updated.');
    }

    async handleChangeUsername(req: Request, res: Response): Promise<void> {
        const { new_username } = req.body ?? {};
        if (!new_username || typeof new_username !== 'string') {
            throw new HttpError(400, '`new_username` is required', {
                legacyCode: 'bad_request',
            });
        }
        if (!USERNAME_REGEX.test(new_username)) {
            throw new HttpError(
                400,
                'Username can only contain letters, numbers and underscore (_).',
                { legacyCode: 'bad_request' },
            );
        }
        if (new_username.length > USERNAME_MAX_LENGTH) {
            throw new HttpError(
                400,
                `Username cannot be longer than ${USERNAME_MAX_LENGTH} characters.`,
                { legacyCode: 'bad_request' },
            );
        }
        if (RESERVED_USERNAMES.has(new_username.toLowerCase())) {
            throw new HttpError(400, 'This username is not available.', {
                legacyCode: 'username_already_in_use',
            });
        }
        if (await this.stores.user.getByUsername(new_username)) {
            throw new HttpError(400, 'This username is already taken.', {
                legacyCode: 'username_already_in_use',
            });
        }

        await this.stores.user.update(req.actor!.user.id!, {
            username: new_username,
        });

        // Rename the user's FS home from `/<old>` to `/<new>` and
        // cascade the prefix to all descendants. Without this, any
        // path-based lookup (stat/readdir/write) would 404 after
        // rename because the fsentries still reference `/<old>`.
        try {
            await this.stores.fsEntry.renameUserHome(
                req.actor!.user.id!,
                new_username,
            );
        } catch (e) {
            console.warn('[change-username] fs home rename failed:', e);
        }

        try {
            this.clients.event?.emit(
                'user.username-changed' as never,
                {
                    user_id: req.actor!.user.id,
                    old_username: req.actor!.user.username,
                    new_username,
                } as never,
                {},
            );
        } catch {
            // event emission best-effort
        }

        res.json({ username: new_username });
    }

    async handleChangeEmail(req: Request, res: Response): Promise<void> {
        const { new_email } = req.body ?? {};
        if (!new_email || typeof new_email !== 'string') {
            throw new HttpError(400, '`new_email` is required', {
                legacyCode: 'bad_request',
            });
        }
        if (!validator.isEmail(new_email)) {
            throw new HttpError(400, 'Please enter a valid email address.', {
                legacyCode: 'bad_request',
            });
        }
        await this.#validateEmail(new_email);

        // Block if any OTHER confirmed account (password or OIDC) already
        // owns that email. Match raw + canonical to collapse gmail
        // aliases — which is also why the caller has to be excluded: an
        // alias of your own current address resolves back to you, and
        // "already in use" about yourself is nonsense.
        const existing = await this.stores.user.findEmailOwner(new_email);
        if (
            existing &&
            existing.id !== req.actor!.user.id &&
            (existing.email_confirmed || existing.password !== null)
        ) {
            throw new HttpError(400, 'This email is already in use.', {
                legacyCode: 'email_already_in_use' as never,
            });
        }

        const confirm_token = uuidv4();
        await this.stores.user.update(req.actor!.user.id!, {
            unconfirmed_change_email: new_email,
            change_email_confirm_token: confirm_token,
        });

        const linkJwt = this.services.token.sign(
            'otp',
            {
                token: confirm_token,
                user_id: req.actor!.user.id,
                purpose: 'change-email',
            },
            { expiresIn: '1h' },
        );

        if (this.clients.email) {
            const origin = this.config.origin ?? '';
            const link = `${origin}/change_email/confirm?token=${encodeURIComponent(linkJwt)}`;
            try {
                await this.clients.email.send(
                    new_email,
                    'email_verification_link',
                    { link },
                );
            } catch (e) {
                console.warn('[change-email] new-address email failed:', e);
            }
            // Notify the old address too
            const user = await this.stores.user.getById(req.actor!.user.id!, {
                force: true,
            });
            if (user?.email) {
                try {
                    await (
                        this.clients.email as unknown as {
                            sendRaw: (opts: {
                                to: string;
                                subject: string;
                                text: string;
                            }) => Promise<unknown>;
                        }
                    ).sendRaw({
                        to: user.email,
                        subject: 'Your Puter email change was requested',
                        text: `A change to ${new_email} was requested on your account. If this wasn't you, please contact support.`,
                    });
                } catch (e) {
                    console.warn(
                        '[change-email] old-address notice failed:',
                        e,
                    );
                }
            }
        }

        res.json({});
    }

    @Get('/change_email/confirm', {
        subdomain: ['api', ''],
        rateLimit: {
            scope: 'change-email-confirm',
            limit: 10,
            window: 60 * 60_000,
        },
    })
    async handleChangeEmailConfirm(req: Request, res: Response): Promise<void> {
        const jwtToken = req.query?.token;
        if (!jwtToken || typeof jwtToken !== 'string') {
            throw new HttpError(400, 'Missing `token`', {
                legacyCode: 'token_missing' as never,
            });
        }

        let decoded;
        try {
            decoded = this.services.token.verify('otp', jwtToken);
        } catch {
            throw new HttpError(400, 'Invalid or expired token.', {
                legacyCode: 'token_expired' as never,
            });
        }
        if (decoded.purpose !== 'change-email' || !decoded.token) {
            throw new HttpError(400, 'Invalid or expired token.', {
                legacyCode: 'token_expired' as never,
            });
        }

        const rows = (await this.clients.db.read(
            'SELECT * FROM `user` WHERE `change_email_confirm_token` = ? ORDER BY `id` ASC LIMIT 1',
            [decoded.token],
        )) as Array<Record<string, unknown>>;
        const user = rows[0] as
            | {
                  id: number;
                  email_confirmed?: number | boolean;
                  password?: string | null;
                  unconfirmed_change_email?: string;
              }
            | undefined;
        if (!user || !user.unconfirmed_change_email) {
            throw new HttpError(400, 'Invalid or expired token.', {
                legacyCode: 'token_expired' as never,
            });
        }

        const newEmail = user.unconfirmed_change_email;

        // Re-check nobody claimed the new email meanwhile. Match raw +
        // canonical; block if any real account (confirmed OR
        // password-holding) already owns it. Read the primary — the request
        // that took the address may have landed moments ago.
        const canonical = cleanEmail(newEmail);
        const owner = await this.stores.user.findEmailOwner(newEmail, {
            force: true,
        });
        if (
            owner &&
            owner.id !== user.id &&
            (owner.email_confirmed || owner.password !== null)
        ) {
            throw new HttpError(400, 'This email is already in use.', {
                legacyCode: 'email_already_in_use' as never,
            });
        }

        // Strip the address off any unconfirmed placeholder still holding it
        // before taking it, so this row is the only owner.
        await this.stores.user.unconfirmOthersByEmail(
            user.id,
            newEmail,
            canonical,
        );

        try {
            await this.stores.user.update(user.id, {
                email: newEmail,
                clean_email: canonical,
                unconfirmed_change_email: null,
                change_email_confirm_token: null,
                pass_recovery_token: null,
                email_confirmed: 1,
                requires_email_confirmation: 0,
            });
        } catch (e) {
            if (!isOwnedEmailConflict(e)) throw e;
            throw new HttpError(400, 'This email is already in use.', {
                legacyCode: 'email_already_in_use' as never,
            });
        }

        await this.stores.oidc.unlinkAllByUserId(user.id);

        try {
            this.clients.event?.emit(
                'user.email-changed' as never,
                {
                    user_id: user.id,
                    new_email: newEmail,
                } as never,
                {},
            );
        } catch {
            // best-effort
        }

        res.send('Email changed successfully. You may close this window.');
    }

    // -- Save account (convert temp user to permanent) ---------------

    @Post('/save_account', {
        subdomain: ['api', ''],
        requireUserActor: true,
        allowUnconfirmed: true,
        captcha: true,
        rateLimit: {
            scope: 'save-account',
            limit: 10,
            window: 60 * 60_000,
            key: 'user',
        },
    })
    async handleSaveAccount(req: Request, res: Response): Promise<void> {
        const { username, email, password } = req.body ?? {};

        const user = await this.stores.user.getById(req.actor!.user.id!, {
            force: true,
        });
        if (!user)
            throw new HttpError(404, 'User not found', {
                legacyCode: 'not_found',
            });
        if (user.password !== null || user.email !== null) {
            throw new HttpError(400, 'This is not a temporary account.', {
                legacyCode: 'temporary_accounts_not_allowed' as never,
            });
        }

        // Validation
        if (
            !username ||
            typeof username !== 'string' ||
            !USERNAME_REGEX.test(username)
        ) {
            throw new HttpError(400, 'Invalid username.', {
                legacyCode: 'bad_request',
            });
        }
        if (username.length > USERNAME_MAX_LENGTH) {
            throw new HttpError(
                400,
                `Username cannot be longer than ${USERNAME_MAX_LENGTH} characters.`,
                { legacyCode: 'bad_request' },
            );
        }
        if (RESERVED_USERNAMES.has(username.toLowerCase())) {
            throw new HttpError(400, 'This username is not available.', {
                legacyCode: 'username_already_in_use',
            });
        }
        if (!email || !validator.isEmail(email)) {
            throw new HttpError(400, 'Please enter a valid email address.', {
                legacyCode: 'bad_request',
            });
        }
        await this.#validateEmail(email);
        if (!password || typeof password !== 'string') {
            throw new HttpError(400, 'Password is required.', {
                legacyCode: 'password_required',
            });
        }
        const minLen = this.config.min_pass_length || 6;
        if (password.length < minLen) {
            throw new HttpError(
                400,
                `Password must be at least ${minLen} characters long.`,
                { legacyCode: 'bad_request' },
            );
        }

        // Duplicate checks
        const existingUsername = await this.stores.user.getByUsername(username);
        if (existingUsername && existingUsername.id !== user.id) {
            throw new HttpError(400, 'This username is already taken.', {
                legacyCode: 'username_already_in_use',
            });
        }
        // Match raw + canonical to catch gmail-alias collisions, and
        // reject on ANY confirmed account (OIDC accounts have
        // password=null but are real) — not just password-holders.
        const canonical = cleanEmail(email);
        const existingEmail = await this.stores.user.findEmailOwner(email);
        if (
            existingEmail &&
            existingEmail.id !== user.id &&
            (existingEmail.email_confirmed || existingEmail.password !== null)
        ) {
            throw new HttpError(400, 'This email is already in use.', {
                legacyCode: 'email_already_in_use' as never,
            });
        }

        // Promote: set username/email/password on the existing row
        const password_hash = await bcrypt.hash(password, 8);
        const email_confirm_code = String(crypto.randomInt(100000, 1000000));
        const email_confirm_token = uuidv4();

        // bcrypt above is slow enough for someone else to take the address in
        // the meantime, so re-check against the primary before the write.
        const raced = await this.stores.user.findEmailOwner(email, {
            force: true,
        });
        if (
            raced &&
            raced.id !== user.id &&
            (raced.email_confirmed || raced.password !== null)
        ) {
            throw new HttpError(400, 'This email is already in use.', {
                legacyCode: 'email_already_in_use' as never,
            });
        }

        try {
            await this.stores.user.update(user.id, {
                username,
                email,
                clean_email: canonical,
                password: password_hash,
                email_confirm_code,
                email_confirm_token,
                email_confirmed: 0,
                requires_email_confirmation: 1,
            });
        } catch (e) {
            if (!isOwnedEmailConflict(e)) throw e;
            throw new HttpError(400, 'This email is already in use.', {
                legacyCode: 'email_already_in_use' as never,
            });
        }

        // Rename the user's FS home so `/<temp>/Desktop` etc.
        // become `/<new>/Desktop`. Without this cascade, any
        // subsequent path-based FS lookup against the new
        // username would 404.
        if (username !== user.username) {
            try {
                await this.stores.fsEntry.renameUserHome(user.id, username);
            } catch (e) {
                console.warn('[save-account] fs home rename failed:', e);
            }
        }

        // Move from temp group to user group
        if (this.config.default_temp_group) {
            try {
                await this.stores.group.removeUsers(
                    this.config.default_temp_group,
                    [username],
                );
            } catch {
                // Best-effort
            }
        }
        if (this.config.default_user_group) {
            try {
                await this.stores.group.addUsers(
                    this.config.default_user_group,
                    [username],
                );
            } catch (e) {
                console.warn('[save-account] group add failed:', e);
            }
        }

        // Send confirmation email
        if (this.clients.email) {
            try {
                await this.clients.email.send(
                    email,
                    'email_verification_code',
                    { code: email_confirm_code },
                );
            } catch (e) {
                console.warn('[save-account] confirmation email failed:', e);
            }
        }

        try {
            this.clients.event?.emit(
                'user.save_account' as never,
                {
                    user_id: user.id,
                    old_username: user.username,
                    new_username: username,
                    email,
                } as never,
                {},
            );
        } catch {
            // best-effort
        }

        const updatedUser = await this.stores.user.getById(user.id, {
            force: true,
        });
        res.json({
            user: {
                username: updatedUser!.username,
                uuid: updatedUser!.uuid,
                email: updatedUser!.email,
                email_confirmed: updatedUser!.email_confirmed,
                requires_email_confirmation:
                    updatedUser!.requires_email_confirmation,
                is_temp: false,
            },
        });
    }

    // -- Captcha generation -------------------------------------------

    @Get('/api/captcha/generate', {
        subdomain: '*',
        // Unauthenticated, renders an image per call, and is the gate
        // protecting /login and /signup — so bulk pre-generation is
        // directly useful to an attacker. Per-fingerprint for fairness on
        // shared IPs, plus a per-IP backstop against header rotation.
        //
        // The fingerprint bucket is the one sized for a person: a handful of
        // refreshes while getting a captcha right. The IP bucket is not — one
        // address is a whole office, campus or carrier gateway, and everyone
        // behind it is signing in through the same counter, so sizing it for
        // a browser would deny the captcha to a network rather than to an
        // attacker. It stays wide enough for that population and narrow
        // enough that header rotation still runs out.
        rateLimit: [
            { scope: 'captcha', limit: 30, window: 60_000 },
            { scope: 'captcha-ip', limit: 3_000, window: 60_000, key: 'ip' },
        ],
    })
    async handleCaptchaGenerate(_req: Request, res: Response): Promise<void> {
        const difficulty =
            (this.config as { captcha?: { difficulty?: string } }).captcha
                ?.difficulty || 'medium';
        const { token, image } = await generateCaptcha(difficulty);
        res.json({ token, image });
    }

    // -- Anti-CSRF token generation ----------------------------------

    @Get('/get-anticsrf-token', {
        rateLimit: ANTI_CSRF_MINT_LIMIT,
        // Anti-CSRF tokens are only consumed by `requireUserActor` routes,
        // so issuance is scoped to the same actor kind for consistency.
        requireUserActor: true,
        allowUnconfirmed: true,
    })
    async handleGetAntiCsrfToken(req: Request, res: Response): Promise<void> {
        const sessionId = req.actor?.user?.uuid;
        if (!sessionId)
            throw new HttpError(401, 'Authentication required.', {
                legacyCode: 'unauthorized',
            });
        const token = await antiCsrf.createToken(sessionId);
        res.json({ token });
    }

    // -- Permission grants -------------------------------------------

    @Post('/auth/grant-user-user', {
        subdomain: 'api',
        requireUserActor: true,
        rateLimit: GRANT_LIMIT,
    })
    async handleGrantUserUser(req: Request, res: Response): Promise<void> {
        const { target_username, permission, extra, meta } = req.body;
        if (!target_username || !permission) {
            throw new HttpError(
                400,
                'Missing `target_username` or `permission`',
                { legacyCode: 'bad_request' },
            );
        }
        await this.services.permission.grantUserUserPermission(
            req.actor!,
            target_username,
            permission,
            extra,
            meta,
        );
        res.json({});
    }

    /**
     * Shared input validation for the user-app grant/revoke handlers, which
     * accept a caller-supplied `origin` as an alternative to `app_uid`. All
     * parameters are optional-but-typed: presence is enforced by the handlers'
     * own `app_uid`/`permission` checks after origin resolution.
     *
     * These are bounded only against absurd input. The width of the column a
     * permission lands in is enforced by the permission service instead, on the
     * _rewritten_ string: `fs:/path:mode` is rewritten to `fs:<uuid>:mode`
     * before it is stored, so a deep path is a ~45-character row and must not
     * be rejected for the length of the path the caller typed.
     */
    #validateAppPermissionParams(params: {
        app_uid?: unknown;
        origin?: unknown;
        permission?: unknown;
        extra?: unknown;
        meta?: unknown;
    }): void {
        const MAX_LEN = 4096;
        for (const key of ['app_uid', 'origin', 'permission'] as const) {
            const value = params[key];
            if (value === undefined || value === null) continue;
            if (typeof value !== 'string' || value.length > MAX_LEN) {
                throw new HttpError(400, `Invalid \`${key}\``, {
                    legacyCode: 'bad_request',
                });
            }
        }
        // `extra` and `meta` are forwarded into the audit row and read as
        // objects downstream. A non-object would fault *after* the grant is
        // committed, so reject it up front. `null` is treated as absent, the
        // same as the string parameters above.
        for (const key of ['extra', 'meta'] as const) {
            const value = params[key];
            if (value === undefined || value === null) continue;
            if (typeof value !== 'object' || Array.isArray(value)) {
                throw new HttpError(400, `Invalid \`${key}\``, {
                    legacyCode: 'bad_request',
                });
            }
        }
    }

    /**
     * Resolves a caller-supplied `origin` to the uid of a _registered_ app.
     *
     * `appUidFromOrigin` synthesises a deterministic `app-<uuidv5>` uid for an
     * origin that has no app row yet, and the permission services resolve their
     * identifier as uid-_or-name_. Passing a synthetic uid straight through
     * would therefore let whoever registered an app under that literal name
     * collect a grant the user made to the origin — the uid is derived from a
     * published namespace constant, so it can be computed and squatted offline.
     * Only a uid that names an existing app row is accepted.
     *
     * An `origin` supplied alongside an `app_uid` takes precedence over it (see
     * the grant/revoke handlers). The origin is what a consent prompt shows the
     * user, so it — not a uid travelling beside it — has to decide who receives
     * the grant; otherwise a caller could name one app on screen and grant to
     * another. No caller sends both with different intent.
     */
    async #registeredAppUidFromOrigin(origin: string): Promise<string> {
        const uid = await this.services.auth.appUidFromOrigin(origin);
        const app = await this.stores.app.getByUid(uid);
        if (!app) {
            throw new HttpError(404, `entity_not_found: app:${uid}`, {
                legacyCode: 'subject_does_not_exist',
            });
        }
        return app.uid;
    }

    /**
     * Resolve the `permission` / `permissions` pair into the list to act on.
     *
     * One consent prompt can cover several scopes (read a store, write
     * another), and a client looping the single form would have to invent its
     * own partial-failure and rollback handling. Accepting the array keeps that
     * in one request.
     */
    #appPermissionList(body: {
        permission?: unknown;
        permissions?: unknown;
    }): string[] {
        const { permission, permissions } = body;
        if (permissions !== undefined && permissions !== null) {
            if (permission !== undefined && permission !== null) {
                throw new HttpError(
                    400,
                    'Pass `permission` or `permissions`, not both',
                    { legacyCode: 'bad_request' },
                );
            }
            if (!Array.isArray(permissions) || permissions.length === 0) {
                throw new HttpError(400, 'Invalid `permissions`', {
                    legacyCode: 'bad_request',
                });
            }
            if (permissions.length > MAX_PERMISSIONS_PER_REQUEST) {
                throw new HttpError(400, 'Too many `permissions`', {
                    legacyCode: 'bad_request',
                });
            }
            for (const entry of permissions) {
                this.#validateAppPermissionParams({ permission: entry });
                // `*` means "revoke everything" in the scalar form only —
                // inside a list it would silently widen a targeted request.
                if (!entry || entry === '*') {
                    throw new HttpError(400, 'Invalid `permissions`', {
                        legacyCode: 'bad_request',
                    });
                }
            }
            return [...new Set(permissions as string[])];
        }
        return typeof permission === 'string' && permission ? [permission] : [];
    }

    /**
     * Gate a cross-app data grant: the target must exist, must not have opted
     * out of sharing, and must be named. Also creates the target's AppData
     * directory for an `fs` scope, since it is only created lazily when the app
     * first runs — without this a valid grant would 404 until then.
     */
    async #prepareAppDataGrant(
        actor: Actor,
        permission: string,
    ): Promise<void> {
        const parsed = parseAppDataPermission(permission);
        if (!parsed) {
            // A bare `app-data` (or one with an empty target) would cover every
            // app the user has by prefix implication, which no prompt can
            // describe. Reject rather than treat it as an unrelated permission.
            if (
                permission === APP_DATA_PERMISSION_PREFIX ||
                permission.startsWith(`${APP_DATA_PERMISSION_PREFIX}:`)
            ) {
                throw new HttpError(
                    400,
                    'Invalid `app-data` permission: missing target app',
                    { legacyCode: 'bad_request' },
                );
            }
            return;
        }

        const target = await this.stores.app.getByUid(parsed.targetAppUid);
        if (!target) {
            throw new HttpError(
                404,
                `entity_not_found: app:${parsed.targetAppUid}`,
                { legacyCode: 'subject_does_not_exist' },
            );
        }
        if (!appDataSharingAllowed(target)) {
            throw new HttpError(
                403,
                'This app does not share its data with other apps',
                { legacyCode: 'forbidden' },
            );
        }

        const username = actor.user?.username;
        const userId = actor.user?.id;
        if ((parsed.store === 'fs' || !parsed.store) && username && userId) {
            await this.services.fs.mkdir(userId, {
                path: `/${username}/AppData/${parsed.targetAppUid}`,
                createMissingParents: true,
            } as never);
        }
    }

    @Post('/auth/grant-user-app', {
        subdomain: 'api',
        requireUserActor: true,
        rateLimit: GRANT_LIMIT,
    })
    async handleGrantUserApp(req: Request, res: Response): Promise<void> {
        let { app_uid } = req.body;
        const { origin, permission, permissions, extra, meta } = req.body;
        this.#validateAppPermissionParams({
            app_uid,
            origin,
            permission,
            extra,
            meta,
        });
        const list = this.#appPermissionList({ permission, permissions });
        if (origin) {
            app_uid = await this.#registeredAppUidFromOrigin(origin);
        }
        if (!app_uid || list.length === 0) {
            throw new HttpError(400, 'Missing `app_uid` or `permission`', {
                legacyCode: 'bad_request',
            });
        }

        // Validate every entry before writing any, so a bad one in the list
        // cannot leave a partially-granted set behind: the dialog reads a 4xx as
        // "nothing was written" and skips its withdrawal, so a partial commit
        // leaves live access the user was told they refused. The rewrite running
        // twice is cheaper than splitting the grant into prepare/commit.
        for (const entry of list) {
            await this.services.permission.assertUserAppPermissionWritable(
                entry,
            );
            await this.#prepareAppDataGrant(req.actor!, entry);
        }
        for (const entry of list) {
            await this.services.permission.grantUserAppPermission(
                req.actor!,
                app_uid,
                entry,
                extra ?? undefined,
                meta ?? undefined,
            );
        }
        res.json({});
    }

    @Post('/auth/grant-user-group', {
        subdomain: 'api',
        requireUserActor: true,
        rateLimit: GRANT_LIMIT,
    })
    async handleGrantUserGroup(req: Request, res: Response): Promise<void> {
        const { group_uid, permission, extra, meta } = req.body;
        if (!group_uid || !permission) {
            throw new HttpError(400, 'Missing `group_uid` or `permission`', {
                legacyCode: 'bad_request',
            });
        }
        const group = await this.stores.group.getByUid(group_uid);
        if (!group)
            throw new HttpError(404, 'Group not found', {
                legacyCode: 'not_found',
            });
        await this.services.permission.grantUserGroupPermission(
            req.actor!,
            group,
            permission,
            extra,
            meta,
        );
        res.json({});
    }

    // -- Permission revokes ------------------------------------------

    @Post('/auth/revoke-user-user', {
        subdomain: 'api',
        requireUserActor: true,
        rateLimit: GRANT_LIMIT,
    })
    async handleRevokeUserUser(req: Request, res: Response): Promise<void> {
        const { target_username, permission, meta } = req.body;
        if (!target_username || !permission) {
            throw new HttpError(
                400,
                'Missing `target_username` or `permission`',
                { legacyCode: 'bad_request' },
            );
        }
        await this.services.permission.revokeUserUserPermission(
            req.actor!,
            target_username,
            permission,
            meta,
        );
        res.json({});
    }

    @Post('/auth/revoke-user-app', {
        subdomain: 'api',
        requireUserActor: true,
        rateLimit: GRANT_LIMIT,
    })
    async handleRevokeUserApp(req: Request, res: Response): Promise<void> {
        let { app_uid } = req.body;
        const { origin, permission, permissions, meta } = req.body;
        this.#validateAppPermissionParams({
            app_uid,
            origin,
            permission,
            meta,
        });
        const list = this.#appPermissionList({ permission, permissions });
        if (origin) {
            app_uid = await this.#registeredAppUidFromOrigin(origin);
        }
        if (!app_uid || list.length === 0) {
            throw new HttpError(400, 'Missing `app_uid` or `permission`', {
                legacyCode: 'bad_request',
            });
        }
        // Deliberately not gated by the target's sharing flag: a user must
        // always be able to withdraw a grant, whatever the target now says.
        if (permission === '*') {
            await this.services.permission.revokeUserAppAll(
                req.actor!,
                app_uid,
                meta ?? undefined,
            );
        } else {
            for (const entry of list) {
                await this.services.permission.revokeUserAppPermission(
                    req.actor!,
                    app_uid,
                    entry,
                    meta ?? undefined,
                );
            }
        }
        res.json({});
    }

    @Post('/auth/revoke-user-group', {
        subdomain: 'api',
        requireUserActor: true,
        rateLimit: GRANT_LIMIT,
    })
    async handleRevokeUserGroup(req: Request, res: Response): Promise<void> {
        const { group_uid, permission, meta } = req.body;
        if (!group_uid || !permission) {
            throw new HttpError(400, 'Missing `group_uid` or `permission`', {
                legacyCode: 'bad_request',
            });
        }
        await this.services.permission.revokeUserGroupPermission(
            req.actor!,
            { uid: group_uid } as never,
            permission,
            meta,
        );
        res.json({});
    }

    // -- Permission checks -------------------------------------------

    @Post('/auth/check-permissions', {
        subdomain: 'api',
        requireAuth: true,
        rateLimit: AUTH_CHECK_LIMIT,
    })
    async handleCheckPermissions(req: Request, res: Response): Promise<void> {
        const { permissions } = req.body;
        if (!Array.isArray(permissions)) {
            throw new HttpError(400, 'Missing or invalid `permissions` array', {
                legacyCode: 'bad_request',
            });
        }

        const unique = [...new Set(permissions)] as string[];
        const result: Record<string, boolean> = {};
        let granted: Map<string, boolean>;
        try {
            granted = await this.services.permission.checkMany(
                req.actor!,
                unique,
            );
        } catch {
            granted = new Map<string, boolean>();
        }
        for (const perm of unique) {
            result[perm] = granted.get(perm) ?? false;
        }
        res.json({ permissions: result });
    }

    // -- Session management ------------------------------------------

    @Get('/auth/list-sessions', {
        subdomain: 'api',
        requireUserActor: true,
        rateLimit: AUTH_LIST_LIMIT,
    })
    async handleListSessions(req: Request, res: Response): Promise<void> {
        const sessions = await this.services.auth.listSessions(req.actor!);
        res.json(sessions);
    }

    // Wired imperatively in `registerRoutes` so the cookie-only gate
    // (built from `this.config`) can be composed in. Cookie-only is
    // mandatory: an access token must not be able to revoke its own
    // issuing web session.
    async handleRevokeSession(req: Request, res: Response): Promise<void> {
        const { uuid } = req.body;
        if (!uuid || typeof uuid !== 'string') {
            throw new HttpError(400, 'Missing or invalid `uuid`', {
                legacyCode: 'bad_request',
            });
        }
        // The caller's own session row must go through /logout, not a
        // self-revoke — otherwise the response can't write fresh auth
        // state and the client ends up with an ambiguous post-revoke
        // identity. /auth/revoke-all-sessions still supports a separate
        // `include_current` opt-in for the nuclear case.
        if (uuid === req.actor!.session?.uid) {
            throw new HttpError(
                400,
                'Cannot revoke your current session — use /logout instead',
                { legacyCode: 'bad_request' },
            );
        }
        // `getByUuid` returns null when the row is missing, already
        // soft-revoked, or past `expires_at` — surface as 404 so a stale
        // manage-sessions UI doesn't 500 when it clicks revoke on a row
        // that already went away.
        const session = await this.stores.session.getByUuid(uuid);
        if (!session) {
            throw new HttpError(404, 'Session not found', {
                legacyCode: 'not_found',
            });
        }
        if (session.user_id !== req.actor!.user.id) {
            throw new HttpError(403, 'Can only revoke your own sessions', {
                legacyCode: 'unauthorized',
            });
        }
        await this.services.auth.revokeSession(uuid);
        const sessions = await this.services.auth.listSessions(req.actor!);
        res.json({ sessions });
    }

    async handleRevokeAllSessions(req: Request, res: Response): Promise<void> {
        const { include_current, include_apps } = req.body ?? {};
        await this.services.auth.revokeAllSessions(req.actor!, {
            includeCurrent: !!include_current,
            includeApps: !!include_apps,
        });
        const sessions = await this.services.auth.listSessions(req.actor!);
        res.json({ sessions });
    }

    async handleRenameSession(req: Request, res: Response): Promise<void> {
        const uuid = req.params.uuid;
        const { label } = (req.body ?? {}) as { label?: unknown };
        if (!uuid || typeof uuid !== 'string') {
            throw new HttpError(400, 'Missing or invalid `uuid`', {
                legacyCode: 'bad_request',
            });
        }
        if (label !== null && typeof label !== 'string') {
            throw new HttpError(400, '`label` must be a string or null', {
                legacyCode: 'bad_request',
            });
        }
        await this.services.auth.setSessionLabel(
            req.actor!,
            uuid,
            label ?? null,
        );
        res.json({});
    }

    // -- Dev app permissions -----------------------------------------

    @Post('/auth/grant-dev-app', {
        subdomain: 'api',
        requireUserActor: true,
        rateLimit: GRANT_LIMIT,
    })
    async handleGrantDevApp(req: Request, res: Response): Promise<void> {
        let { app_uid } = req.body;
        const { origin, permission, extra, meta } = req.body;
        if (origin && !app_uid) {
            // Registered apps only, for the same reason the user-app handlers
            // insist on it: a synthesised `app-<uuidv5(origin)>` is resolved
            // downstream as uid-*or-name*, so it would land on whoever
            // registered an app under that literal name. A dev-app grant is
            // scanned with the issuer's authority for anyone running as that
            // app, so that hands this user's permission to the squatter.
            // Without a squatter the synthetic uid resolves to nothing and
            // this 404s regardless, so nothing legitimate changes.
            app_uid = await this.#registeredAppUidFromOrigin(origin);
        }
        if (!app_uid || !permission) {
            throw new HttpError(400, 'Missing `app_uid` or `permission`', {
                legacyCode: 'bad_request',
            });
        }
        await this.services.permission.grantDevAppPermission(
            req.actor!,
            app_uid,
            permission,
            extra,
            meta,
        );
        res.json({});
    }

    @Post('/auth/revoke-dev-app', {
        subdomain: 'api',
        requireUserActor: true,
        rateLimit: GRANT_LIMIT,
    })
    async handleRevokeDevApp(req: Request, res: Response): Promise<void> {
        let { app_uid } = req.body;
        const { origin, permission, meta } = req.body;
        if (origin && !app_uid) {
            // Registered apps only — see handleGrantDevApp.
            app_uid = await this.#registeredAppUidFromOrigin(origin);
        }
        if (!app_uid || !permission) {
            throw new HttpError(400, 'Missing `app_uid` or `permission`', {
                legacyCode: 'bad_request',
            });
        }
        if (permission === '*') {
            await this.services.permission.revokeDevAppAll(
                req.actor!,
                app_uid,
                meta,
            );
        } else {
            await this.services.permission.revokeDevAppPermission(
                req.actor!,
                app_uid,
                permission,
                meta,
            );
        }
        res.json({});
    }

    // -- Permission listing ------------------------------------------

    @Get('/auth/list-permissions', {
        subdomain: 'api',
        requireUserActor: true,
        rateLimit: AUTH_LIST_LIMIT,
    })
    async handleListPermissions(req: Request, res: Response): Promise<void> {
        const userId = req.actor!.user.id;
        const db = this.clients.db;

        const [appPerms, userPermsOut, userPermsIn] = await Promise.all([
            db.read(
                // The permissions table stores the numeric `app_id` FK; the
                // public shape exposes the app's `uid`.
                'SELECT a.`uid` AS app_uid, p.`permission`, p.`extra` ' +
                    'FROM `user_to_app_permissions` p ' +
                    'JOIN `apps` a ON a.`id` = p.`app_id` ' +
                    'WHERE p.`user_id` = ?',
                [userId],
            ),
            db.read(
                'SELECT u.`username`, p.`permission`, p.`extra` FROM `user_to_user_permissions` p ' +
                    'JOIN `user` u ON u.`id` = p.`holder_user_id` WHERE p.`issuer_user_id` = ?',
                [userId],
            ),
            db.read(
                'SELECT u.`username`, p.`permission`, p.`extra` FROM `user_to_user_permissions` p ' +
                    'JOIN `user` u ON u.`id` = p.`issuer_user_id` WHERE p.`holder_user_id` = ?',
                [userId],
            ),
        ]);

        type Row = {
            app_uid?: string;
            username?: string;
            permission: string;
            extra?: string | Record<string, unknown> | null;
        };

        res.json({
            myself_to_app: (appPerms as Row[]).map((r) => ({
                app_uid: r.app_uid,
                permission: r.permission,
                extra:
                    typeof r.extra === 'string'
                        ? JSON.parse(r.extra)
                        : (r.extra ?? {}),
            })),
            myself_to_user: (userPermsOut as Row[]).map((r) => ({
                user: r.username,
                permission: r.permission,
                extra:
                    typeof r.extra === 'string'
                        ? JSON.parse(r.extra)
                        : (r.extra ?? {}),
            })),
            user_to_myself: (userPermsIn as Row[]).map((r) => ({
                user: r.username,
                permission: r.permission,
                extra:
                    typeof r.extra === 'string'
                        ? JSON.parse(r.extra)
                        : (r.extra ?? {}),
            })),
        });
    }

    // -- App origin resolution ---------------------------------------

    @Post('/auth/app-uid-from-origin', {
        subdomain: 'api',
        requireAuth: true,
        rateLimit: AUTH_CHECK_LIMIT,
    })
    async handleAppUidFromOrigin(req: Request, res: Response): Promise<void> {
        const origin = req.body?.origin || req.query?.origin;
        if (!origin)
            throw new HttpError(400, 'Missing `origin`', {
                legacyCode: 'bad_request',
            });
        const uid = await this.services.auth.appUidFromOrigin(origin as string);
        res.json({ uid });
    }

    // -- App token + check -------------------------------------------

    @Post('/auth/get-user-app-token', {
        subdomain: 'api',
        requireUserActor: true,
        // Called once per app launch, and the GUI can legitimately launch
        // several in quick succession.
        rateLimit: { ...AUTH_CHECK_LIMIT, scope: 'app-token', limit: 120 },
    })
    async handleGetUserAppToken(req: Request, res: Response): Promise<void> {
        let { app_uid } = req.body;
        const { origin } = req.body;
        const resolvedFromOrigin = !app_uid && !!origin;
        if (!app_uid && origin) {
            app_uid = await this.services.auth.appUidFromOrigin(origin);
        }
        if (!app_uid) {
            throw new HttpError(400, 'Missing `app_uid` or `origin`', {
                legacyCode: 'bad_request',
            });
        }

        let app = await this.stores.app.getByUid(app_uid);
        if (!app && resolvedFromOrigin) {
            // Hosted-subdomain origins get the site owner stamped as the
            // app's creator at bootstrap; external origins stay unowned.
            const ownerUserId =
                await this.services.auth.subdomainOwnerIdFromOrigin(origin);
            app = await this.stores.app.createFromOrigin(app_uid, origin, {
                ownerUserId,
            });
            // An origin's uid is a deterministic uuidv5, so a deleted app
            // reappears here under the identical uid. Withdraw any cross-app
            // data grants left pointing at it before this new row can inherit
            // consent the user gave its predecessor. Only *this* path can reuse
            // a uid: `AppStore.create` mints a random uuid4, which no deleted
            // app can ever hold again.
            //
            // Called directly rather than through `app.changed`: the token is
            // issued below, so this has to be able to stop that, and
            // `emitAndWait` swallows listener errors. Letting it throw is the
            // point — a sweep that failed leaves the old grants live against an
            // app whoever controls the origin now has just claimed.
            await this.services.appPermission.withdrawAppDataGrants(
                app_uid,
                'uid reused by a new app',
            );
        }
        if (!app) {
            throw new HttpError(404, `App ${app_uid} does not exist`, {
                legacyCode: 'not_found',
            });
        }

        const userPermGrantPromise =
            this.services.permission.grantUserAppPermission(
                req.actor!,
                app_uid,
                'flag:app-is-authenticated',
                {},
                {},
            );

        const tokenPromise = this.services.auth.getUserAppToken(
            req.actor!,
            app_uid,
        );

        const missingFSPathPromise = (async () => {
            // Ensure the app's per-user AppData directory exists.
            // v1 did this in LLMkdir with the app icon as thumbnail
            // on first app open. mkdir is idempotent (returns
            // existing dir without rewriting), and
            // createMissingParents seeds `/<username>/AppData` if
            // the user never had one. Path lookups in FSEntryStore
            // have a recursive-CTE fallback (mirrors v1's
            // `convert_path_to_fsentry` walk-down) so legacy rows
            // with a NULL `path` column still resolve and get
            // backfilled on first read.
            const username = req.actor!.user?.username;
            const userId = req.actor!.user?.id;
            if (username && userId) {
                await this.services.fs.mkdir(userId, {
                    path: `/${username}/AppData/${app_uid}`,
                    createMissingParents: true,
                    thumbnail: (app as { icon?: string | null }).icon ?? null,
                } as never);
            }
        })();

        const [, token] = await Promise.all([
            userPermGrantPromise,
            tokenPromise,
            missingFSPathPromise,
        ]);

        try {
            const a = app as {
                id?: number;
                uid?: string;
                index_url?: string | null;
                owner_user_id?: number | null;
                name?: string | null;
            };
            this.clients.event?.emit(
                'puter.app.authenticated' as never,
                {
                    app_uid,
                    app: {
                        id: a.id,
                        uid: a.uid,
                        index_url: a.index_url ?? null,
                        owner_user_id: a.owner_user_id ?? null,
                        name: a.name ?? null,
                    },
                    user_id: req.actor!.user?.id ?? null,
                } as never,
                {},
            );
        } catch {
            // Fine if failed
        }

        res.json({ token, app_uid });
    }

    @Post('/auth/check-app', {
        subdomain: 'api',
        requireUserActor: true,
        rateLimit: AUTH_CHECK_LIMIT,
    })
    async handleCheckApp(req: Request, res: Response): Promise<void> {
        let { app_uid } = req.body;
        const { origin } = req.body;
        if (!app_uid && origin) {
            app_uid = await this.services.auth.appUidFromOrigin(origin);
        }
        if (!app_uid)
            throw new HttpError(400, 'Missing `app_uid` or `origin`', {
                legacyCode: 'bad_request',
            });

        // Check if the app is authenticated for this user
        const authenticated = await this.services.permission
            .check(
                req.actor!,
                `service:${app_uid}:ii:flag:app-is-authenticated`,
            )
            .catch(() => false);

        const result: {
            app_uid: string;
            authenticated: boolean;
            token?: string;
        } = { app_uid, authenticated };
        if (authenticated) {
            result.token = await this.services.auth.getUserAppToken(
                req.actor!,
                app_uid,
            );
        }
        res.json(result);
    }

    // -- Access tokens -----------------------------------------------

    @Post('/auth/create-access-token', {
        subdomain: 'api',
        requireAuth: true,
        rateLimit: CREDENTIAL_MINT_LIMIT,
    })
    async handleCreateAccessToken(req: Request, res: Response): Promise<void> {
        const { permissions, expiresIn, label } = req.body;
        if (!Array.isArray(permissions) || permissions.length === 0) {
            throw new HttpError(400, 'Missing or empty `permissions` array', {
                legacyCode: 'bad_request',
            });
        }

        // Optional user-facing name for the manage-sessions UI. Trim and clamp
        // to the same 64-char limit the rename endpoint enforces.
        let normalizedLabel: string | null = null;
        if (label !== undefined && label !== null) {
            if (typeof label !== 'string') {
                throw new HttpError(400, '`label` must be a string', {
                    legacyCode: 'bad_request',
                });
            }
            normalizedLabel = label.trim().slice(0, 64) || null;
        }

        // Normalize specs: string → [string], [string] → [string, {}], [string, extra] → as-is
        const normalized = permissions.map((spec) => {
            if (typeof spec === 'string') return [spec];
            if (Array.isArray(spec)) return spec;
            throw new HttpError(
                400,
                'Each permission must be a string or [string, extra?]',
                { legacyCode: 'bad_request' },
            );
        });

        const token = await this.services.auth.createAccessToken(
            req.actor!,
            normalized as never,
            {
                ...(expiresIn ? { expiresIn } : {}),
                ...(normalizedLabel ? { label: normalizedLabel } : {}),
            },
        );
        res.json({ token });
    }

    // Wired imperatively in `registerRoutes` so the cookie-only gate
    // (built from `this.config`) can be composed in. Cookie-only is
    // mandatory: a leaked access token must not be able to silently
    // revoke its own siblings.
    async handleRevokeAccessToken(req: Request, res: Response): Promise<void> {
        let { tokenOrUuid } = req.body;
        if (!tokenOrUuid || typeof tokenOrUuid !== 'string') {
            throw new HttpError(400, 'Missing `tokenOrUuid`', {
                legacyCode: 'bad_request',
            });
        }
        // Extract JWT from /token-read URLs if needed
        if (tokenOrUuid.includes('/token-read')) {
            const match = tokenOrUuid.match(/\/token-read\/([^\s/?]+)/);
            if (match) tokenOrUuid = match[1];
        }
        await this.services.auth.revokeAccessToken(req.actor!, tokenOrUuid);
        res.json({ ok: true });
    }

    // -- 2FA: configure ----------------------------------------------

    @Post('/auth/configure-2fa/:action', {
        subdomain: 'api',
        requireUserActor: true,
        rateLimit: TWO_FACTOR_LIMIT,
    })
    async handleConfigure2fa(req: Request, res: Response): Promise<void> {
        const action = req.params.action;
        const user = await this.stores.user.getById(req.actor!.user.id!, {
            force: true,
        });
        if (!user)
            throw new HttpError(404, 'User not found', {
                legacyCode: 'not_found',
            });

        if (action === 'setup') {
            if (user.otp_enabled) {
                throw new HttpError(409, '2FA is already enabled.', {
                    legacyCode: 'conflict',
                });
            }

            const result = otpCreateSecret(user.username);

            // Generate 10 recovery codes
            const codes: string[] = [];
            for (let i = 0; i < 10; i++) {
                codes.push(createRecoveryCode());
            }
            const hashedCodes = codes.map((c) => hashRecoveryCode(c));

            await this.clients.db.write(
                'UPDATE `user` SET `otp_secret` = ?, `otp_recovery_codes` = ? WHERE `uuid` = ?',
                [result.secret, hashedCodes.join(','), user.uuid],
            );
            await this.stores.user.invalidateById(user.id);

            res.json({
                url: result.url,
                secret: result.secret,
                codes,
            });
            return;
        }

        if (action === 'test') {
            const { code } = req.body ?? {};
            if (!code)
                throw new HttpError(400, 'Missing `code`', {
                    legacyCode: 'bad_request',
                });
            const ok = verifyOtp(user.username, user.otp_secret, code);
            res.json({ ok });
            return;
        }

        if (action === 'enable') {
            if (!user.email_confirmed) {
                throw new HttpError(
                    403,
                    'Email must be confirmed before enabling 2FA.',
                    { legacyCode: 'forbidden' },
                );
            }
            if (user.otp_enabled) {
                throw new HttpError(409, '2FA is already enabled.', {
                    legacyCode: 'conflict',
                });
            }
            if (!user.otp_secret) {
                throw new HttpError(
                    409,
                    '2FA has not been configured. Call setup first.',
                    { legacyCode: 'conflict' },
                );
            }

            await this.clients.db.write(
                'UPDATE `user` SET `otp_enabled` = ? WHERE `uuid` = ?',
                [this.clients.db.booleanValue(true), user.uuid],
            );
            await this.stores.user.invalidateById(user.id);

            if (this.clients.email && user.email) {
                try {
                    await this.clients.email.send(user.email, 'enabled_2fa', {
                        username: user.username,
                    });
                } catch (e) {
                    console.warn('[configure-2fa] email send failed:', e);
                }
            }

            res.json({});
            return;
        }

        throw new HttpError(400, `Invalid action: ${action}`, {
            legacyCode: 'bad_request',
        });
    }

    // -- 2FA: disable (user-protected, wired in registerRoutes below) -

    async handleDisable2fa(req: Request, res: Response): Promise<void> {
        const user = await this.stores.user.getById(req.actor!.user.id!, {
            force: true,
        });
        if (!user)
            throw new HttpError(404, 'User not found', {
                legacyCode: 'not_found',
            });

        await this.clients.db.write(
            'UPDATE `user` SET `otp_enabled` = ?, `otp_recovery_codes` = NULL, `otp_secret` = NULL WHERE `uuid` = ?',
            [this.clients.db.booleanValue(false), user.uuid],
        );
        await this.stores.user.invalidateById(user.id);

        if (this.clients.email && user.email) {
            try {
                await this.clients.email.send(user.email, 'disabled_2fa', {
                    username: user.username,
                });
            } catch (e) {
                console.warn('[disable-2fa] email send failed:', e);
            }
        }

        res.json({ success: true });
    }

    // -- Developer profile -------------------------------------------

    @Get('/get-dev-profile', {
        subdomain: 'api',
        requireUserActor: true,
        rateLimit: AUTH_LIST_LIMIT,
    })
    async handleGetDevProfile(req: Request, res: Response): Promise<void> {
        const user = await this.stores.user.getById(req.actor!.user.id!, {
            force: true,
        });
        if (!user)
            throw new HttpError(404, 'User not found', {
                legacyCode: 'not_found',
            });

        const u = user as unknown as {
            first_name?: string | null;
            last_name?: string | null;
            approved_for_incentive_program?: number | boolean;
            joined_incentive_program?: number | boolean;
            paypal?: string | null;
        };
        res.json({
            first_name: u.first_name ?? null,
            last_name: u.last_name ?? null,
            approved_for_incentive_program: Boolean(
                u.approved_for_incentive_program,
            ),
            joined_incentive_program: Boolean(u.joined_incentive_program),
            paypal: u.paypal ?? null,
        });
    }

    // -- Group management --------------------------------------------

    @Post('/group/create', {
        subdomain: 'api',
        requireUserActor: true,
        // Creates a persistent row per call with no quota behind it, so it
        // sits on the hour-scale budget rather than the grant one.
        rateLimit: { ...CREDENTIAL_MINT_LIMIT, scope: 'group-create' },
    })
    async handleGroupCreate(req: Request, res: Response): Promise<void> {
        const extra = req.body.extra ?? {};
        const metadata = req.body.metadata ?? {};
        if (typeof extra !== 'object' || Array.isArray(extra))
            throw new HttpError(400, '`extra` must be an object', {
                legacyCode: 'bad_request',
            });
        if (typeof metadata !== 'object' || Array.isArray(metadata))
            throw new HttpError(400, '`metadata` must be an object', {
                legacyCode: 'bad_request',
            });

        const uid = await this.stores.group.create({
            ownerUserId: req.actor!.user.id,
            extra: {},
            metadata,
        } as never);
        res.json({ uid });
    }

    @Post('/group/add-users', {
        subdomain: 'api',
        requireUserActor: true,
        rateLimit: GRANT_LIMIT,
    })
    async handleGroupAddUsers(req: Request, res: Response): Promise<void> {
        const { uid, users } = req.body ?? {};
        if (!uid)
            throw new HttpError(400, 'Missing `uid`', {
                legacyCode: 'bad_request',
            });
        if (!Array.isArray(users))
            throw new HttpError(400, '`users` must be an array', {
                legacyCode: 'bad_request',
            });

        const group = await this.stores.group.getByUid(uid);
        if (!group)
            throw new HttpError(404, 'Group not found', {
                legacyCode: 'not_found',
            });
        if (
            (group as { owner_user_id?: number }).owner_user_id !==
            req.actor!.user.id
        )
            throw new HttpError(403, 'Forbidden', {
                legacyCode: 'forbidden',
            });

        await this.stores.group.addUsers(uid, users);
        // New members inherit the group's permissions immediately, not
        // after the permission-cache TTL.
        await this.services.permission.bumpPermissionCacheForUsernames(users);
        res.json({});
    }

    @Post('/group/remove-users', {
        subdomain: 'api',
        requireUserActor: true,
        rateLimit: GRANT_LIMIT,
    })
    async handleGroupRemoveUsers(req: Request, res: Response): Promise<void> {
        const { uid, users } = req.body ?? {};
        if (!uid)
            throw new HttpError(400, 'Missing `uid`', {
                legacyCode: 'bad_request',
            });
        if (!Array.isArray(users))
            throw new HttpError(400, '`users` must be an array', {
                legacyCode: 'bad_request',
            });

        const group = await this.stores.group.getByUid(uid);
        if (!group)
            throw new HttpError(404, 'Group not found', {
                legacyCode: 'not_found',
            });
        if (
            (group as { owner_user_id?: number }).owner_user_id !==
            req.actor!.user.id
        )
            throw new HttpError(403, 'Forbidden', {
                legacyCode: 'forbidden',
            });

        await this.stores.group.removeUsers(uid, users);
        // Removed members must lose the group's permissions immediately,
        // not after the permission-cache TTL.
        await this.services.permission.bumpPermissionCacheForUsernames(users);
        res.json({});
    }

    @Get('/group/list', {
        subdomain: 'api',
        requireUserActor: true,
        rateLimit: AUTH_LIST_LIMIT,
    })
    async handleGroupList(req: Request, res: Response): Promise<void> {
        const userId = req.actor!.user.id!;
        const [owned, member] = await Promise.all([
            this.stores.group.listGroupsWithOwner(userId),
            this.stores.group.listGroupsWithMember(userId),
        ]);
        res.json({
            owned_groups: owned,
            in_groups: member,
        });
    }

    @Get('/group/public-groups', {
        subdomain: 'api',
        // The only unauthenticated route in the group set, so IP is the
        // only key available — and that makes the bucket an aggregate:
        // one office, campus or carrier gateway is a single key for
        // everybody behind it, and each of them reads this once while
        // bootstrapping. Sized for that population of real people rather
        // than one browser, and no wider: this sits next to the sign-in
        // surface, so it stays a real bound on enumeration.
        rateLimit: {
            scope: 'public-groups',
            limit: 1_200,
            window: 60_000,
            key: 'ip',
        },
    })
    async handleGroupPublicGroups(_req: Request, res: Response): Promise<void> {
        res.json({
            user: this.config.default_user_group ?? null,
            temp: this.config.default_temp_group ?? null,
        });
    }

    // -- Session helpers ---------------------------------------------

    @Get('/get-gui-token', {
        requireUserActor: true,
        allowUnconfirmed: true,
        rateLimit: SESSION_LIMIT,
    })
    async handleGetGuiToken(req: Request, res: Response): Promise<void> {
        if (!req.actor?.session?.uid)
            throw new HttpError(400, 'No session bound to this actor', {
                legacyCode: 'session_required' as never,
            });
        const user = await this.stores.user.getById(req.actor.user.id!);
        if (!user)
            throw new HttpError(404, 'User not found', {
                legacyCode: 'not_found',
            });
        const guiToken = this.services.auth.createGuiToken(
            user,
            req.actor.session.uid,
        );
        res.json({ token: guiToken });
    }

    @Get('/session/sync-cookie', {
        rateLimit: SESSION_LIMIT,
        // Installs the session cookie. Only page script on our own origin
        // should be able to ask for that (the `tokenSource` check below is the
        // companion rule: the token has to come from an Authorization header,
        // not a URL).
        guiOriginOnly: true,
        requireUserActor: true,
        allowUnconfirmed: true,
    })
    async handleSessionSyncCookie(req: Request, res: Response): Promise<void> {
        // This route installs a session cookie, so the token has to come from
        // page script on our own origin rather than from the URL.
        if (req.tokenSource !== 'header') {
            throw new HttpError(
                401,
                'This endpoint requires an Authorization header.',
                { legacyCode: 'token_auth_failed' },
            );
        }
        if (!req.actor?.session?.uid) {
            res.status(400).end();
            return;
        }
        const user = await this.stores.user.getById(req.actor.user.id!);
        if (!user) {
            res.status(404).end();
            return;
        }
        const sessionToken = this.services.auth.createSessionTokenForSession(
            user,
            req.actor.session.uid,
        );
        res.cookie(this.config.cookie_name ?? 'puter_token', sessionToken, {
            ...sessionCookieFlags(this.config),
            httpOnly: true,
        });
        res.status(204).end();
    }

    // -- Step-up ("elevation"), wired below --------------------------
    //
    // Mints the second-factor cookie for a session that re-proves identity: a
    // fresh TOTP code when 2FA is enabled, otherwise the account password.
    // Privileged endpoints require it on top of the session, so a leaked session
    // alone can't exercise them. Accounts with neither credential (no password
    // and 2FA disabled) can't elevate.

    async handleElevate(req: Request, res: Response): Promise<void> {
        const user = await this.stores.user.getById(req.actor!.user.id!, {
            force: true,
        });
        if (!user)
            throw new HttpError(404, 'User not found.', {
                legacyCode: 'not_found',
            });
        if (user.suspended)
            throw new HttpError(403, 'Account suspended.', {
                legacyCode: 'account_suspended',
            });

        if (user.otp_enabled) {
            const code = req.body?.code;
            if (!code)
                throw new HttpError(400, 'code is required.', {
                    legacyCode: 'bad_request',
                    fields: { factor: 'otp' },
                });
            if (
                !verifyOtp(
                    user.username,
                    user.otp_secret as string,
                    String(code),
                )
            )
                throw new HttpError(401, 'Incorrect code.', {
                    legacyCode: 'code_mismatch' as never,
                    fields: { factor: 'otp' },
                });
        } else if (user.password) {
            const password = req.body?.password;
            if (!password || typeof password !== 'string')
                throw new HttpError(400, 'Password is required.', {
                    legacyCode: 'password_required',
                    fields: { factor: 'password' },
                });
            const match = await bcrypt.compare(
                password,
                user.password as string,
            );
            if (!match)
                throw new HttpError(401, 'Incorrect password.', {
                    legacyCode: 'password_mismatch',
                    fields: { factor: 'password' },
                });
        } else {
            // Neither credential on file (e.g. an account that only ever
            // authenticated through an external identity provider).
            throw new HttpError(
                403,
                'This account has no credential to re-authenticate with. Set a password or enable two-factor authentication first.',
                { legacyCode: 'elevation_unavailable' as never },
            );
        }

        const token = signStepUpToken(this.services.token, user as never);
        res.cookie(
            STEP_UP_COOKIE_NAME,
            token,
            stepUpCookieOptions(this.config),
        );

        // A browser reads its elevation back from the httpOnly cookie and never
        // needs the raw value; handing it to page JS would put the second factor
        // within reach of an XSS. API clients have no cookie jar, so they get the
        // token to send back as `x-puter-elevation`. Both paths proved the same
        // password/TOTP — this only avoids needless exposure, it isn't a gate.
        const cookieName = this.config.cookie_name ?? 'puter_token';
        const usedSessionCookie =
            !!req.token && req.token === req.cookies?.[cookieName];
        res.json(
            usedSessionCookie ? { elevated: true } : { elevated: true, token },
        );
    }

    // -- Delete own account (user-protected, wired below) ------------
    //
    // Purge S3 objects + fsentries first, then the user row. FK
    // cascades on most related tables are `ON DELETE SET NULL` (not
    // CASCADE), so anything holding tightly to user_id (sessions) we
    // clear explicitly to avoid orphan rows.

    async handleDeleteOwnUser(req: Request, res: Response): Promise<void> {
        const userId = req.actor!.user.id!;
        res.clearCookie(this.config.cookie_name ?? 'puter_token');
        res.clearCookie('puter_token_v2');
        res.clearCookie('puter_revalidation');
        res.clearCookie(STEP_UP_COOKIE_NAME, {
            ...(this.config.domain ? { domain: this.config.domain } : {}),
        });
        await this.#cascadeDeleteUser(userId);
        res.json({ success: true });
    }

    // -- registerRoutes override -------------------------------------
    //
    // The `@Controller('')` decorator would normally install a default
    // `registerRoutes` walker that iterates `prototype[__puterRoutes]`.
    // We override it here so we can ALSO wire the five
    // `/user-protected/*` (and `/user-protected/delete-own-user`) routes
    // whose `middleware: createUserProtectedGate(...)` argument is
    // built from instance state — not expressible inside a static
    // decorator literal.
    //
    // The first half of this method is a transcription of the default
    // walker (see core/http/decorators.ts → Controller). The second
    // half adds the imperative routes that need the per-instance gate.
    override registerRoutes(router: PuterRouter): void {
        const proto = Object.getPrototypeOf(this) as {
            [ROUTES_METADATA_KEY]?: CollectedRoute[];
        };
        const routes = (proto[ROUTES_METADATA_KEY] ?? []) as CollectedRoute[];
        for (const r of routes) {
            const bound = r.handler.bind(this) as RequestHandler;
            if (r.method === 'use') {
                if (r.path !== undefined) {
                    router.use(r.path, r.options, bound);
                } else {
                    router.use(r.options, bound);
                }
                continue;
            }
            if (r.path === undefined) {
                throw new Error(
                    `@${r.method.toUpperCase()} decorator missing path`,
                );
            }
            const routerMethod = router[
                r.method as Exclude<RouteMethod, 'use'>
            ] as (
                path: RoutePath,
                options: RouteOptions,
                handler: RequestHandler,
            ) => PuterRouter;
            routerMethod.call(router, r.path, r.options, bound);
        }

        // -- User-protected routes (per-instance middleware) ----------
        const userProtectedDeps = {
            config: this.config,
            userStore: this.stores.user,
            oidcService: this.services.oidc,
            tokenService: this.services.token,
        };

        router.post(
            '/user-protected/change-password',
            {
                requireUserActor: true,
                rateLimit: {
                    scope: 'passwd',
                    limit: 10,
                    window: 60 * 60_000,
                    key: 'user',
                },
                middleware: [
                    createUserProtectedGate(
                        userProtectedDeps as never,
                    ) as unknown as RequestHandler,
                ],
            },
            (req, res) => this.handleChangePassword(req, res),
        );

        router.post(
            '/user-protected/change-username',
            {
                requireUserActor: true,
                requireVerified: true,
                rateLimit: {
                    scope: 'change-username',
                    limit: 2,
                    window: 30 * 24 * 60 * 60_000,
                    key: 'user',
                },
                middleware: [
                    createUserProtectedGate(
                        userProtectedDeps as never,
                    ) as unknown as RequestHandler,
                ],
            },
            (req, res) => this.handleChangeUsername(req, res),
        );

        router.post(
            '/user-protected/change-email',
            {
                requireUserActor: true,
                rateLimit: {
                    scope: 'change-email-start',
                    limit: 10,
                    window: 60 * 60_000,
                    key: 'user',
                },
                middleware: [
                    createUserProtectedGate(
                        userProtectedDeps as never,
                    ) as unknown as RequestHandler,
                ],
            },
            (req, res) => this.handleChangeEmail(req, res),
        );

        router.post(
            '/user-protected/disable-2fa',
            {
                requireUserActor: true,
                rateLimit: {
                    scope: 'disable-2fa',
                    limit: 10,
                    window: 60 * 60_000,
                    key: 'user',
                },
                middleware: [
                    createUserProtectedGate(
                        userProtectedDeps as never,
                    ) as unknown as RequestHandler,
                ],
            },
            (req, res) => this.handleDisable2fa(req, res),
        );

        router.post(
            '/user-protected/delete-own-user',
            {
                requireUserActor: true,
                allowUnconfirmed: true,
                middleware: [
                    createUserProtectedGate(userProtectedDeps as never, {
                        allowTempUsers: true,
                    }) as unknown as RequestHandler,
                ],
            },
            (req, res) => this.handleDeleteOwnUser(req, res),
        );

        // Step-up. Served on the root origin (browser form posts same-origin)
        // and on `api` (SDK/script clients, which have no cookie jar and send a
        // bearer). Deliberately NOT cookie-gated: the password/TOTP in the body
        // is the control — a stolen token alone can't satisfy it, and it's also
        // what makes CSRF a non-issue. `requireUserActor` still keeps app and
        // access-token actors out, so an access token can never mint an
        // elevation for its issuer.
        router.post(
            '/auth/elevate',
            {
                subdomain: ['api', ''],
                requireUserActor: true,
                allowUnconfirmed: true,
                rateLimit: [
                    {
                        scope: 'elevate',
                        limit: 10,
                        window: 15 * 60_000,
                        key: 'user',
                    },
                    {
                        scope: 'elevate-ip',
                        limit: 40,
                        window: 15 * 60_000,
                        key: 'ip',
                    },
                ],
            },
            (req, res) => this.handleElevate(req, res),
        );

        const webSessionGate = createWebSessionActorGate();

        router.post(
            '/auth/revoke-session',
            {
                subdomain: 'api',
                requireUserActor: true,
                allowUnconfirmed: true,
                antiCsrf: true,
                middleware: [webSessionGate],
            },
            (req, res) => this.handleRevokeSession(req, res),
        );

        router.post(
            '/auth/revoke-all-sessions',
            {
                subdomain: 'api',
                requireUserActor: true,
                allowUnconfirmed: true,
                antiCsrf: true,
                rateLimit: {
                    scope: 'revoke-all-sessions',
                    limit: 10,
                    window: 60 * 60_000,
                    key: 'user',
                },
                middleware: [webSessionGate],
            },
            (req, res) => this.handleRevokeAllSessions(req, res),
        );

        router.post(
            '/auth/revoke-access-token',
            {
                subdomain: 'api',
                requireUserActor: true,
                antiCsrf: true,
                middleware: [webSessionGate],
            },
            (req, res) => this.handleRevokeAccessToken(req, res),
        );

        router.patch(
            '/auth/sessions/:uuid/label',
            {
                subdomain: 'api',
                requireUserActor: true,
                allowUnconfirmed: true,
                antiCsrf: true,
                middleware: [webSessionGate],
            },
            (req, res) => this.handleRenameSession(req, res),
        );
    }

    // -- Private helpers ----------------------------------------------

    async #cascadeDeleteUser(userId: number): Promise<void> {
        await this.services.userAccount.cascadeDelete(userId);
    }

    async #generateRandomUsername(): Promise<string> {
        let username: string;
        let attempts = 0;
        do {
            username = generate_identifier();
            attempts++;
            if (attempts > 20)
                throw new HttpError(
                    409,
                    'Failed to generate unique username. Try again later.',
                    { legacyCode: 'conflict' },
                );
        } while (await this.stores.user.getByUsername(username));
        return username;
    }

    /**
     * Decide whether a signup may take `email`, and hand back the placeholder
     * row it should convert instead of inserting a new one.
     *
     * Throws when a live account already owns the address. Returns the
     * unconfirmed, password-less pseudo row when one exists (admin
     * pre-provisioning — signup claims it), or null when the address is free.
     *
     * Called twice per signup: once early, to fail fast before the validate
     * hook and bcrypt, and once against the primary immediately before the
     * write.
     */
    async #resolveSignupEmailClaim(
        email: string,
        opts: { force?: boolean } = {},
    ): Promise<UserRow | null> {
        const existing = await this.stores.user.findEmailOwner(email, opts);
        if (!existing) return null;
        if (existing.email_confirmed || existing.password !== null) {
            throw new HttpError(
                400,
                'This email already exists in our database. Please use another one.',
                { legacyCode: 'bad_request' },
            );
        }
        return existing;
    }

    /**
     * Config-blocklist + extension-driven email validation. Config blocklist
     * (suffix match on cleaned email) blocks first; then the `email.validate`
     * event lets extensions (abuse) reject. Throws HttpError(400) on
     * rejection.
     */
    async #validateEmail(email: string): Promise<void> {
        if (
            isBlockedEmail(
                email,
                (this.config as { blockedEmailDomains?: string[] })
                    .blockedEmailDomains,
            )
        ) {
            throw new HttpError(400, 'This email is not allowed.', {
                legacyCode: 'email_not_allowed' as never,
            });
        }

        const validateEvent: {
            email: string;
            allow: boolean;
            message: string | null;
        } = {
            email: cleanEmail(email),
            allow: true,
            message: null,
        };
        try {
            await this.clients.event?.emitAndWait(
                'email.validate' as never,
                validateEvent as never,
                {},
            );
        } catch (e) {
            console.warn('[email-validate] hook failed:', e);
        }
        if (!validateEvent.allow) {
            throw new HttpError(
                400,
                validateEvent.message ??
                    'This email cannot be used. Please try a different email address.',
                { legacyCode: 'bad_request' },
            );
        }
    }

    /**
     * Per-IP enumeration clamp on `auth_id`-bearing auth requests. Separate
     * from the route-level rate limit so a tighter ceiling applies only to the
     * path that takes a uuid hint from the body — the normal login path stays
     * at its more generous limit.
     */
    async #checkAuthIdRateLimit(req: Request): Promise<void> {
        const ip = req.ip || req.socket?.remoteAddress || 'unknown';
        const ok = await checkRateLimit(
            `login-with-auth-id:${ip}`,
            5,
            15 * 60_000,
        );
        if (!ok) {
            throw new HttpError(429, 'Too many auth_id login attempts.', {
                legacyCode: 'too_many_requests',
                fields: { 'retry-after': 900 },
            });
        }
    }

    /**
     * Extract the `auth_id` claim from a client-supplied reauth_token. Returns
     * null when no token was supplied. Throws on invalid/expired tokens. The
     * reauth_token is a server-signed JWT minted by the authProbe at 401 time —
     * accepting only the signed envelope (vs. a raw UUID) means a leaked
     * auth_id alone can't attach a session to an existing account.
     */
    #extractAuthIdFromReauthToken(suppliedToken: unknown): string | null {
        if (suppliedToken === undefined || suppliedToken === null) return null;
        if (typeof suppliedToken !== 'string' || !suppliedToken) {
            throw new HttpError(400, 'Invalid `reauth_token`.', {
                legacyCode: 'bad_request',
            });
        }
        const { authId } = this.services.auth.verifyReauthToken(suppliedToken);
        return authId;
    }

    /**
     * Enforce a verified `auth_id` against the user the credential flow has
     * resolved. Caller has already extracted `auth_id` from the server-signed
     * reauth_token (or from an OTP-flow JWT). When the GUI is forced through
     * reauth, the 401 response embeds the reauth_token; the client echoes it
     * back so we can confirm the second login lands on the same user row —
     * critical for temp users, where a fresh signup would otherwise mint a new
     * account and strand their files.
     *
     * No `authId` supplied → no-op (normal login). Unknown `authId` → 404
     * (mirrors username-not-found, avoids being an enumeration oracle).
     * Mismatch against the resolved user → 409 (`auth_id_mismatch`).
     */
    async #enforceAuthIdMatch(
        req: Request,
        resolvedUser: { id: number; uuid: string },
        authId: string | null,
    ): Promise<void> {
        if (!authId) return;

        await this.#checkAuthIdRateLimit(req);

        // Common path: auth_id maps to the same uuid the credential flow
        // resolved. Skip the user-table read entirely. The DB lookup is
        // only needed to disambiguate 404 (unknown auth_id) from 409
        // (known but mismatched) on the error path.
        if (authId === resolvedUser.uuid) return;

        const authIdUser = await this.stores.user.getByUuid(authId);
        if (!authIdUser) {
            throw new HttpError(404, 'auth_id not found.', {
                legacyCode: 'not_found',
            });
        }
        if (authIdUser.id !== resolvedUser.id) {
            throw new HttpError(409, 'auth_id does not match credentials.', {
                legacyCode: 'bad_request',
                fields: { code: 'auth_id_mismatch' },
            });
        }
    }

    async #completeLogin(
        req: Request,
        res: Response,
        user: {
            id: number;
            uuid: string;
            username: string;
            email?: string | null;
            password?: string | null;
            email_confirmed?: number | boolean;
            requires_email_confirmation?: number | boolean;
            phone?: string | null;
            requires_phone_verification?: number | boolean;
            requires_card_verification?: number | boolean;
        },
    ): Promise<void> {
        const meta = {
            ip: req.ip || req.socket?.remoteAddress,
            user_agent: req.headers?.['user-agent'],
            origin: req.headers?.origin,
            host: req.headers?.host,
        };

        const { token: sessionToken, gui_token } =
            await this.services.auth.createSessionToken(user as never, meta);

        // HTTP-only cookie gets the session token
        res.cookie(this.config.cookie_name ?? 'puter_token', sessionToken, {
            ...sessionCookieFlags(this.config),
            httpOnly: true,
        });

        // Resolve taskbar items up-front so the GUI doesn't need a second
        // round-trip on first paint. Best-effort: a failure here shouldn't
        // block login (the client can still fetch them via /whoami later).
        let taskbar_items: unknown[] = [];
        try {
            taskbar_items = await getTaskbarItems(
                user as never,
                {
                    clients: this.clients,
                    stores: this.stores,
                    services: this.services,
                    apiBaseUrl: (this.config as { api_base_url?: string })
                        .api_base_url,
                } as never,
            );
        } catch (e) {
            console.warn('[auth] taskbar_items resolution failed:', e);
        }

        // Response body gets the GUI token (client never sees session token)
        res.json({
            proceed: true,
            next_step: 'complete',
            token: gui_token,
            user: {
                username: user.username,
                uuid: user.uuid,
                email: user.email,
                email_confirmed: user.email_confirmed,
                requires_email_confirmation: user.requires_email_confirmation,
                phone: user.phone,
                requires_phone_verification: user.requires_phone_verification,
                requires_card_verification: user.requires_card_verification,
                is_temp: user.password === null && user.email === null,
                taskbar_items,
            },
        });
    }
}
