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

import bcrypt from 'bcrypt';
import crypto from 'node:crypto';
import type { Request, RequestHandler, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import validator from 'validator';
import { Controller, Get, Post } from '../../core/http/decorators.js';
import { HttpError } from '../../core/http/HttpError.js';
import { antiCsrf } from '../../core/http/middleware/antiCsrf.js';
import { generateCaptcha } from '../../core/http/middleware/captcha.js';
import { createUserProtectedGate } from '../../core/http/middleware/userProtected.js';
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
import { cleanEmail, isBlockedEmail } from '../../util/email.js';
import { sessionCookieFlags } from '../../util/cookieFlags.js';
import { generate_identifier } from '../../util/identifier.js';
import { getTaskbarItems } from '../../util/taskbarItems.js';
import {
    generateDefaultFsentries,
    promoteToVerifiedGroup,
} from '../../util/userProvisioning.js';
import { PuterController } from '../types.js';

const USERNAME_REGEX = /^\w{1,}$/;
const USERNAME_MAX_LENGTH = 45;
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
 * Routes are declared via decorators (@Get/@Post on each handler). The
 * five `/user-protected/*` and `/user-protected/delete-own-user` routes
 * also need a per-instance `createUserProtectedGate(...)` middleware
 * built from `this.config / this.stores / this.services`, which can't
 * live in a static decorator literal — those are wired imperatively in
 * the `registerRoutes` override below. The override also re-runs the
 * default decorator-walker logic so the rest of the routes register
 * normally.
 */
@Controller('')
export class AuthController extends PuterController {
    // ── Login ───────────────────────────────────────────────────────

    @Post('/login', {
        subdomain: ['api', ''],
        captcha: true,
        rateLimit: { scope: 'login', limit: 10, window: 15 * 60_000 },
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
        const passwordMatch = await bcrypt.compare(password, user.password);
        if (!passwordMatch) {
            throw new HttpError(401, 'Incorrect password.', {
                legacyCode: 'password_mismatch',
            });
        }

        // OTP branching — if 2FA enabled, return a short-lived OTP JWT
        if (user.otp_enabled) {
            const otp_jwt_token = this.services.token.sign(
                'otp',
                {
                    user_uid: user.uuid,
                    purpose: 'otp-login',
                },
                { expiresIn: '5m' },
            );

            res.status(202).json({
                proceed: true,
                next_step: 'otp',
                otp_jwt_token,
            });
            return;
        }

        await this.#completeLogin(req, res, user);
    }

    // ── Login: OTP verification ─────────────────────────────────────

    @Post('/login/otp', {
        subdomain: ['api', ''],
        captcha: true,
        rateLimit: {
            scope: 'login-otp',
            limit: 15,
            window: 30 * 60_000,
        },
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
            decoded = this.services.token.verify('otp', token);
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

        await this.#completeLogin(req, res, user);
    }

    // ── Login: recovery code ────────────────────────────────────────

    @Post('/login/recovery-code', {
        subdomain: ['api', ''],
        captcha: true,
        rateLimit: {
            scope: 'login-recovery',
            limit: 10,
            window: 60 * 60_000,
        },
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
            decoded = this.services.token.verify('otp', token);
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
        const codes = (user.otp_recovery_codes || '')
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

        await this.#completeLogin(req, res, user);
    }

    // ── Signup ──────────────────────────────────────────────────────

    @Post('/signup', {
        subdomain: ['api', ''],
        captcha: true,
        rateLimit: { scope: 'signup', limit: 10, window: 15 * 60_000 },
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
        // Match on both raw `email` and canonical `clean_email` so
        // gmail-style aliases (`foo.bar+tag@gmail.com` vs
        // `foobar@gmail.com`) collapse to the same account.
        let pseudo_user = null;
        if (!is_temp) {
            const canonical = cleanEmail(body.email);
            const existing =
                (await this.stores.user.getByEmail(body.email)) ??
                (await this.stores.user.getByCleanEmail(canonical));
            if (existing) {
                // Confirmed account (regardless of credential type) → reject.
                if (existing.email_confirmed || existing.password !== null) {
                    throw new HttpError(
                        400,
                        'This email already exists in our database. Please use another one.',
                        { legacyCode: 'bad_request' },
                    );
                }
                // Password-null AND unconfirmed → treat as pseudo.
                pseudo_user = existing;
            }
        }

        // Extension-level validation gate. Abuse-prevention extensions
        // inspect the incoming signup and can:
        //   - block it outright via `event.allow = false`
        //   - force email confirmation via `event.requires_email_confirmation = true`
        //   - skip temp-user creation via `event.no_temp_user = true`
        // Listeners run sequentially so multi-signal checks (rate limit +
        // IP reputation + domain reputation) can short-circuit cleanly.
        const validateEvent: {
            req: Request;
            data: Record<string, unknown>;
            ip: string | null;
            email: string | undefined;
            allow: boolean;
            no_temp_user: boolean;
            requires_email_confirmation: boolean;
            message: string | null;
            code: string | null;
        } = {
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
            message: null,
            code: null,
        };
        try {
            await this.clients.event?.emitAndWait(
                'puter.signup.validate' as never,
                validateEvent as never,
                {},
            );
        } catch (e) {
            console.warn('[signup] validate hook failed:', e);
        }
        if (!validateEvent.allow) {
            throw new HttpError(
                403,
                validateEvent.message ?? 'Signup blocked',
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

        let user;
        if (pseudo_user) {
            // ── Pseudo-user claim (convert the placeholder row) ──
            await this.stores.user.update(pseudo_user.id, {
                username: body.username,
                password: password_hash,
                uuid: user_uuid,
                email_confirm_code,
                email_confirm_token,
                email_confirmed: 0,
                // Pseudo claims always require email confirmation — the
                // validate hook can only tighten, not loosen, so `1`
                // stays hardcoded here.
                requires_email_confirmation: 1,
                last_activity_ts: signupSqlTs,
            });

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
            // ── New user ────────────────────────────────────────
            const clientIp = req.ip || req.socket?.remoteAddress || null;
            const proxyIpChain = req.headers['x-forwarded-for'];

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
                },
                signup_ip: clientIp,
                signup_ip_forwarded: proxyIpChain,
                signup_user_agent: req.headers?.['user-agent'] ?? null,
                signup_origin: (req.headers?.origin as string | null) ?? null,
                signup_server: (this.config as { serverId?: string }).serverId,
                referrer: req.body.referrer ?? null,
                last_activity_ts: signupSqlTs,
            } as never);

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

        // ── Provision FS home + default folders ─────────────────
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

        // ── Send email confirmation ─────────────────────────────
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
                    ip:
                        (req?.headers?.['x-forwarded-for'] as
                            | string
                            | undefined) ||
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

    // ── Logout ──────────────────────────────────────────────────────

    @Post('/logout', {
        subdomain: ['api', ''],
        requireAuth: true,
        allowUnconfirmed: true,
        antiCsrf: true,
    })
    async handleLogout(req: Request, res: Response): Promise<void> {
        // Clear the session cookie
        res.clearCookie(this.config.cookie_name);

        // Remove the session (fire-and-forget)
        if (req.token) {
            this.services.auth.removeSessionByToken(req.token).catch(() => {});
        }

        // Delete temp users (no password + no email). Full cascade —
        // same path as /user-protected/delete-own-user — so we don't
        // orphan fsentries/sessions/permissions.
        if (req.actor?.user && !req.actor.user.email) {
            const user = await this.stores.user.getByUuid(req.actor.user.uuid);
            if (user && user.password === null && user.email === null) {
                this.#cascadeDeleteUser(user.id).catch((e) => {
                    console.warn('[logout] temp-user cleanup failed:', e);
                });
            }
        }

        res.send('logged out');
    }

    // ── Email confirmation ──────────────────────────────────────────

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
        if (String(user.email_confirm_code) !== String(code)) {
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

    // ── Password recovery ───────────────────────────────────────────

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
            decoded = this.services.token.verify('otp', token);
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

        const exp = decoded.exp;
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
            decoded = this.services.token.verify('otp', token);
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
        const result = await this.clients.db.write(
            'UPDATE `user` SET `password` = ?, `pass_recovery_token` = NULL, `change_email_confirm_token` = NULL WHERE `id` = ? AND `pass_recovery_token` = ?',
            [password_hash, user.id, decoded.token],
        );
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

        res.send('Password successfully updated.');
    }

    // ── User-protected mutations ────────────────────────────────────
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

        // Block if any confirmed account (password or OIDC) already
        // owns that email. Match raw + canonical to collapse gmail
        // aliases.
        const canonical = cleanEmail(new_email);
        const existing =
            (await this.stores.user.getByEmail(new_email)) ??
            (await this.stores.user.getByCleanEmail(canonical));
        if (
            existing &&
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
            'SELECT * FROM `user` WHERE `change_email_confirm_token` = ? LIMIT 1',
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
        // password-holding) already owns it.
        const canonical = cleanEmail(newEmail);
        const owner =
            (await this.stores.user.getByEmail(newEmail)) ??
            (await this.stores.user.getByCleanEmail(canonical));
        if (
            owner &&
            owner.id !== user.id &&
            (owner.email_confirmed || owner.password !== null)
        ) {
            throw new HttpError(400, 'This email is already in use.', {
                legacyCode: 'email_already_in_use' as never,
            });
        }

        await this.stores.user.update(user.id, {
            email: newEmail,
            clean_email: cleanEmail(newEmail),
            unconfirmed_change_email: null,
            change_email_confirm_token: null,
            pass_recovery_token: null,
            email_confirmed: 1,
            requires_email_confirmation: 0,
        });

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

    // ── Save account (convert temp user to permanent) ───────────────

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
        const existingEmail =
            (await this.stores.user.getByEmail(email)) ??
            (await this.stores.user.getByCleanEmail(canonical));
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

        await this.stores.user.update(user.id, {
            username,
            email,
            clean_email: cleanEmail(email),
            password: password_hash,
            email_confirm_code,
            email_confirm_token,
            email_confirmed: 0,
            requires_email_confirmation: 1,
        });

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

    // ── Captcha generation ───────────────────────────────────────────

    @Get('/api/captcha/generate', { subdomain: '*' })
    async handleCaptchaGenerate(_req: Request, res: Response): Promise<void> {
        const difficulty =
            (this.config as { captcha?: { difficulty?: string } }).captcha
                ?.difficulty || 'medium';
        const { token, image } = await generateCaptcha(difficulty);
        res.json({ token, image });
    }

    // ── Anti-CSRF token generation ──────────────────────────────────

    @Get('/get-anticsrf-token', {
        subdomain: '',
        requireAuth: true,
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

    // ── Permission grants ───────────────────────────────────────────

    @Post('/auth/grant-user-user', {
        subdomain: 'api',
        requireUserActor: true,
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

    @Post('/auth/grant-user-app', {
        subdomain: 'api',
        requireUserActor: true,
    })
    async handleGrantUserApp(req: Request, res: Response): Promise<void> {
        const { app_uid, permission, extra, meta } = req.body;
        if (!app_uid || !permission) {
            throw new HttpError(400, 'Missing `app_uid` or `permission`', {
                legacyCode: 'bad_request',
            });
        }
        await this.services.permission.grantUserAppPermission(
            req.actor!,
            app_uid,
            permission,
            extra,
            meta,
        );
        res.json({});
    }

    @Post('/auth/grant-user-group', {
        subdomain: 'api',
        requireUserActor: true,
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

    // ── Permission revokes ──────────────────────────────────────────

    @Post('/auth/revoke-user-user', {
        subdomain: 'api',
        requireUserActor: true,
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
    })
    async handleRevokeUserApp(req: Request, res: Response): Promise<void> {
        const { app_uid, permission, meta } = req.body;
        if (!app_uid || !permission) {
            throw new HttpError(400, 'Missing `app_uid` or `permission`', {
                legacyCode: 'bad_request',
            });
        }
        if (permission === '*') {
            await this.services.permission.revokeUserAppAll(
                req.actor!,
                app_uid,
                meta,
            );
        } else {
            await this.services.permission.revokeUserAppPermission(
                req.actor!,
                app_uid,
                permission,
                meta,
            );
        }
        res.json({});
    }

    @Post('/auth/revoke-user-group', {
        subdomain: 'api',
        requireUserActor: true,
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

    // ── Permission checks ───────────────────────────────────────────

    @Post('/auth/check-permissions', { subdomain: 'api', requireAuth: true })
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

    // ── Session management ──────────────────────────────────────────

    @Get('/auth/list-sessions', { subdomain: 'api', requireUserActor: true })
    async handleListSessions(req: Request, res: Response): Promise<void> {
        const sessions = await this.services.auth.listSessions(req.actor!);
        res.json(sessions);
    }

    @Post('/auth/revoke-session', {
        subdomain: 'api',
        requireUserActor: true,
        allowUnconfirmed: true,
        antiCsrf: true,
    })
    async handleRevokeSession(req: Request, res: Response): Promise<void> {
        const { uuid } = req.body;
        if (!uuid || typeof uuid !== 'string') {
            throw new HttpError(400, 'Missing or invalid `uuid`', {
                legacyCode: 'bad_request',
            });
        }
        const session = await this.stores.session.getByUuid(uuid);
        if (session.user_id !== req.actor!.user.id) {
            throw new HttpError(403, 'Can only revoke your own sessions', {
                legacyCode: 'unauthorized',
            });
        }
        await this.services.auth.revokeSession(uuid);
        const sessions = await this.services.auth.listSessions(req.actor!);
        res.json({ sessions });
    }

    // ── Dev app permissions ─────────────────────────────────────────

    @Post('/auth/grant-dev-app', { subdomain: 'api', requireUserActor: true })
    async handleGrantDevApp(req: Request, res: Response): Promise<void> {
        let { app_uid } = req.body;
        const { origin, permission, extra, meta } = req.body;
        if (origin && !app_uid) {
            app_uid = await this.services.auth.appUidFromOrigin(origin);
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
    })
    async handleRevokeDevApp(req: Request, res: Response): Promise<void> {
        let { app_uid } = req.body;
        const { origin, permission, meta } = req.body;
        if (origin && !app_uid) {
            app_uid = await this.services.auth.appUidFromOrigin(origin);
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
        }
        await this.services.permission.revokeDevAppPermission(
            req.actor!,
            app_uid,
            permission,
            meta,
        );
        res.json({});
    }

    // ── Permission listing ──────────────────────────────────────────

    @Get('/auth/list-permissions', {
        subdomain: 'api',
        requireUserActor: true,
    })
    async handleListPermissions(req: Request, res: Response): Promise<void> {
        const userId = req.actor!.user.id;
        const db = this.clients.db;

        const [appPerms, userPermsOut, userPermsIn] = await Promise.all([
            db.read(
                'SELECT `app_uid`, `permission`, `extra` FROM `user_to_app_permissions` WHERE `user_id` = ?',
                [userId],
            ),
            db.read(
                'SELECT u.`username`, p.`permission`, p.`extra` FROM `user_to_user_permissions` p ' +
                    'JOIN `user` u ON u.`id` = p.`target_user_id` WHERE p.`issuer_user_id` = ?',
                [userId],
            ),
            db.read(
                'SELECT u.`username`, p.`permission`, p.`extra` FROM `user_to_user_permissions` p ' +
                    'JOIN `user` u ON u.`id` = p.`issuer_user_id` WHERE p.`target_user_id` = ?',
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

    // ── App origin resolution ───────────────────────────────────────

    @Post('/auth/app-uid-from-origin', { subdomain: 'api', requireAuth: true })
    async handleAppUidFromOrigin(req: Request, res: Response): Promise<void> {
        const origin = req.body?.origin || req.query?.origin;
        if (!origin)
            throw new HttpError(400, 'Missing `origin`', {
                legacyCode: 'bad_request',
            });
        const uid = await this.services.auth.appUidFromOrigin(origin as string);
        res.json({ uid });
    }

    // ── App token + check ───────────────────────────────────────────

    @Post('/auth/get-user-app-token', {
        subdomain: 'api',
        requireUserActor: true,
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
            app = await this.stores.app.createFromOrigin(app_uid, origin);
        }
        if (!app) {
            throw new HttpError(404, `App ${app_uid} does not exist`, {
                legacyCode: 'not_found',
            });
        }
        // Grant the app-is-authenticated flag
        const userPermGrantPromise =
            await this.services.permission.grantUserAppPermission(
                req.actor!,
                app_uid,
                'flag:app-is-authenticated',
                {},
                {},
            );

        const token = this.services.auth.getUserAppToken(req.actor!, app_uid);

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

        await Promise.all([userPermGrantPromise, missingFSPathPromise]);

        res.json({ token, app_uid });
    }

    @Post('/auth/check-app', { subdomain: 'api', requireUserActor: true })
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
            result.token = this.services.auth.getUserAppToken(
                req.actor!,
                app_uid,
            );
        }
        res.json(result);
    }

    // ── Access tokens ───────────────────────────────────────────────

    @Post('/auth/create-access-token', {
        subdomain: 'api',
        requireAuth: true,
    })
    async handleCreateAccessToken(req: Request, res: Response): Promise<void> {
        const { permissions, expiresIn } = req.body;
        if (!Array.isArray(permissions) || permissions.length === 0) {
            throw new HttpError(400, 'Missing or empty `permissions` array', {
                legacyCode: 'bad_request',
            });
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
            expiresIn ? { expiresIn } : {},
        );
        res.json({ token });
    }

    @Post('/auth/revoke-access-token', {
        subdomain: 'api',
        requireUserActor: true,
    })
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

    // ── 2FA: configure ──────────────────────────────────────────────

    @Post('/auth/configure-2fa/:action', {
        subdomain: 'api',
        requireUserActor: true,
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
                'UPDATE `user` SET `otp_enabled` = 1 WHERE `uuid` = ?',
                [user.uuid],
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

    // ── 2FA: disable (user-protected, wired in registerRoutes below) ─

    async handleDisable2fa(req: Request, res: Response): Promise<void> {
        const user = await this.stores.user.getById(req.actor!.user.id!, {
            force: true,
        });
        if (!user)
            throw new HttpError(404, 'User not found', {
                legacyCode: 'not_found',
            });

        await this.clients.db.write(
            'UPDATE `user` SET `otp_enabled` = 0, `otp_recovery_codes` = NULL, `otp_secret` = NULL WHERE `uuid` = ?',
            [user.uuid],
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

    // ── Developer profile ───────────────────────────────────────────

    @Get('/get-dev-profile', { subdomain: 'api', requireUserActor: true })
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

    // ── Group management ────────────────────────────────────────────

    @Post('/group/create', { subdomain: 'api', requireUserActor: true })
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

    @Post('/group/add-users', { subdomain: 'api', requireUserActor: true })
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
        res.json({});
    }

    @Post('/group/remove-users', { subdomain: 'api', requireUserActor: true })
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
        res.json({});
    }

    @Get('/group/list', { subdomain: 'api', requireUserActor: true })
    async handleGroupList(req: Request, res: Response): Promise<void> {
        const userId = req.actor!.user.id!;
        const groupStore = this.stores.group as unknown as {
            listByOwner: (id: number) => Promise<unknown[]>;
            listByMember: (id: number) => Promise<unknown[]>;
        };
        const [owned, member] = await Promise.all([
            groupStore.listByOwner(userId),
            groupStore.listByMember(userId),
        ]);
        res.json({
            owned_groups: owned,
            in_groups: member,
        });
    }

    @Get('/group/public-groups', { subdomain: 'api' })
    async handleGroupPublicGroups(_req: Request, res: Response): Promise<void> {
        res.json({
            user: this.config.default_user_group ?? null,
            temp: this.config.default_temp_group ?? null,
        });
    }

    // ── Session helpers ─────────────────────────────────────────────

    @Get('/get-gui-token', {
        subdomain: ['api', ''],
        requireUserActor: true,
        allowUnconfirmed: true,
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
        subdomain: ['api', ''],
        requireUserActor: true,
        allowUnconfirmed: true,
    })
    async handleSessionSyncCookie(req: Request, res: Response): Promise<void> {
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
        res.cookie(this.config.cookie_name, sessionToken, {
            ...sessionCookieFlags(this.config),
            httpOnly: true,
        });
        res.status(204).end();
    }

    // ── Delete own account (user-protected, wired below) ────────────
    //
    // Purge S3 objects + fsentries first, then the user row. FK
    // cascades on most related tables are `ON DELETE SET NULL` (not
    // CASCADE), so anything holding tightly to user_id (sessions) we
    // clear explicitly to avoid orphan rows.

    async handleDeleteOwnUser(req: Request, res: Response): Promise<void> {
        const userId = req.actor!.user.id!;
        res.clearCookie(this.config.cookie_name);
        res.clearCookie('puter_revalidation');
        await this.#cascadeDeleteUser(userId);
        res.json({ success: true });
    }

    // ── registerRoutes override ─────────────────────────────────────
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

        // ── User-protected routes (per-instance middleware) ──────────
        const userProtectedDeps = {
            config: this.config,
            userStore: this.stores.user,
            oidcService: this.services.oidc,
            tokenService: this.services.token,
        };

        router.post(
            '/user-protected/change-password',
            {
                subdomain: ['api', ''],
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
                subdomain: ['api', ''],
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
                subdomain: ['api', ''],
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
                subdomain: ['api', ''],
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
                subdomain: ['api', ''],
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
    }

    // ── Private helpers ──────────────────────────────────────────────

    async #cascadeDeleteUser(userId: number): Promise<void> {
        try {
            await this.services.fs.removeAllForUser(userId);
        } catch (e) {
            // Proceed with user-row delete anyway — orphaned fsentries are
            // better than a resurrected account.
            console.warn('[cascade-delete-user] fs cleanup failed:', e);
        }

        // Sessions FK is SET NULL, so delete explicitly to avoid dangling rows.
        await this.clients.db.write(
            'DELETE FROM `sessions` WHERE `user_id` = ?',
            [userId],
        );
        await this.clients.db.write('DELETE FROM `user` WHERE `id` = ?', [
            userId,
        ]);
        await this.stores.user.invalidateById(userId);
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
     * Config-blocklist + extension-driven email validation.
     * Config blocklist (suffix match on cleaned email) blocks first; then
     * the `email.validate` event lets extensions (abuse) reject.
     * Throws HttpError(400) on rejection.
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
        res.cookie(this.config.cookie_name, sessionToken, {
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
                is_temp: user.password === null && user.email === null,
                taskbar_items,
            },
        });
    }
}
