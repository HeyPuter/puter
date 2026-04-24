import bcrypt from 'bcrypt';
import crypto from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import validator from 'validator';
import { HttpError } from '../../core/http/HttpError.js';
import { antiCsrf } from '../../core/http/middleware/antiCsrf.js';
import { createUserProtectedGate } from '../../core/http/middleware/userProtected.js';
import { cleanEmail, isBlockedEmail } from '../../util/email.js';
import {
    generateDefaultFsentries,
    promoteToVerifiedGroup,
} from '../../util/userProvisioning.js';
import { generateCaptcha } from '../../core/http/middleware/captcha.js';
import {
    createSecret as otpCreateSecret,
    createRecoveryCode,
    hashRecoveryCode,
    verify as verifyOtp,
} from '../../services/auth/OTPUtil.js';
import { generate_identifier } from '../../util/identifier.js';
import { getTaskbarItems } from '../../util/taskbarItems.js';
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
 * Uses imperative route registration (no decorators) so it stays JS.
 */
export class AuthController extends PuterController {
    constructor(config, clients, stores, services) {
        super(config, clients, stores, services);
    }

    get permissionService() {
        return this.services.permission;
    }
    get authService() {
        return this.services.auth;
    }
    get tokenService() {
        return this.services.token;
    }
    get userStore() {
        return this.stores.user;
    }
    get groupStore() {
        return this.stores.group;
    }

    registerRoutes(
        /** @type {import('../../core/http/PuterRouter.js').PuterRouter} */ router,
    ) {
        // ── Login ───────────────────────────────────────────────────

        router.post(
            '/login',
            {
                subdomain: ['api', ''],
                captcha: true,
                rateLimit: { scope: 'login', limit: 10, window: 15 * 60_000 },
            },
            async (req, res) => {
                const { username, email, password } = req.body;

                if (!username && !email) {
                    throw new HttpError(400, 'Username or email is required.');
                }
                if (!password || typeof password !== 'string') {
                    throw new HttpError(400, 'Password is required.');
                }
                if (password.length < (this.config.min_pass_length || 6)) {
                    throw new HttpError(400, 'Invalid password.');
                }

                // Look up user
                let user;
                if (username) {
                    if (typeof username !== 'string')
                        throw new HttpError(400, 'username must be a string.');
                    user = await this.userStore.getByUsername(username);
                } else {
                    user = await this.userStore.getByEmail(email);
                }

                if (!user) {
                    throw new HttpError(
                        400,
                        username ? 'Username not found.' : 'Email not found.',
                    );
                }
                if (
                    user.username === 'system' &&
                    !this.config.allow_system_login
                ) {
                    throw new HttpError(
                        400,
                        username ? 'Username not found.' : 'Email not found.',
                    );
                }
                if (user.suspended) {
                    throw new HttpError(401, 'This account is suspended.');
                }
                if (user.password === null) {
                    throw new HttpError(400, 'Incorrect password.');
                }

                // Verify password
                const passwordMatch = await bcrypt.compare(
                    password,
                    user.password,
                );
                if (!passwordMatch) {
                    throw new HttpError(400, 'Incorrect password.');
                }

                // OTP branching — if 2FA enabled, return a short-lived OTP JWT
                if (user.otp_enabled) {
                    const otp_jwt_token = this.tokenService.sign(
                        'otp',
                        {
                            user_uid: user.uuid,
                            purpose: 'otp-login',
                        },
                        { expiresIn: '5m' },
                    );

                    return res.status(202).json({
                        proceed: true,
                        next_step: 'otp',
                        otp_jwt_token,
                    });
                }

                return this.#completeLogin(req, res, user);
            },
        );

        // ── Login: OTP verification ─────────────────────────────────

        router.post(
            '/login/otp',
            {
                subdomain: ['api', ''],
                captcha: true,
                rateLimit: {
                    scope: 'login-otp',
                    limit: 15,
                    window: 30 * 60_000,
                },
            },
            async (req, res) => {
                const { token, code } = req.body;
                if (!token) throw new HttpError(400, 'token is required.');
                if (!code) throw new HttpError(400, 'code is required.');

                let decoded;
                try {
                    decoded = this.tokenService.verify('otp', token);
                } catch {
                    throw new HttpError(400, 'Invalid token.');
                }
                if (!decoded.user_uid || decoded.purpose !== 'otp-login') {
                    throw new HttpError(400, 'Invalid token.');
                }

                const user = await this.userStore.getByUuid(decoded.user_uid);
                if (!user) throw new HttpError(400, 'User not found.');
                if (user.suspended) {
                    throw new HttpError(401, 'This account is suspended.');
                }

                if (!verifyOtp(user.username, user.otp_secret, code)) {
                    return res.json({ proceed: false });
                }

                return this.#completeLogin(req, res, user);
            },
        );

        // ── Login: recovery code ────────────────────────────────────

        router.post(
            '/login/recovery-code',
            {
                subdomain: ['api', ''],
                captcha: true,
                rateLimit: {
                    scope: 'login-recovery',
                    limit: 10,
                    window: 60 * 60_000,
                },
            },
            async (req, res) => {
                const { token, code } = req.body;
                if (!token) throw new HttpError(400, 'token is required.');
                if (!code) throw new HttpError(400, 'code is required.');

                let decoded;
                try {
                    decoded = this.tokenService.verify('otp', token);
                } catch {
                    throw new HttpError(400, 'Invalid token.');
                }
                if (!decoded.user_uid || decoded.purpose !== 'otp-login') {
                    throw new HttpError(400, 'Invalid token.');
                }

                const user = await this.userStore.getByUuid(decoded.user_uid);
                if (!user) throw new HttpError(400, 'User not found.');
                if (user.suspended) {
                    throw new HttpError(401, 'This account is suspended.');
                }

                const hashed = hashRecoveryCode(code);
                const codes = (user.otp_recovery_codes || '')
                    .split(',')
                    .filter(Boolean);
                const idx = codes.indexOf(hashed);
                if (idx === -1) {
                    return res.json({ proceed: false });
                }

                // Consume the recovery code
                codes.splice(idx, 1);
                await this.clients.db.write(
                    'UPDATE `user` SET `otp_recovery_codes` = ? WHERE `uuid` = ?',
                    [codes.join(','), user.uuid],
                );
                await this.userStore.invalidateById(user.id);

                return this.#completeLogin(req, res, user);
            },
        );

        // ── Signup ──────────────────────────────────────────────────

        router.post(
            '/signup',
            {
                subdomain: ['api', ''],
                captcha: true,
                rateLimit: { scope: 'signup', limit: 10, window: 15 * 60_000 },
            },
            async (req, res) => {
                const body = req.body ?? {};
                const is_temp = Boolean(body.is_temp);

                // Bot honeypot — only applies to non-temp signups
                if (
                    !is_temp &&
                    body.p102xyzname !== '' &&
                    body.p102xyzname !== undefined
                ) {
                    return res.json({});
                }

                // Fill in temp user defaults
                if (is_temp) {
                    body.username ??= await this.#generateRandomUsername();
                    body.email ??= `${body.username}@gmail.com`;
                    body.password ??= uuidv4();
                }

                // Validation
                if (!body.username)
                    throw new HttpError(400, 'Username is required');
                if (typeof body.username !== 'string')
                    throw new HttpError(400, 'username must be a string.');
                if (!USERNAME_REGEX.test(body.username)) {
                    throw new HttpError(
                        400,
                        'Username can only contain letters, numbers and underscore (_).',
                    );
                }
                if (body.username.length > USERNAME_MAX_LENGTH) {
                    throw new HttpError(
                        400,
                        `Username cannot be longer than ${USERNAME_MAX_LENGTH} characters.`,
                    );
                }
                if (RESERVED_USERNAMES.has(body.username.toLowerCase())) {
                    throw new HttpError(400, 'This username is not available.');
                }
                if (!is_temp) {
                    if (!body.email)
                        throw new HttpError(400, 'Email is required');
                    if (typeof body.email !== 'string')
                        throw new HttpError(400, 'email must be a string.');
                    if (!validator.isEmail(body.email))
                        throw new HttpError(
                            400,
                            'Please enter a valid email address.',
                        );
                    // Block listed/disposable domains (env=dev bypasses to keep fixtures working).
                    if (
                        this.config.env !== 'dev' &&
                        isBlockedEmail(
                            body.email,
                            this.config.blockedEmailDomains,
                        )
                    ) {
                        throw new HttpError(400, 'This email is not allowed.');
                    }
                    if (!body.password)
                        throw new HttpError(400, 'Password is required');
                    if (typeof body.password !== 'string')
                        throw new HttpError(400, 'password must be a string.');
                    const minLen = this.config.min_pass_length || 6;
                    if (body.password.length < minLen) {
                        throw new HttpError(
                            400,
                            `Password must be at least ${minLen} characters long.`,
                        );
                    }
                }

                // Duplicate username check
                if (await this.userStore.getByUsername(body.username)) {
                    throw new HttpError(
                        400,
                        'This username already exists in our database. Please use another one.',
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
                        (await this.userStore.getByEmail(body.email)) ??
                        (await this.userStore.getByCleanEmail(canonical));
                    if (existing) {
                        // Confirmed account (regardless of credential type) → reject.
                        if (
                            existing.email_confirmed ||
                            existing.password !== null
                        ) {
                            throw new HttpError(
                                400,
                                'This email already exists in our database. Please use another one.',
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
                const validateEvent = {
                    req,
                    data: body,
                    allow: true,
                    no_temp_user: false,
                    requires_email_confirmation: false,
                    message: null,
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
                    throw new HttpError(
                        403,
                        validateEvent.message ?? 'Signup blocked',
                    );
                }
                if (is_temp && validateEvent.no_temp_user) {
                    throw new HttpError(
                        403,
                        validateEvent.message ??
                            'Temporary accounts are disabled',
                    );
                }
                const force_email_confirmation = Boolean(
                    validateEvent.requires_email_confirmation,
                );

                // Prepare shared fields
                const user_uuid = uuidv4();
                const email_confirm_code = String(
                    crypto.randomInt(100000, 1000000),
                );
                const email_confirm_token = uuidv4();
                const password_hash = is_temp
                    ? null
                    : await bcrypt.hash(body.password, 8);

                let user;
                if (pseudo_user) {
                    // ── Pseudo-user claim (convert the placeholder row) ──
                    await this.userStore.update(pseudo_user.id, {
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
                    });

                    // Move from temp group to regular user group
                    if (this.config.default_temp_group) {
                        try {
                            await this.groupStore.removeUsers(
                                this.config.default_temp_group,
                                [body.username],
                            );
                        } catch {
                            // Best-effort — missing membership shouldn't block signup
                        }
                    }
                    if (this.config.default_user_group) {
                        try {
                            await this.groupStore.addUsers(
                                this.config.default_user_group,
                                [body.username],
                            );
                        } catch (e) {
                            console.warn(
                                '[signup] group assignment failed:',
                                e,
                            );
                        }
                    }

                    user = await this.userStore.getById(pseudo_user.id, {
                        force: true,
                    });
                } else {
                    // ── New user ────────────────────────────────────────
                    user = await this.userStore.create({
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
                            ip: req.socket?.remoteAddress,
                            ip_fwd: req.headers?.['x-forwarded-for'],
                            user_agent: req.headers?.['user-agent'],
                            origin: req.headers?.origin,
                        },
                        signup_ip: req.socket?.remoteAddress ?? null,
                        signup_ip_forwarded:
                            req.headers?.['x-forwarded-for'] ?? null,
                        signup_user_agent: req.headers?.['user-agent'] ?? null,
                        signup_origin: req.headers?.origin ?? null,
                    });

                    // Add to default group
                    const defaultGroup = is_temp
                        ? this.config.default_temp_group
                        : this.config.default_user_group;
                    if (defaultGroup) {
                        try {
                            await this.groupStore.addUsers(defaultGroup, [
                                user.username,
                            ]);
                        } catch (e) {
                            console.warn(
                                '[signup] group assignment failed:',
                                e,
                            );
                        }
                    }
                }

                // ── Provision FS home + default folders ─────────────────
                // Idempotent — skips if `user.trash_uuid` is already set (pseudo
                // users who went through a prior signup won't double-create).
                try {
                    await generateDefaultFsentries(
                        this.clients.db,
                        this.userStore,
                        user,
                    );
                } catch (e) {
                    console.warn(
                        '[signup] generateDefaultFsentries failed:',
                        e,
                    );
                }

                // ── Send email confirmation ─────────────────────────────
                if (
                    !is_temp &&
                    user.requires_email_confirmation &&
                    this.clients.email
                ) {
                    const sendCode = body.send_confirmation_code ?? true;
                    try {
                        if (sendCode) {
                            await this.clients.email.send(
                                user.email,
                                'email_verification_code',
                                {
                                    code: email_confirm_code,
                                },
                            );
                        } else {
                            const link = `${this.config.origin ?? ''}/confirm-email-by-token?token=${email_confirm_token}&user_uuid=${user.uuid}`;
                            await this.clients.email.send(
                                user.email,
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
                        'puter.signup.success',
                        {
                            user_id: user.id,
                            user_uuid: user.uuid,
                            email: user.email,
                            username: user.username,
                            ip:
                                req.headers?.['x-forwarded-for'] ||
                                req.socket?.remoteAddress,
                        },
                        {},
                    );
                } catch {
                    // ignore — event emission shouldn't block signup
                }
                if (!is_temp) {
                    try {
                        this.clients.event?.emit(
                            'user.save_account',
                            { user_id: user.id },
                            {},
                        );
                    } catch {
                        // ignore
                    }
                }

                return this.#completeLogin(req, res, user);
            },
        );

        // ── Logout ──────────────────────────────────────────────────

        router.post(
            '/logout',
            { subdomain: ['api', ''], requireAuth: true, antiCsrf: true },
            async (req, res) => {
                // Clear the session cookie
                res.clearCookie(this.config.cookie_name);

                // Remove the session (fire-and-forget)
                if (req.token) {
                    this.authService
                        .removeSessionByToken(req.token)
                        .catch(() => {});
                }

                // Delete temp users (no password + no email). Full cascade —
                // same path as /user-protected/delete-own-user — so we don't
                // orphan fsentries/sessions/permissions.
                if (req.actor?.user && !req.actor.user.email) {
                    const user = await this.userStore.getByUuid(
                        req.actor.user.uuid,
                    );
                    if (user && user.password === null && user.email === null) {
                        this.#cascadeDeleteUser(user.id).catch((e) => {
                            console.warn(
                                '[logout] temp-user cleanup failed:',
                                e,
                            );
                        });
                    }
                }

                res.send('logged out');
            },
        );

        // ── Email confirmation ──────────────────────────────────────

        router.post(
            '/send-confirm-email',
            {
                subdomain: ['api', ''],
                requireUserActor: true,
                rateLimit: {
                    scope: 'send-confirm-email',
                    limit: 10,
                    window: 60 * 60_000,
                    key: 'user',
                },
            },
            async (req, res) => {
                const user = await this.userStore.getById(req.actor.user.id, {
                    force: true,
                });
                if (!user) throw new HttpError(404, 'User not found.');
                if (user.suspended)
                    throw new HttpError(403, 'Account suspended.');
                if (!user.email) throw new HttpError(400, 'No email on file.');

                const code = String(crypto.randomInt(100000, 1000000));
                await this.userStore.update(user.id, {
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
            },
        );

        router.post(
            '/confirm-email',
            {
                subdomain: ['api', ''],
                requireUserActor: true,
                rateLimit: {
                    scope: 'confirm-email',
                    limit: 10,
                    window: 10 * 60_000,
                    key: 'user',
                },
            },
            async (req, res) => {
                const { code, original_client_socket_id } = req.body ?? {};
                if (!code) throw new HttpError(400, 'Missing `code`.');

                const user = await this.userStore.getById(req.actor.user.id, {
                    force: true,
                });
                if (!user) throw new HttpError(404, 'User not found.');
                if (user.email_confirmed) {
                    return res.json({
                        email_confirmed: true,
                        original_client_socket_id,
                    });
                }
                if (String(user.email_confirm_code) !== String(code)) {
                    return res.json({
                        email_confirmed: false,
                        original_client_socket_id,
                    });
                }

                await this.userStore.update(user.id, {
                    email_confirmed: 1,
                    requires_email_confirmation: 0,
                    email_confirm_code: null,
                    email_confirm_token: null,
                });

                await promoteToVerifiedGroup(
                    this.groupStore,
                    this.config,
                    user,
                );

                try {
                    this.clients.event?.emit(
                        'user.email-confirmed',
                        {
                            user_id: user.id,
                            user_uid: user.uuid,
                            email: user.email,
                        },
                        {},
                    );
                } catch {
                    // ignore — event is a side-channel signal, not load-bearing
                }

                res.json({ email_confirmed: true, original_client_socket_id });
            },
        );

        // ── Password recovery ───────────────────────────────────────

        router.post(
            '/send-pass-recovery-email',
            {
                subdomain: ['api', ''],
                rateLimit: {
                    scope: 'send-pass-recovery-email',
                    limit: 10,
                    window: 60 * 60_000,
                },
            },
            async (req, res) => {
                const { username, email } = req.body ?? {};
                if (!username && !email) {
                    throw new HttpError(400, 'username or email is required.');
                }

                const genericMessage =
                    'If that account exists, a password recovery email was sent.';

                let user;
                if (username) {
                    user = await this.userStore.getByUsername(username);
                } else {
                    if (!validator.isEmail(email))
                        throw new HttpError(400, 'Invalid email.');
                    user = await this.userStore.getByEmail(email);
                }

                if (!user || user.suspended || !user.email) {
                    return res.json({ message: genericMessage });
                }

                const pass_recovery_token = uuidv4();
                await this.userStore.update(user.id, { pass_recovery_token });

                const jwt = this.tokenService.sign(
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
                        console.warn(
                            '[send-pass-recovery-email] send failed:',
                            e,
                        );
                    }
                }

                res.json({ message: genericMessage });
            },
        );

        router.post(
            '/verify-pass-recovery-token',
            {
                subdomain: ['api', ''],
                rateLimit: {
                    scope: 'verify-pass-recovery-token',
                    limit: 10,
                    window: 15 * 60_000,
                },
            },
            async (req, res) => {
                const { token } = req.body ?? {};
                if (!token) throw new HttpError(400, 'Missing `token`.');

                let decoded;
                try {
                    decoded = this.tokenService.verify('otp', token);
                } catch {
                    throw new HttpError(400, 'Invalid or expired token.');
                }
                if (decoded.purpose !== 'pass-recovery') {
                    throw new HttpError(400, 'Invalid or expired token.');
                }

                const user = await this.userStore.getByUuid(decoded.user_uid);
                if (!user || user.email !== decoded.email) {
                    throw new HttpError(400, 'Token is no longer valid.');
                }
                if (user.suspended) {
                    throw new HttpError(401, 'This account is suspended.');
                }

                const exp = decoded.exp;
                const time_remaining = exp
                    ? Math.max(0, exp - Math.floor(Date.now() / 1000))
                    : 0;
                res.json({ time_remaining });
            },
        );

        router.post(
            '/set-pass-using-token',
            {
                subdomain: ['api', ''],
                rateLimit: {
                    scope: 'set-pass-using-token',
                    limit: 10,
                    window: 60 * 60_000,
                },
            },
            async (req, res) => {
                const { token, password } = req.body ?? {};
                if (!token || !password) {
                    throw new HttpError(400, 'Missing `token` or `password`.');
                }
                const minLen = this.config.min_pass_length || 6;
                if (password.length < minLen) {
                    throw new HttpError(
                        400,
                        `Password must be at least ${minLen} characters long.`,
                    );
                }

                let decoded;
                try {
                    decoded = this.tokenService.verify('otp', token);
                } catch {
                    throw new HttpError(400, 'Invalid or expired token.');
                }
                if (decoded.purpose !== 'pass-recovery') {
                    throw new HttpError(400, 'Invalid or expired token.');
                }

                const user = await this.userStore.getByUuid(decoded.user_uid);
                if (!user || user.email !== decoded.email) {
                    throw new HttpError(400, 'Token is no longer valid.');
                }
                if (user.suspended) {
                    throw new HttpError(401, 'This account is suspended.');
                }

                // Atomic check: only update if the recovery token still matches
                const password_hash = await bcrypt.hash(password, 8);
                const result = await this.clients.db.write(
                    'UPDATE `user` SET `password` = ?, `pass_recovery_token` = NULL, `change_email_confirm_token` = NULL WHERE `id` = ? AND `pass_recovery_token` = ?',
                    [password_hash, user.id, decoded.token],
                );
                const affected = result?.affectedRows ?? result?.changes ?? 0;
                if (affected === 0) {
                    throw new HttpError(400, 'Token has already been used.');
                }
                await this.userStore.invalidateById(user.id);

                res.send('Password successfully updated.');
            },
        );

        // The `/user-protected/*` gate (session-cookie + password/OIDC
        // revalidation) is applied below. Identity is already proven by
        // the gate, so these handlers receive a pre-refreshed user row on
        // `req.userProtected.user` and don't re-check the old password.
        const userProtectedDeps = {
            config: this.config,
            userStore: this.userStore,
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
                middleware: createUserProtectedGate(userProtectedDeps),
            },
            async (req, res) => {
                const { new_pass } = req.body ?? {};
                if (!new_pass) throw new HttpError(400, 'Missing `new_pass`.');
                const minLen = this.config.min_pass_length || 6;
                if (new_pass.length < minLen) {
                    throw new HttpError(
                        400,
                        `Password must be at least ${minLen} characters long.`,
                    );
                }

                const user = req.userProtected.user;

                const password_hash = await bcrypt.hash(new_pass, 8);
                await this.userStore.update(user.id, {
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
                        console.warn(
                            '[change-password] notification send failed:',
                            e,
                        );
                    }
                }

                res.send('Password successfully updated.');
            },
        );

        // ── Change username ─────────────────────────────────────────

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
                middleware: createUserProtectedGate(userProtectedDeps),
            },
            async (req, res) => {
                const { new_username } = req.body ?? {};
                if (!new_username || typeof new_username !== 'string') {
                    throw new HttpError(400, '`new_username` is required');
                }
                if (!USERNAME_REGEX.test(new_username)) {
                    throw new HttpError(
                        400,
                        'Username can only contain letters, numbers and underscore (_).',
                    );
                }
                if (new_username.length > USERNAME_MAX_LENGTH) {
                    throw new HttpError(
                        400,
                        `Username cannot be longer than ${USERNAME_MAX_LENGTH} characters.`,
                    );
                }
                if (RESERVED_USERNAMES.has(new_username.toLowerCase())) {
                    throw new HttpError(400, 'This username is not available.');
                }
                if (await this.userStore.getByUsername(new_username)) {
                    throw new HttpError(400, 'This username is already taken.');
                }

                await this.userStore.update(req.actor.user.id, {
                    username: new_username,
                });

                // Rename the user's FS home from `/<old>` to `/<new>` and
                // cascade the prefix to all descendants. Without this, any
                // path-based lookup (stat/readdir/write) would 404 after
                // rename because the fsentries still reference `/<old>`.
                try {
                    await this.stores.fsEntry.renameUserHome(
                        req.actor.user.id,
                        new_username,
                    );
                } catch (e) {
                    console.warn('[change-username] fs home rename failed:', e);
                }

                try {
                    this.clients.event?.emit(
                        'user.username-changed',
                        {
                            user_id: req.actor.user.id,
                            old_username: req.actor.user.username,
                            new_username,
                        },
                        {},
                    );
                } catch {
                    // event emission best-effort
                }

                res.json({ username: new_username });
            },
        );

        // ── Change email ────────────────────────────────────────────

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
                middleware: createUserProtectedGate(userProtectedDeps),
            },
            async (req, res) => {
                const { new_email } = req.body ?? {};
                if (!new_email || typeof new_email !== 'string') {
                    throw new HttpError(400, '`new_email` is required');
                }
                if (!validator.isEmail(new_email)) {
                    throw new HttpError(
                        400,
                        'Please enter a valid email address.',
                    );
                }

                // Block if any confirmed account (password or OIDC) already
                // owns that email. Match raw + canonical to collapse gmail
                // aliases.
                const canonical = cleanEmail(new_email);
                const existing =
                    (await this.userStore.getByEmail(new_email)) ??
                    (await this.userStore.getByCleanEmail(canonical));
                if (
                    existing &&
                    (existing.email_confirmed || existing.password !== null)
                ) {
                    throw new HttpError(400, 'This email is already in use.');
                }

                const confirm_token = uuidv4();
                await this.userStore.update(req.actor.user.id, {
                    unconfirmed_change_email: new_email,
                    change_email_confirm_token: confirm_token,
                });

                const linkJwt = this.tokenService.sign(
                    'otp',
                    {
                        token: confirm_token,
                        user_id: req.actor.user.id,
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
                        console.warn(
                            '[change-email] new-address email failed:',
                            e,
                        );
                    }
                    // Notify the old address too
                    const user = await this.userStore.getById(
                        req.actor.user.id,
                        { force: true },
                    );
                    if (user?.email) {
                        try {
                            await this.clients.email.sendRaw({
                                to: user.email,
                                subject:
                                    'Your Puter email change was requested',
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
            },
        );

        router.get(
            '/change_email/confirm',
            {
                subdomain: ['api', ''],
                rateLimit: {
                    scope: 'change-email-confirm',
                    limit: 10,
                    window: 60 * 60_000,
                },
            },
            async (req, res) => {
                const jwtToken = req.query?.token;
                if (!jwtToken || typeof jwtToken !== 'string') {
                    throw new HttpError(400, 'Missing `token`');
                }

                let decoded;
                try {
                    decoded = this.tokenService.verify('otp', jwtToken);
                } catch {
                    throw new HttpError(400, 'Invalid or expired token.');
                }
                if (decoded.purpose !== 'change-email' || !decoded.token) {
                    throw new HttpError(400, 'Invalid or expired token.');
                }

                const rows = await this.clients.db.read(
                    'SELECT * FROM `user` WHERE `change_email_confirm_token` = ? LIMIT 1',
                    [decoded.token],
                );
                const user = rows[0];
                if (!user || !user.unconfirmed_change_email) {
                    throw new HttpError(400, 'Invalid or expired token.');
                }

                const newEmail = user.unconfirmed_change_email;

                // Re-check nobody claimed the new email meanwhile. Match raw +
                // canonical; block if any real account (confirmed OR
                // password-holding) already owns it.
                const canonical = cleanEmail(newEmail);
                const owner =
                    (await this.userStore.getByEmail(newEmail)) ??
                    (await this.userStore.getByCleanEmail(canonical));
                if (
                    owner &&
                    owner.id !== user.id &&
                    (owner.email_confirmed || owner.password !== null)
                ) {
                    throw new HttpError(400, 'This email is already in use.');
                }

                await this.userStore.update(user.id, {
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
                        'user.email-changed',
                        {
                            user_id: user.id,
                            new_email: newEmail,
                        },
                        {},
                    );
                } catch {
                    // best-effort
                }

                res.send(
                    'Email changed successfully. You may close this window.',
                );
            },
        );

        // ── Save account (convert temp user to permanent) ────────────

        router.post(
            '/save_account',
            {
                subdomain: ['api', ''],
                requireUserActor: true,
                captcha: true,
                rateLimit: {
                    scope: 'save-account',
                    limit: 10,
                    window: 60 * 60_000,
                    key: 'user',
                },
            },
            async (req, res) => {
                const { username, email, password } = req.body ?? {};

                const user = await this.userStore.getById(req.actor.user.id, {
                    force: true,
                });
                if (!user) throw new HttpError(404, 'User not found');
                if (user.password !== null || user.email !== null) {
                    throw new HttpError(
                        400,
                        'This is not a temporary account.',
                    );
                }

                // Validation
                if (
                    !username ||
                    typeof username !== 'string' ||
                    !USERNAME_REGEX.test(username)
                ) {
                    throw new HttpError(400, 'Invalid username.');
                }
                if (username.length > USERNAME_MAX_LENGTH) {
                    throw new HttpError(
                        400,
                        `Username cannot be longer than ${USERNAME_MAX_LENGTH} characters.`,
                    );
                }
                if (RESERVED_USERNAMES.has(username.toLowerCase())) {
                    throw new HttpError(400, 'This username is not available.');
                }
                if (!email || !validator.isEmail(email)) {
                    throw new HttpError(
                        400,
                        'Please enter a valid email address.',
                    );
                }
                if (!password || typeof password !== 'string') {
                    throw new HttpError(400, 'Password is required.');
                }
                const minLen = this.config.min_pass_length || 6;
                if (password.length < minLen) {
                    throw new HttpError(
                        400,
                        `Password must be at least ${minLen} characters long.`,
                    );
                }

                // Duplicate checks
                const existingUsername =
                    await this.userStore.getByUsername(username);
                if (existingUsername && existingUsername.id !== user.id) {
                    throw new HttpError(400, 'This username is already taken.');
                }
                // Match raw + canonical to catch gmail-alias collisions, and
                // reject on ANY confirmed account (OIDC accounts have
                // password=null but are real) — not just password-holders.
                const canonical = cleanEmail(email);
                const existingEmail =
                    (await this.userStore.getByEmail(email)) ??
                    (await this.userStore.getByCleanEmail(canonical));
                if (
                    existingEmail &&
                    existingEmail.id !== user.id &&
                    (existingEmail.email_confirmed ||
                        existingEmail.password !== null)
                ) {
                    throw new HttpError(400, 'This email is already in use.');
                }

                // Promote: set username/email/password on the existing row
                const password_hash = await bcrypt.hash(password, 8);
                const email_confirm_code = String(
                    crypto.randomInt(100000, 1000000),
                );
                const email_confirm_token = uuidv4();

                await this.userStore.update(user.id, {
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
                        await this.stores.fsEntry.renameUserHome(
                            user.id,
                            username,
                        );
                    } catch (e) {
                        console.warn(
                            '[save-account] fs home rename failed:',
                            e,
                        );
                    }
                }

                // Move from temp group to user group
                if (this.config.default_temp_group) {
                    try {
                        await this.groupStore.removeUsers(
                            this.config.default_temp_group,
                            [user.username],
                        );
                    } catch {
                        // Best-effort
                    }
                }
                if (this.config.default_user_group) {
                    try {
                        await this.groupStore.addUsers(
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
                            {
                                code: email_confirm_code,
                            },
                        );
                    } catch (e) {
                        console.warn(
                            '[save-account] confirmation email failed:',
                            e,
                        );
                    }
                }

                try {
                    this.clients.event?.emit(
                        'user.save_account',
                        {
                            user_id: user.id,
                            old_username: user.username,
                            new_username: username,
                            email,
                        },
                        {},
                    );
                } catch {
                    // best-effort
                }

                const updatedUser = await this.userStore.getById(user.id, {
                    force: true,
                });
                res.json({
                    user: {
                        username: updatedUser.username,
                        uuid: updatedUser.uuid,
                        email: updatedUser.email,
                        email_confirmed: updatedUser.email_confirmed,
                        requires_email_confirmation:
                            updatedUser.requires_email_confirmation,
                        is_temp: false,
                    },
                });
            },
        );

        // ── Captcha generation ───────────────────────────────────────

        router.get(
            '/api/captcha/generate',
            { subdomain: '*' },
            async (_req, res) => {
                const difficulty = this.config.captcha?.difficulty || 'medium';
                const { token, image } = await generateCaptcha(difficulty);
                res.json({ token, image });
            },
        );

        // ── Anti-CSRF token generation ──────────────────────────────

        router.get(
            '/get-anticsrf-token',
            { subdomain: '', requireAuth: true },
            async (req, res) => {
                const sessionId = req.actor?.user?.uuid;
                if (!sessionId)
                    throw new HttpError(401, 'Authentication required.');
                const token = await antiCsrf.createToken(sessionId);
                res.json({ token });
            },
        );

        // ── Permission grants ───────────────────────────────────────

        router.post(
            '/auth/grant-user-user',
            { subdomain: 'api', requireUserActor: true },
            async (req, res) => {
                const { target_username, permission, extra, meta } = req.body;
                if (!target_username || !permission) {
                    throw new HttpError(
                        400,
                        'Missing `target_username` or `permission`',
                    );
                }
                await this.permissionService.grantUserUserPermission(
                    req.actor,
                    target_username,
                    permission,
                    extra,
                    meta,
                );
                res.json({});
            },
        );

        router.post(
            '/auth/grant-user-app',
            { subdomain: 'api', requireUserActor: true },
            async (req, res) => {
                const { app_uid, permission, extra, meta } = req.body;
                if (!app_uid || !permission) {
                    throw new HttpError(
                        400,
                        'Missing `app_uid` or `permission`',
                    );
                }
                await this.permissionService.grantUserAppPermission(
                    req.actor,
                    app_uid,
                    permission,
                    extra,
                    meta,
                );
                res.json({});
            },
        );

        router.post(
            '/auth/grant-user-group',
            { subdomain: 'api', requireUserActor: true },
            async (req, res) => {
                const { group_uid, permission, extra, meta } = req.body;
                if (!group_uid || !permission) {
                    throw new HttpError(
                        400,
                        'Missing `group_uid` or `permission`',
                    );
                }
                const group = await this.groupStore.getByUid(group_uid);
                if (!group) throw new HttpError(404, 'Group not found');
                await this.permissionService.grantUserGroupPermission(
                    req.actor,
                    group,
                    permission,
                    extra,
                    meta,
                );
                res.json({});
            },
        );

        // ── Permission revokes ──────────────────────────────────────

        router.post(
            '/auth/revoke-user-user',
            { subdomain: 'api', requireUserActor: true },
            async (req, res) => {
                const { target_username, permission, meta } = req.body;
                if (!target_username || !permission) {
                    throw new HttpError(
                        400,
                        'Missing `target_username` or `permission`',
                    );
                }
                await this.permissionService.revokeUserUserPermission(
                    req.actor,
                    target_username,
                    permission,
                    meta,
                );
                res.json({});
            },
        );

        router.post(
            '/auth/revoke-user-app',
            { subdomain: 'api', requireUserActor: true },
            async (req, res) => {
                const { app_uid, permission, meta } = req.body;
                if (!app_uid || !permission) {
                    throw new HttpError(
                        400,
                        'Missing `app_uid` or `permission`',
                    );
                }
                if (permission === '*') {
                    await this.permissionService.revokeUserAppAll(
                        req.actor,
                        app_uid,
                        meta,
                    );
                } else {
                    await this.permissionService.revokeUserAppPermission(
                        req.actor,
                        app_uid,
                        permission,
                        meta,
                    );
                }
                res.json({});
            },
        );

        router.post(
            '/auth/revoke-user-group',
            { subdomain: 'api', requireUserActor: true },
            async (req, res) => {
                const { group_uid, permission, meta } = req.body;
                if (!group_uid || !permission) {
                    throw new HttpError(
                        400,
                        'Missing `group_uid` or `permission`',
                    );
                }
                await this.permissionService.revokeUserGroupPermission(
                    req.actor,
                    { uid: group_uid },
                    permission,
                    meta,
                );
                res.json({});
            },
        );

        // ── Permission checks ───────────────────────────────────────

        router.post(
            '/auth/check-permissions',
            { subdomain: 'api', requireAuth: true },
            async (req, res) => {
                const { permissions } = req.body;
                if (!Array.isArray(permissions)) {
                    throw new HttpError(
                        400,
                        'Missing or invalid `permissions` array',
                    );
                }

                const unique = [...new Set(permissions)];
                const result = {};
                for (const perm of unique) {
                    try {
                        result[perm] = await this.permissionService.check(
                            req.actor,
                            perm,
                        );
                    } catch {
                        result[perm] = false;
                    }
                }
                res.json({ permissions: result });
            },
        );

        // ── Session management ──────────────────────────────────────

        router.get(
            '/auth/list-sessions',
            { subdomain: 'api', requireUserActor: true },
            async (req, res) => {
                const sessions = await this.authService.listSessions(req.actor);
                res.json(sessions);
            },
        );

        router.post(
            '/auth/revoke-session',
            { subdomain: 'api', requireUserActor: true, antiCsrf: true },
            async (req, res) => {
                const { uuid } = req.body;
                if (!uuid || typeof uuid !== 'string') {
                    throw new HttpError(400, 'Missing or invalid `uuid`');
                }
                await this.authService.revokeSession(uuid);
                const sessions = await this.authService.listSessions(req.actor);
                res.json({ sessions });
            },
        );

        // ── Dev app permissions ──────────────────────────────────────

        router.post(
            '/auth/grant-dev-app',
            { subdomain: 'api', requireUserActor: true },
            async (req, res) => {
                let { app_uid, origin, permission, extra, meta } = req.body;
                if (origin && !app_uid) {
                    app_uid = await this.authService.appUidFromOrigin(origin);
                }
                if (!app_uid || !permission) {
                    throw new HttpError(
                        400,
                        'Missing `app_uid` or `permission`',
                    );
                }
                await this.permissionService.grantDevAppPermission(
                    req.actor,
                    app_uid,
                    permission,
                    extra,
                    meta,
                );
                res.json({});
            },
        );

        router.post(
            '/auth/revoke-dev-app',
            { subdomain: 'api', requireUserActor: true },
            async (req, res) => {
                let { app_uid, origin, permission, meta } = req.body;
                if (origin && !app_uid) {
                    app_uid = await this.authService.appUidFromOrigin(origin);
                }
                if (!app_uid || !permission) {
                    throw new HttpError(
                        400,
                        'Missing `app_uid` or `permission`',
                    );
                }
                if (permission === '*') {
                    await this.permissionService.revokeDevAppAll(
                        req.actor,
                        app_uid,
                        meta,
                    );
                }
                await this.permissionService.revokeDevAppPermission(
                    req.actor,
                    app_uid,
                    permission,
                    meta,
                );
                res.json({});
            },
        );

        // ── Permission listing ──────────────────────────────────────

        router.get(
            '/auth/list-permissions',
            { subdomain: 'api', requireUserActor: true },
            async (req, res) => {
                const userId = req.actor.user.id;
                const db = this.clients.db;

                const [appPerms, userPermsOut, userPermsIn] = await Promise.all(
                    [
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
                    ],
                );

                res.json({
                    myself_to_app: appPerms.map((r) => ({
                        app_uid: r.app_uid,
                        permission: r.permission,
                        extra:
                            typeof r.extra === 'string'
                                ? JSON.parse(r.extra)
                                : (r.extra ?? {}),
                    })),
                    myself_to_user: userPermsOut.map((r) => ({
                        user: r.username,
                        permission: r.permission,
                        extra:
                            typeof r.extra === 'string'
                                ? JSON.parse(r.extra)
                                : (r.extra ?? {}),
                    })),
                    user_to_myself: userPermsIn.map((r) => ({
                        user: r.username,
                        permission: r.permission,
                        extra:
                            typeof r.extra === 'string'
                                ? JSON.parse(r.extra)
                                : (r.extra ?? {}),
                    })),
                });
            },
        );

        // ── App origin resolution ───────────────────────────────────

        router.post(
            '/auth/app-uid-from-origin',
            { subdomain: 'api', requireAuth: true },
            async (req, res) => {
                const origin = req.body?.origin || req.query?.origin;
                if (!origin) throw new HttpError(400, 'Missing `origin`');
                const uid = await this.authService.appUidFromOrigin(origin);
                res.json({ uid });
            },
        );

        // ── App token + check ───────────────────────────────────────

        router.post(
            '/auth/get-user-app-token',
            { subdomain: 'api', requireUserActor: true },
            async (req, res) => {
                let { app_uid, origin } = req.body;
                if (!app_uid && origin) {
                    app_uid = await this.authService.appUidFromOrigin(origin);
                }
                if (!app_uid)
                    throw new HttpError(400, 'Missing `app_uid` or `origin`');

                const token = this.authService.getUserAppToken(
                    req.actor,
                    app_uid,
                );

                // Grant the app-is-authenticated flag
                await this.permissionService.grantUserAppPermission(
                    req.actor,
                    app_uid,
                    'flag:app-is-authenticated',
                    {},
                    {},
                );

                res.json({ token, app_uid });
            },
        );

        router.post(
            '/auth/check-app',
            { subdomain: 'api', requireUserActor: true },
            async (req, res) => {
                let { app_uid, origin } = req.body;
                if (!app_uid && origin) {
                    app_uid = await this.authService.appUidFromOrigin(origin);
                }
                if (!app_uid)
                    throw new HttpError(400, 'Missing `app_uid` or `origin`');

                // Check if the app is authenticated for this user
                const authenticated = await this.permissionService
                    .check(
                        req.actor,
                        `service:${app_uid}:ii:flag:app-is-authenticated`,
                    )
                    .catch(() => false);

                const result = { app_uid, authenticated };
                if (authenticated) {
                    result.token = this.authService.getUserAppToken(
                        req.actor,
                        app_uid,
                    );
                }
                res.json(result);
            },
        );

        // ── Access tokens ───────────────────────────────────────────

        router.post(
            '/auth/create-access-token',
            { subdomain: 'api', requireAuth: true },
            async (req, res) => {
                const { permissions, expiresIn } = req.body;
                if (!Array.isArray(permissions) || permissions.length === 0) {
                    throw new HttpError(
                        400,
                        'Missing or empty `permissions` array',
                    );
                }

                // Normalize specs: string → [string], [string] → [string, {}], [string, extra] → as-is
                const normalized = permissions.map((spec) => {
                    if (typeof spec === 'string') return [spec];
                    if (Array.isArray(spec)) return spec;
                    throw new HttpError(
                        400,
                        'Each permission must be a string or [string, extra?]',
                    );
                });

                const token = await this.authService.createAccessToken(
                    req.actor,
                    normalized,
                    expiresIn ? { expiresIn } : {},
                );
                res.json({ token });
            },
        );

        router.post(
            '/auth/revoke-access-token',
            { subdomain: 'api', requireAuth: true },
            async (req, res) => {
                let { tokenOrUuid } = req.body;
                if (!tokenOrUuid || typeof tokenOrUuid !== 'string') {
                    throw new HttpError(400, 'Missing `tokenOrUuid`');
                }
                // Extract JWT from /token-read URLs if needed
                if (tokenOrUuid.includes('/token-read')) {
                    const match = tokenOrUuid.match(/\/token-read\/([^\s/?]+)/);
                    if (match) tokenOrUuid = match[1];
                }
                await this.authService.revokeAccessToken(tokenOrUuid);
                res.json({ ok: true });
            },
        );

        // ── 2FA: configure ─────────────────────────────────────────────

        router.post(
            '/auth/configure-2fa/:action',
            {
                subdomain: 'api',
                requireUserActor: true,
            },
            async (req, res) => {
                const action = req.params.action;
                const user = await this.userStore.getById(req.actor.user.id, {
                    force: true,
                });
                if (!user) throw new HttpError(404, 'User not found');

                if (action === 'setup') {
                    if (user.otp_enabled) {
                        throw new HttpError(409, '2FA is already enabled.');
                    }

                    const result = otpCreateSecret(user.username);

                    // Generate 10 recovery codes
                    const codes = [];
                    for (let i = 0; i < 10; i++) {
                        codes.push(createRecoveryCode());
                    }
                    const hashedCodes = codes.map((c) => hashRecoveryCode(c));

                    await this.clients.db.write(
                        'UPDATE `user` SET `otp_secret` = ?, `otp_recovery_codes` = ? WHERE `uuid` = ?',
                        [result.secret, hashedCodes.join(','), user.uuid],
                    );
                    await this.userStore.invalidateById(user.id);

                    return res.json({
                        url: result.url,
                        secret: result.secret,
                        codes,
                    });
                }

                if (action === 'test') {
                    const { code } = req.body ?? {};
                    if (!code) throw new HttpError(400, 'Missing `code`');
                    const ok = verifyOtp(user.username, user.otp_secret, code);
                    return res.json({ ok });
                }

                if (action === 'enable') {
                    if (!user.email_confirmed) {
                        throw new HttpError(
                            403,
                            'Email must be confirmed before enabling 2FA.',
                        );
                    }
                    if (user.otp_enabled) {
                        throw new HttpError(409, '2FA is already enabled.');
                    }
                    if (!user.otp_secret) {
                        throw new HttpError(
                            409,
                            '2FA has not been configured. Call setup first.',
                        );
                    }

                    await this.clients.db.write(
                        'UPDATE `user` SET `otp_enabled` = 1 WHERE `uuid` = ?',
                        [user.uuid],
                    );
                    await this.userStore.invalidateById(user.id);

                    if (this.clients.email && user.email) {
                        try {
                            await this.clients.email.send(
                                user.email,
                                'enabled_2fa',
                                {
                                    username: user.username,
                                },
                            );
                        } catch (e) {
                            console.warn(
                                '[configure-2fa] email send failed:',
                                e,
                            );
                        }
                    }

                    return res.json({});
                }

                throw new HttpError(400, `Invalid action: ${action}`);
            },
        );

        // ── 2FA: disable ───────────────────────────────────────────────

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
                middleware: createUserProtectedGate(userProtectedDeps),
            },
            async (req, res) => {
                const user = await this.userStore.getById(req.actor.user.id, {
                    force: true,
                });
                if (!user) throw new HttpError(404, 'User not found');

                await this.clients.db.write(
                    'UPDATE `user` SET `otp_enabled` = 0, `otp_recovery_codes` = NULL, `otp_secret` = NULL WHERE `uuid` = ?',
                    [user.uuid],
                );
                await this.userStore.invalidateById(user.id);

                if (this.clients.email && user.email) {
                    try {
                        await this.clients.email.send(
                            user.email,
                            'disabled_2fa',
                            {
                                username: user.username,
                            },
                        );
                    } catch (e) {
                        console.warn('[disable-2fa] email send failed:', e);
                    }
                }

                res.json({ success: true });
            },
        );

        // ── Developer profile ──────────────────────────────────────────

        router.get(
            '/get-dev-profile',
            {
                subdomain: 'api',
                requireUserActor: true,
            },
            async (req, res) => {
                const user = await this.userStore.getById(req.actor.user.id, {
                    force: true,
                });
                if (!user) throw new HttpError(404, 'User not found');

                res.json({
                    first_name: user.first_name ?? null,
                    last_name: user.last_name ?? null,
                    approved_for_incentive_program: Boolean(
                        user.approved_for_incentive_program,
                    ),
                    joined_incentive_program: Boolean(
                        user.joined_incentive_program,
                    ),
                    paypal: user.paypal ?? null,
                });
            },
        );

        // ── Group management ───────────────────────────────────────────

        router.post(
            '/group/create',
            { subdomain: 'api', requireUserActor: true },
            async (req, res) => {
                const extra = req.body.extra ?? {};
                const metadata = req.body.metadata ?? {};
                if (typeof extra !== 'object' || Array.isArray(extra))
                    throw new HttpError(400, '`extra` must be an object');
                if (typeof metadata !== 'object' || Array.isArray(metadata))
                    throw new HttpError(400, '`metadata` must be an object');

                const uid = await this.groupStore.create({
                    ownerUserId: req.actor.user.id,
                    extra: {},
                    metadata,
                });
                res.json({ uid });
            },
        );

        router.post(
            '/group/add-users',
            { subdomain: 'api', requireUserActor: true },
            async (req, res) => {
                const { uid, users } = req.body ?? {};
                if (!uid) throw new HttpError(400, 'Missing `uid`');
                if (!Array.isArray(users))
                    throw new HttpError(400, '`users` must be an array');

                const group = await this.groupStore.getByUid(uid);
                if (!group) throw new HttpError(404, 'Group not found');
                if (group.owner_user_id !== req.actor.user.id)
                    throw new HttpError(403, 'Forbidden');

                await this.groupStore.addUsers(uid, users);
                res.json({});
            },
        );

        router.post(
            '/group/remove-users',
            { subdomain: 'api', requireUserActor: true },
            async (req, res) => {
                const { uid, users } = req.body ?? {};
                if (!uid) throw new HttpError(400, 'Missing `uid`');
                if (!Array.isArray(users))
                    throw new HttpError(400, '`users` must be an array');

                const group = await this.groupStore.getByUid(uid);
                if (!group) throw new HttpError(404, 'Group not found');
                if (group.owner_user_id !== req.actor.user.id)
                    throw new HttpError(403, 'Forbidden');

                await this.groupStore.removeUsers(uid, users);
                res.json({});
            },
        );

        router.get(
            '/group/list',
            { subdomain: 'api', requireUserActor: true },
            async (req, res) => {
                const userId = req.actor.user.id;
                const [owned, member] = await Promise.all([
                    this.groupStore.listByOwner(userId),
                    this.groupStore.listByMember(userId),
                ]);
                res.json({
                    owned_groups: owned,
                    in_groups: member,
                });
            },
        );

        router.get(
            '/group/public-groups',
            { subdomain: 'api' },
            async (_req, res) => {
                res.json({
                    user: this.config.default_user_group ?? null,
                    temp: this.config.default_temp_group ?? null,
                });
            },
        );

        // ── Session helpers ────────────────────────────────────────────

        router.get(
            '/get-gui-token',
            { subdomain: ['api', ''], requireUserActor: true },
            async (req, res) => {
                if (!req.actor?.session?.uid)
                    throw new HttpError(400, 'No session bound to this actor');
                const user = await this.userStore.getById(req.actor.user.id);
                if (!user) throw new HttpError(404, 'User not found');
                const guiToken = this.authService.createGuiToken(
                    user,
                    req.actor.session.uid,
                );
                res.json({ token: guiToken });
            },
        );

        router.get(
            '/session/sync-cookie',
            { subdomain: ['api', ''], requireUserActor: true },
            async (req, res) => {
                if (!req.actor?.session?.uid) {
                    res.status(400).end();
                    return;
                }
                const user = await this.userStore.getById(req.actor.user.id);
                if (!user) {
                    res.status(404).end();
                    return;
                }
                const sessionToken =
                    this.authService.createSessionTokenForSession(
                        user,
                        req.actor.session.uid,
                    );
                res.cookie(this.config.cookie_name, sessionToken, {
                    sameSite: 'none',
                    secure: true,
                    httpOnly: true,
                });
                res.status(204).end();
            },
        );

        // ── ACL direct ─────────────────────────────────────────────────

        router.post(
            '/acl/stat-user-user',
            { subdomain: 'api', requireUserActor: true },
            async (req, res) => {
                const targetUsername = req.body?.user;
                const resource = req.body?.resource;
                if (!targetUsername) throw new HttpError(400, 'Missing `user`');
                if (!resource) throw new HttpError(400, 'Missing `resource`');

                const targetUser =
                    await this.userStore.getByUsername(targetUsername);
                if (!targetUser) throw new HttpError(404, 'User not found');

                const targetActor = {
                    user: {
                        id: targetUser.id,
                        uuid: targetUser.uuid,
                        username: targetUser.username,
                    },
                };
                const readPerm = await this.permissionService
                    .check(targetActor, `fs:${resource}:read`)
                    .catch(() => false);
                const writePerm = await this.permissionService
                    .check(targetActor, `fs:${resource}:write`)
                    .catch(() => false);

                res.json({ permissions: { read: readPerm, write: writePerm } });
            },
        );

        router.post(
            '/acl/set-user-user',
            { subdomain: 'api', requireUserActor: true },
            async (req, res) => {
                const { user: targetUsername, resource, mode } = req.body ?? {};
                if (!targetUsername || !resource || !mode)
                    throw new HttpError(
                        400,
                        'Missing `user`, `resource`, or `mode`',
                    );

                const targetUser =
                    await this.userStore.getByUsername(targetUsername);
                if (!targetUser) throw new HttpError(404, 'User not found');

                if (mode === 'write') {
                    await this.permissionService.grantUserUserPermission(
                        req.actor,
                        targetUsername,
                        `fs:${resource}:read`,
                        {},
                    );
                    await this.permissionService.grantUserUserPermission(
                        req.actor,
                        targetUsername,
                        `fs:${resource}:write`,
                        {},
                    );
                } else if (mode === 'read') {
                    await this.permissionService.grantUserUserPermission(
                        req.actor,
                        targetUsername,
                        `fs:${resource}:read`,
                        {},
                    );
                    await this.permissionService.revokeUserUserPermission(
                        req.actor,
                        targetUsername,
                        `fs:${resource}:write`,
                    );
                } else if (mode === 'none') {
                    await this.permissionService.revokeUserUserPermission(
                        req.actor,
                        targetUsername,
                        `fs:${resource}:read`,
                    );
                    await this.permissionService.revokeUserUserPermission(
                        req.actor,
                        targetUsername,
                        `fs:${resource}:write`,
                    );
                } else {
                    throw new HttpError(
                        400,
                        'Invalid `mode` — expected read, write, or none',
                    );
                }
                res.json({});
            },
        );

        // ── Delete own account ─────────────────────────────────────────
        //
        // Purge S3 objects + fsentries first, then the user row. FK
        // cascades on most related tables are `ON DELETE SET NULL` (not
        // CASCADE), so anything holding tightly to user_id (sessions) we
        // clear explicitly to avoid orphan rows.

        router.post(
            '/user-protected/delete-own-user',
            {
                subdomain: ['api', ''],
                requireUserActor: true,
                middleware: createUserProtectedGate(userProtectedDeps, {
                    allowTempUsers: true,
                }),
            },
            async (req, res) => {
                const userId = req.actor.user.id;
                res.clearCookie(this.config.cookie_name);
                res.clearCookie('puter_revalidation');
                await this.#cascadeDeleteUser(userId);
                res.json({ success: true });
            },
        );
    }

    async #cascadeDeleteUser(userId) {
        try {
            await this.services.fsEntry.removeAllForUser(userId);
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
        await this.userStore.invalidateById(userId);
    }

    // ── Helpers ──────────────────────────────────────────────────────

    async #generateRandomUsername() {
        let username;
        let attempts = 0;
        do {
            username = generate_identifier();
            attempts++;
            if (attempts > 20)
                throw new Error('Failed to generate unique username');
        } while (await this.userStore.getByUsername(username));
        return username;
    }

    async #completeLogin(req, res, user) {
        const meta = {
            ip: req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress,
            user_agent: req.headers?.['user-agent'],
            origin: req.headers?.origin,
            host: req.headers?.host,
        };

        const { token: sessionToken, gui_token } =
            await this.authService.createSessionToken(user, meta);

        // HTTP-only cookie gets the session token
        res.cookie(this.config.cookie_name, sessionToken, {
            sameSite: 'none',
            secure: true,
            httpOnly: true,
        });

        // Resolve taskbar items up-front so the GUI doesn't need a second
        // round-trip on first paint. Best-effort: a failure here shouldn't
        // block login (the client can still fetch them via /whoami later).
        let taskbar_items = [];
        try {
            taskbar_items = await getTaskbarItems(user, {
                clients: this.clients,
                stores: this.stores,
                services: this.services,
                apiBaseUrl: this.config.api_base_url,
            });
        } catch (e) {
            console.warn('[auth] taskbar_items resolution failed:', e);
        }

        // Response body gets the GUI token (client never sees session token)
        return res.json({
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

    onServerStart() {}
    onServerPrepareShutdown() {}
    onServerShutdown() {}
}
