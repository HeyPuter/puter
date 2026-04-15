import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import validator from 'validator';
import { HttpError } from '../../core/http/HttpError.js';
import { antiCsrf } from '../../core/http/middleware/antiCsrf.js';
import { generateCaptcha } from '../../core/http/middleware/captcha.js';
import { hashRecoveryCode, verify as verifyOtp } from '../../services/auth/OTPUtil.js';
import { generateReferralCode } from '../../services/auth/referralCode.js';
import { generate_identifier } from '../../util/identifier.js';

const USERNAME_REGEX = /^\w{1,}$/;
const USERNAME_MAX_LENGTH = 45;
const RESERVED_USERNAMES = new Set([
    'admin', 'administrator', 'root', 'system', 'puter', 'www', 'api',
    'support', 'help', 'info', 'contact', 'mail', 'email', 'null',
    'undefined', 'test', 'guest', 'anonymous', 'user', 'users',
]);

/**
 * Auth controller — login/logout, permission grants/revokes, session
 * management, OTP, and permission checks.
 *
 * Uses imperative route registration (no decorators) so it stays JS.
 */
export class AuthController {
    constructor (config, clients, stores, services) {
        this.config = config;
        this.clients = clients;
        this.stores = stores;
        this.services = services;
    }

    get permissionService () {
        return this.services.permission;
    }
    get authService () {
        return this.services.auth;
    }
    get tokenService () {
        return this.services.token;
    }
    get userStore () {
        return this.stores.user;
    }
    get groupStore () {
        return this.stores.group;
    }

    registerRoutes (router) {

        // ── Login ───────────────────────────────────────────────────

        router.post('/login', {
            subdomain: ['api', ''],
            captcha: true,
            rateLimit: { scope: 'login', limit: 10, window: 15 * 60_000 },
        }, async (req, res) => {
            const { username, email, password } = req.body;

            if ( !username && !email ) {
                throw new HttpError(400, 'Username or email is required.');
            }
            if ( !password || typeof password !== 'string' ) {
                throw new HttpError(400, 'Password is required.');
            }
            if ( password.length < (this.config.min_pass_length || 6) ) {
                throw new HttpError(400, 'Invalid password.');
            }

            // Look up user
            let user;
            if ( username ) {
                if ( typeof username !== 'string' ) throw new HttpError(400, 'username must be a string.');
                user = await this.userStore.getByUsername(username);
            } else {
                user = await this.userStore.getByEmail(email);
            }

            if ( ! user ) {
                throw new HttpError(400, username ? 'Username not found.' : 'Email not found.');
            }
            if ( user.username === 'system' && !this.config.allow_system_login ) {
                throw new HttpError(400, username ? 'Username not found.' : 'Email not found.');
            }
            if ( user.suspended ) {
                throw new HttpError(401, 'This account is suspended.');
            }
            if ( user.password === null ) {
                throw new HttpError(400, 'Incorrect password.');
            }

            // Verify password
            const passwordMatch = await bcrypt.compare(password, user.password);
            if ( ! passwordMatch ) {
                throw new HttpError(400, 'Incorrect password.');
            }

            // OTP branching — if 2FA enabled, return a short-lived OTP JWT
            if ( user.otp_enabled ) {
                const otp_jwt_token = this.tokenService.sign('otp', {
                    user_uid: user.uuid,
                }, { expiresIn: '5m' });

                return res.status(202).json({
                    proceed: true,
                    next_step: 'otp',
                    otp_jwt_token,
                });
            }

            return this.#completeLogin(req, res, user);
        });

        // ── Login: OTP verification ─────────────────────────────────

        router.post('/login/otp', {
            subdomain: ['api', ''],
            captcha: true,
            rateLimit: { scope: 'login-otp', limit: 15, window: 30 * 60_000 },
        }, async (req, res) => {
            const { token, code } = req.body;
            if ( ! token ) throw new HttpError(400, 'token is required.');
            if ( ! code ) throw new HttpError(400, 'code is required.');

            let decoded;
            try {
                decoded = this.tokenService.verify('otp', token);
            }
            catch {
                throw new HttpError(400, 'Invalid token.');
            }
            if ( ! decoded.user_uid ) throw new HttpError(400, 'Invalid token.');

            const user = await this.userStore.getByUuid(decoded.user_uid);
            if ( ! user ) throw new HttpError(400, 'User not found.');

            if ( ! verifyOtp(user.username, user.otp_secret, code) ) {
                return res.json({ proceed: false });
            }

            return this.#completeLogin(req, res, user);
        });

        // ── Login: recovery code ────────────────────────────────────

        router.post('/login/recovery-code', {
            subdomain: ['api', ''],
            captcha: true,
            rateLimit: { scope: 'login-recovery', limit: 10, window: 60 * 60_000 },
        }, async (req, res) => {
            const { token, code } = req.body;
            if ( ! token ) throw new HttpError(400, 'token is required.');
            if ( ! code ) throw new HttpError(400, 'code is required.');

            let decoded;
            try {
                decoded = this.tokenService.verify('otp', token);
            }
            catch {
                throw new HttpError(400, 'Invalid token.');
            }
            if ( ! decoded.user_uid ) throw new HttpError(400, 'Invalid token.');

            const user = await this.userStore.getByUuid(decoded.user_uid);
            if ( ! user ) throw new HttpError(400, 'User not found.');

            const hashed = hashRecoveryCode(code);
            const codes = (user.otp_recovery_codes || '').split(',').filter(Boolean);
            const idx = codes.indexOf(hashed);
            if ( idx === -1 ) {
                return res.json({ proceed: false });
            }

            // Consume the recovery code
            codes.splice(idx, 1);
            await this.clients.db.write(
                'UPDATE `user` SET `otp_recovery_codes` = ? WHERE `uuid` = ?',
                [codes.join(','), user.uuid],
            );

            return this.#completeLogin(req, res, user);
        });

        // ── Signup ──────────────────────────────────────────────────

        router.post('/signup', {
            subdomain: ['api', ''],
            captcha: true,
            rateLimit: { scope: 'signup', limit: 10, window: 15 * 60_000 },
        }, async (req, res) => {
            const body = req.body ?? {};
            const is_temp = Boolean(body.is_temp);

            // Bot honeypot — only applies to non-temp signups
            if ( !is_temp && body.p102xyzname !== '' && body.p102xyzname !== undefined ) {
                return res.json({});
            }

            // Fill in temp user defaults
            if ( is_temp ) {
                body.username ??= await this.#generateRandomUsername();
                body.email ??= `${body.username}@gmail.com`;
                body.password ??= uuidv4();
            }

            // Validation
            if ( ! body.username ) throw new HttpError(400, 'Username is required');
            if ( typeof body.username !== 'string' ) throw new HttpError(400, 'username must be a string.');
            if ( ! USERNAME_REGEX.test(body.username) ) {
                throw new HttpError(400, 'Username can only contain letters, numbers and underscore (_).');
            }
            if ( body.username.length > USERNAME_MAX_LENGTH ) {
                throw new HttpError(400, `Username cannot be longer than ${USERNAME_MAX_LENGTH} characters.`);
            }
            if ( RESERVED_USERNAMES.has(body.username.toLowerCase()) ) {
                throw new HttpError(400, 'This username is not available.');
            }
            if ( ! is_temp ) {
                if ( ! body.email ) throw new HttpError(400, 'Email is required');
                if ( typeof body.email !== 'string' ) throw new HttpError(400, 'email must be a string.');
                if ( ! validator.isEmail(body.email) ) throw new HttpError(400, 'Please enter a valid email address.');
                if ( ! body.password ) throw new HttpError(400, 'Password is required');
                if ( typeof body.password !== 'string' ) throw new HttpError(400, 'password must be a string.');
                const minLen = this.config.min_pass_length || 6;
                if ( body.password.length < minLen ) {
                    throw new HttpError(400, `Password must be at least ${minLen} characters long.`);
                }
            }

            // Duplicate username check
            if ( await this.userStore.getByUsername(body.username) ) {
                throw new HttpError(400, 'This username already exists in our database. Please use another one.');
            }

            // Referral code lookup — fail early if invalid
            let referred_by_user_id = null;
            if ( body.referral_code ) {
                const referrer = await this.userStore.getByReferralCode(body.referral_code);
                if ( ! referrer ) throw new HttpError(400, 'Referral code not found');
                referred_by_user_id = referrer.id;
            }

            // Duplicate confirmed-email check. A confirmed account with a
            // password on this email already exists — reject.
            //
            // A pseudo-user (email present, password null) is NOT a block —
            // the signup claims that account: the INSERT becomes an UPDATE
            // on the pseudo row.
            let pseudo_user = null;
            if ( ! is_temp ) {
                const existing = await this.userStore.getByEmail(body.email);
                if ( existing ) {
                    if ( existing.email_confirmed && existing.password ) {
                        throw new HttpError(400, 'This email already exists in our database. Please use another one.');
                    }
                    if ( existing.password === null ) {
                        pseudo_user = existing;
                    }
                }
            }

            // Prepare shared fields
            const user_uuid = uuidv4();
            const email_confirm_code = String(Math.floor(100000 + Math.random() * 900000));
            const email_confirm_token = uuidv4();
            const password_hash = is_temp ? null : await bcrypt.hash(body.password, 8);

            let user;
            if ( pseudo_user ) {
                // ── Pseudo-user claim (convert the placeholder row) ──
                await this.userStore.update(pseudo_user.id, {
                    username: body.username,
                    password: password_hash,
                    uuid: user_uuid,
                    email_confirm_code,
                    email_confirm_token,
                    email_confirmed: 0,
                    requires_email_confirmation: 1,
                    referred_by: referred_by_user_id,
                });

                // Move from temp group to regular user group
                if ( this.config.default_temp_group ) {
                    try {
                        await this.groupStore.removeUsers(this.config.default_temp_group, [body.username]);
                    } catch {
                        // Best-effort — missing membership shouldn't block signup
                    }
                }
                if ( this.config.default_user_group ) {
                    try {
                        await this.groupStore.addUsers(this.config.default_user_group, [body.username]);
                    } catch (e) {
                        console.warn('[signup] group assignment failed:', e);
                    }
                }

                user = await this.userStore.getById(pseudo_user.id, { force: true });
            } else {
                // ── New user ────────────────────────────────────────
                user = await this.userStore.create({
                    username: body.username,
                    uuid: user_uuid,
                    password: password_hash,
                    email: is_temp ? null : body.email,
                    clean_email: is_temp ? null : body.email.toLowerCase(),
                    free_storage: this.config.storage_capacity ?? null,
                    referred_by: referred_by_user_id,
                    requires_email_confirmation: !is_temp,
                    email_confirm_code,
                    email_confirm_token,
                    audit_metadata: {
                        ip: req.socket?.remoteAddress,
                        ip_fwd: req.headers?.['x-forwarded-for'],
                        user_agent: req.headers?.['user-agent'],
                        origin: req.headers?.origin,
                    },
                    signup_ip: req.socket?.remoteAddress ?? null,
                    signup_ip_forwarded: req.headers?.['x-forwarded-for'] ?? null,
                    signup_user_agent: req.headers?.['user-agent'] ?? null,
                    signup_origin: req.headers?.origin ?? null,
                });

                // Add to default group
                const defaultGroup = is_temp
                    ? this.config.default_temp_group
                    : this.config.default_user_group;
                if ( defaultGroup ) {
                    try {
                        await this.groupStore.addUsers(defaultGroup, [user.username]);
                    } catch (e) {
                        console.warn('[signup] group assignment failed:', e);
                    }
                }
            }

            // ── Send email confirmation ─────────────────────────────
            if ( !is_temp && user.requires_email_confirmation && this.clients.email ) {
                const sendCode = body.send_confirmation_code ?? true;
                try {
                    if ( sendCode ) {
                        await this.clients.email.send(user.email, 'email_verification_code', {
                            code: email_confirm_code,
                        });
                    } else {
                        const link = `${this.config.origin ?? ''}/confirm-email?token=${email_confirm_token}&user_uuid=${user.uuid}`;
                        await this.clients.email.send(user.email, 'email_verification_link', { link });
                    }
                } catch (e) {
                    console.warn('[signup] email send failed:', e);
                }
            }

            // ── Generate referral code (new users only) ─────────────
            let referral_code;
            if ( ! pseudo_user ) {
                referral_code = await generateReferralCode(this.userStore, user);
            }

            // Fire signup event (best-effort)
            try {
                this.clients.event?.emit('puter.signup.success', {
                    user_id: user.id,
                    user_uuid: user.uuid,
                    email: user.email,
                    username: user.username,
                    ip: req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress,
                }, {});
            } catch {
                // ignore — event emission shouldn't block signup
            }

            return this.#completeLogin(req, res, user, { referral_code });
        });

        // ── Logout ──────────────────────────────────────────────────

        router.post('/logout', { subdomain: ['api', ''], requireAuth: true, antiCsrf: true }, async (req, res) => {
            // Clear the session cookie
            res.clearCookie(this.config.cookie_name);

            // Remove the session (fire-and-forget)
            if ( req.token ) {
                this.authService.removeSessionByToken(req.token).catch(() => {
                });
            }

            // Delete temp users (no password + no email)
            if ( req.actor?.user && !req.actor.user.email ) {
                const user = await this.userStore.getByUuid(req.actor.user.uuid);
                if ( user && user.password === null && user.email === null ) {
                    this.clients.db.write(
                        'DELETE FROM `user` WHERE `id` = ?',
                        [user.id],
                    ).catch(() => {
                    });
                }
            }

            res.send('logged out');
        });

        // ── Email confirmation ──────────────────────────────────────

        router.post('/send-confirm-email', {
            subdomain: ['api', ''],
            requireUserActor: true,
            rateLimit: { scope: 'send-confirm-email', limit: 10, window: 60 * 60_000, key: 'user' },
        }, async (req, res) => {
            const user = await this.userStore.getById(req.actor.user.id, { force: true });
            if ( ! user ) throw new HttpError(404, 'User not found.');
            if ( user.suspended ) throw new HttpError(403, 'Account suspended.');
            if ( ! user.email ) throw new HttpError(400, 'No email on file.');

            const code = String(Math.floor(100000 + Math.random() * 900000));
            await this.userStore.update(user.id, { email_confirm_code: code });

            if ( this.clients.email ) {
                try {
                    await this.clients.email.send(user.email, 'email_verification_code', { code });
                } catch (e) {
                    console.warn('[send-confirm-email] send failed:', e);
                }
            }
            res.json({});
        });

        router.post('/confirm-email', {
            subdomain: ['api', ''],
            requireUserActor: true,
            rateLimit: { scope: 'confirm-email', limit: 10, window: 10 * 60_000, key: 'user' },
        }, async (req, res) => {
            const { code, original_client_socket_id } = req.body ?? {};
            if ( ! code ) throw new HttpError(400, 'Missing `code`.');

            const user = await this.userStore.getById(req.actor.user.id, { force: true });
            if ( ! user ) throw new HttpError(404, 'User not found.');
            if ( user.email_confirmed ) {
                return res.json({ email_confirmed: true, original_client_socket_id });
            }
            if ( String(user.email_confirm_code) !== String(code) ) {
                return res.json({ email_confirmed: false, original_client_socket_id });
            }

            await this.userStore.update(user.id, {
                email_confirmed: 1,
                requires_email_confirmation: 0,
            });

            try {
                this.clients.event?.emit('user.email-confirmed', { user_id: user.id, email: user.email }, {});
            } catch {
                // ignore — event is a side-channel signal, not load-bearing
            }

            res.json({ email_confirmed: true, original_client_socket_id });
        });

        // ── Password recovery ───────────────────────────────────────

        router.post('/send-pass-recovery-email', {
            subdomain: ['api', ''],
            rateLimit: { scope: 'send-pass-recovery-email', limit: 10, window: 60 * 60_000 },
        }, async (req, res) => {
            const { username, email } = req.body ?? {};
            if ( !username && !email ) {
                throw new HttpError(400, 'username or email is required.');
            }

            let user;
            if ( username ) {
                user = await this.userStore.getByUsername(username);
            } else {
                if ( ! validator.isEmail(email) ) throw new HttpError(400, 'Invalid email.');
                user = await this.userStore.getByEmail(email);
            }

            // Don't leak whether the user exists — always return a generic success
            if ( !user || user.suspended || !user.email ) {
                return res.json({ message: 'If that account exists, a password recovery email was sent.' });
            }

            const pass_recovery_token = uuidv4();
            await this.userStore.update(user.id, { pass_recovery_token });

            const jwt = this.tokenService.sign('otp', {
                token: pass_recovery_token,
                user_uid: user.uuid,
                email: user.email,
            }, { expiresIn: '1h' });

            const origin = this.config.origin ?? '';
            const link = `${origin}/action/set-new-password?token=${encodeURIComponent(jwt)}`;

            if ( this.clients.email ) {
                try {
                    await this.clients.email.send(user.email, 'email_password_recovery', { link });
                } catch (e) {
                    console.warn('[send-pass-recovery-email] send failed:', e);
                }
            }

            res.json({ message: `Password recovery sent to ${email ?? user.email}.` });
        });

        router.post('/verify-pass-recovery-token', {
            subdomain: ['api', ''],
            rateLimit: { scope: 'verify-pass-recovery-token', limit: 10, window: 15 * 60_000 },
        }, async (req, res) => {
            const { token } = req.body ?? {};
            if ( ! token ) throw new HttpError(400, 'Missing `token`.');

            let decoded;
            try {
                decoded = this.tokenService.verify('otp', token);
            } catch {
                throw new HttpError(400, 'Invalid or expired token.');
            }

            const user = await this.userStore.getByUuid(decoded.user_uid);
            if ( !user || user.email !== decoded.email ) {
                throw new HttpError(400, 'Token is no longer valid.');
            }

            const exp = decoded.exp;
            const time_remaining = exp ? Math.max(0, exp - Math.floor(Date.now() / 1000)) : 0;
            res.json({ time_remaining });
        });

        router.post('/set-pass-using-token', {
            subdomain: ['api', ''],
            rateLimit: { scope: 'set-pass-using-token', limit: 10, window: 60 * 60_000 },
        }, async (req, res) => {
            const { token, password } = req.body ?? {};
            if ( !token || !password ) {
                throw new HttpError(400, 'Missing `token` or `password`.');
            }
            const minLen = this.config.min_pass_length || 6;
            if ( password.length < minLen ) {
                throw new HttpError(400, `Password must be at least ${minLen} characters long.`);
            }

            let decoded;
            try {
                decoded = this.tokenService.verify('otp', token);
            } catch {
                throw new HttpError(400, 'Invalid or expired token.');
            }

            const user = await this.userStore.getByUuid(decoded.user_uid);
            if ( !user || user.email !== decoded.email ) {
                throw new HttpError(400, 'Token is no longer valid.');
            }

            // Atomic check: only update if the recovery token still matches
            const password_hash = await bcrypt.hash(password, 8);
            const result = await this.clients.db.write(
                'UPDATE `user` SET `password` = ?, `pass_recovery_token` = NULL, `change_email_confirm_token` = NULL WHERE `id` = ? AND `pass_recovery_token` = ?',
                [password_hash, user.id, decoded.token],
            );
            const affected = (result)?.affectedRows ?? (result)?.changes ?? 0;
            if ( affected === 0 ) {
                throw new HttpError(400, 'Token has already been used.');
            }
            await this.userStore.invalidateById(user.id);

            res.send('Password successfully updated.');
        });

        router.post('/passwd', {
            subdomain: ['api', ''],
            requireUserActor: true,
            rateLimit: { scope: 'passwd', limit: 10, window: 60 * 60_000, key: 'user' },
        }, async (req, res) => {
            const { old_pass, new_pass } = req.body ?? {};
            if ( !old_pass || !new_pass ) throw new HttpError(400, 'Missing `old_pass` or `new_pass`.');
            const minLen = this.config.min_pass_length || 6;
            if ( new_pass.length < minLen ) {
                throw new HttpError(400, `Password must be at least ${minLen} characters long.`);
            }

            const user = await this.userStore.getById(req.actor.user.id, { force: true });
            if ( ! user ) throw new HttpError(404, 'User not found.');
            if ( ! user.password ) throw new HttpError(400, 'Cannot change password for this account.');

            const match = await bcrypt.compare(old_pass, user.password);
            if ( ! match ) throw new HttpError(400, 'Old password is incorrect.');

            const password_hash = await bcrypt.hash(new_pass, 8);
            await this.userStore.update(user.id, {
                password: password_hash,
                pass_recovery_token: null,
                change_email_confirm_token: null,
            });

            if ( this.clients.email && user.email ) {
                try {
                    await this.clients.email.send(user.email, 'password_change_notification', {
                        username: user.username,
                    });
                } catch (e) {
                    console.warn('[passwd] notification send failed:', e);
                }
            }

            res.send('Password successfully updated.');
        });

        // ── Captcha generation ───────────────────────────────────────

        router.get('/api/captcha/generate', { subdomain: '*' }, (_req, res) => {
            const difficulty = this.config.captcha?.difficulty || 'medium';
            const { token, image } = generateCaptcha(difficulty);
            res.json({ token, image });
        });

        // ── Anti-CSRF token generation ──────────────────────────────

        router.get('/get-anticsrf-token', { subdomain: '', requireAuth: true }, async (req, res) => {
            const sessionId = req.actor?.user?.uuid;
            if ( ! sessionId ) throw new HttpError(401, 'Authentication required.');
            const token = antiCsrf.createToken(sessionId);
            res.json({ token });
        });

        // ── Permission grants ───────────────────────────────────────

        router.post('/auth/grant-user-user', { subdomain: 'api', requireUserActor: true }, async (req, res) => {
            const { target_username, permission, extra, meta } = req.body;
            if ( !target_username || !permission ) {
                throw new HttpError(400, 'Missing `target_username` or `permission`');
            }
            await this.permissionService.grantUserUserPermission(req.actor, target_username, permission, extra, meta);
            res.json({});
        });

        router.post('/auth/grant-user-app', { subdomain: 'api', requireUserActor: true }, async (req, res) => {
            const { app_uid, permission, extra, meta } = req.body;
            if ( !app_uid || !permission ) {
                throw new HttpError(400, 'Missing `app_uid` or `permission`');
            }
            await this.permissionService.grantUserAppPermission(req.actor, app_uid, permission, extra, meta);
            res.json({});
        });

        router.post('/auth/grant-user-group', { subdomain: 'api', requireUserActor: true }, async (req, res) => {
            const { group_uid, permission, extra, meta } = req.body;
            if ( !group_uid || !permission ) {
                throw new HttpError(400, 'Missing `group_uid` or `permission`');
            }
            const group = await this.groupStore.getByUid(group_uid);
            if ( ! group ) throw new HttpError(404, 'Group not found');
            await this.permissionService.grantUserGroupPermission(req.actor, group, permission, extra, meta);
            res.json({});
        });

        // ── Permission revokes ──────────────────────────────────────

        router.post('/auth/revoke-user-user', { subdomain: 'api', requireUserActor: true }, async (req, res) => {
            const { target_username, permission, meta } = req.body;
            if ( !target_username || !permission ) {
                throw new HttpError(400, 'Missing `target_username` or `permission`');
            }
            await this.permissionService.revokeUserUserPermission(req.actor, target_username, permission, meta);
            res.json({});
        });

        router.post('/auth/revoke-user-app', { subdomain: 'api', requireUserActor: true }, async (req, res) => {
            const { app_uid, permission, meta } = req.body;
            if ( !app_uid || !permission ) {
                throw new HttpError(400, 'Missing `app_uid` or `permission`');
            }
            if ( permission === '*' ) {
                await this.permissionService.revokeUserAppAll(req.actor, app_uid, meta);
            } else {
                await this.permissionService.revokeUserAppPermission(req.actor, app_uid, permission, meta);
            }
            res.json({});
        });

        router.post('/auth/revoke-user-group', { subdomain: 'api', requireUserActor: true }, async (req, res) => {
            const { group_uid, permission, meta } = req.body;
            if ( !group_uid || !permission ) {
                throw new HttpError(400, 'Missing `group_uid` or `permission`');
            }
            await this.permissionService.revokeUserGroupPermission(
                req.actor,
                { uid: group_uid },
                permission,
                meta,
            );
            res.json({});
        });

        // ── Permission checks ───────────────────────────────────────

        router.post('/auth/check-permissions', { subdomain: 'api', requireAuth: true }, async (req, res) => {
            const { permissions } = req.body;
            if ( ! Array.isArray(permissions) ) {
                throw new HttpError(400, 'Missing or invalid `permissions` array');
            }

            const unique = [...new Set(permissions)];
            const result = {};
            for ( const perm of unique ) {
                try {
                    result[perm] = await this.permissionService.check(req.actor, perm);
                } catch {
                    result[perm] = false;
                }
            }
            res.json({ permissions: result });
        });

        // ── Session management ──────────────────────────────────────

        router.get('/auth/list-sessions', { subdomain: 'api', requireUserActor: true }, async (req, res) => {
            const sessions = await this.authService.listSessions(req.actor);
            res.json(sessions);
        });

        router.post('/auth/revoke-session', { subdomain: 'api', requireUserActor: true }, async (req, res) => {
            const { uuid } = req.body;
            if ( !uuid || typeof uuid !== 'string' ) {
                throw new HttpError(400, 'Missing or invalid `uuid`');
            }
            await this.authService.revokeSession(uuid);
            const sessions = await this.authService.listSessions(req.actor);
            res.json({ sessions });
        });

        // ── Dev app permissions ──────────────────────────────────────

        router.post('/auth/grant-dev-app', { subdomain: 'api', requireUserActor: true }, async (req, res) => {
            let { app_uid, origin, permission, extra, meta } = req.body;
            if ( origin && !app_uid ) {
                app_uid = await this.authService.appUidFromOrigin(origin);
            }
            if ( !app_uid || !permission ) {
                throw new HttpError(400, 'Missing `app_uid` or `permission`');
            }
            await this.permissionService.grantDevAppPermission(req.actor, app_uid, permission, extra, meta);
            res.json({});
        });

        router.post('/auth/revoke-dev-app', { subdomain: 'api', requireUserActor: true }, async (req, res) => {
            let { app_uid, origin, permission, meta } = req.body;
            if ( origin && !app_uid ) {
                app_uid = await this.authService.appUidFromOrigin(origin);
            }
            if ( !app_uid || !permission ) {
                throw new HttpError(400, 'Missing `app_uid` or `permission`');
            }
            if ( permission === '*' ) {
                await this.permissionService.revokeDevAppAll(req.actor, app_uid, meta);
            }
            await this.permissionService.revokeDevAppPermission(req.actor, app_uid, permission, meta);
            res.json({});
        });

        // ── Permission listing ──────────────────────────────────────

        router.get('/auth/list-permissions', { subdomain: 'api', requireUserActor: true }, async (req, res) => {
            const userId = req.actor.user.id;
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

            res.json({
                myself_to_app: appPerms.map(r => ({
                    app_uid: r.app_uid,
                    permission: r.permission,
                    extra: typeof r.extra === 'string' ? JSON.parse(r.extra) : (r.extra ?? {}),
                })),
                myself_to_user: userPermsOut.map(r => ({
                    user: r.username,
                    permission: r.permission,
                    extra: typeof r.extra === 'string' ? JSON.parse(r.extra) : (r.extra ?? {}),
                })),
                user_to_myself: userPermsIn.map(r => ({
                    user: r.username,
                    permission: r.permission,
                    extra: typeof r.extra === 'string' ? JSON.parse(r.extra) : (r.extra ?? {}),
                })),
            });
        });

        // ── App origin resolution ───────────────────────────────────

        router.post('/auth/app-uid-from-origin', { subdomain: 'api', requireAuth: true }, async (req, res) => {
            const origin = req.body?.origin || req.query?.origin;
            if ( ! origin ) throw new HttpError(400, 'Missing `origin`');
            const uid = await this.authService.appUidFromOrigin(origin);
            res.json({ uid });
        });

        // ── App token + check ───────────────────────────────────────

        router.post('/auth/get-user-app-token', { subdomain: 'api', requireUserActor: true }, async (req, res) => {
            let { app_uid, origin } = req.body;
            if ( !app_uid && origin ) {
                app_uid = await this.authService.appUidFromOrigin(origin);
            }
            if ( ! app_uid ) throw new HttpError(400, 'Missing `app_uid` or `origin`');

            const token = this.authService.getUserAppToken(req.actor, app_uid);

            // Grant the app-is-authenticated flag
            await this.permissionService.grantUserAppPermission(req.actor, app_uid, 'flag:app-is-authenticated', {}, {});

            res.json({ token, app_uid });
        });

        router.post('/auth/check-app', { subdomain: 'api', requireUserActor: true }, async (req, res) => {
            let { app_uid, origin } = req.body;
            if ( !app_uid && origin ) {
                app_uid = await this.authService.appUidFromOrigin(origin);
            }
            if ( ! app_uid ) throw new HttpError(400, 'Missing `app_uid` or `origin`');

            // Check if the app is authenticated for this user
            const authenticated = await this.permissionService.check(req.actor, `service:${app_uid}:ii:flag:app-is-authenticated`).catch(() => false);

            const result = { app_uid, authenticated };
            if ( authenticated ) {
                result.token = this.authService.getUserAppToken(req.actor, app_uid);
            }
            res.json(result);
        });

        // ── Access tokens ───────────────────────────────────────────

        router.post('/auth/create-access-token', { subdomain: 'api', requireAuth: true }, async (req, res) => {
            const { permissions, expiresIn } = req.body;
            if ( !Array.isArray(permissions) || permissions.length === 0 ) {
                throw new HttpError(400, 'Missing or empty `permissions` array');
            }

            // Normalize specs: string → [string], [string] → [string, {}], [string, extra] → as-is
            const normalized = permissions.map(spec => {
                if ( typeof spec === 'string' ) return [spec];
                if ( Array.isArray(spec) ) return spec;
                throw new HttpError(400, 'Each permission must be a string or [string, extra?]');
            });

            const token = await this.authService.createAccessToken(req.actor, normalized, expiresIn ? { expiresIn } : {});
            res.json({ token });
        });

        router.post('/auth/revoke-access-token', { subdomain: 'api', requireAuth: true }, async (req, res) => {
            let { tokenOrUuid } = req.body;
            if ( !tokenOrUuid || typeof tokenOrUuid !== 'string' ) {
                throw new HttpError(400, 'Missing `tokenOrUuid`');
            }
            // Extract JWT from /token-read URLs if needed
            if ( tokenOrUuid.includes('/token-read') ) {
                const match = tokenOrUuid.match(/\/token-read\/([^\s/?]+)/);
                if ( match ) tokenOrUuid = match[1];
            }
            await this.authService.revokeAccessToken(tokenOrUuid);
            res.json({ ok: true });
        });
    }

    // ── Helpers ──────────────────────────────────────────────────────

    async #generateRandomUsername () {
        let username;
        let attempts = 0;
        do {
            username = generate_identifier();
            attempts++;
            if ( attempts > 20 ) throw new Error('Failed to generate unique username');
        } while ( await this.userStore.getByUsername(username) );
        return username;
    }

    async #completeLogin (req, res, user, extras = {}) {
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
                is_temp: (user.password === null && user.email === null),
                ...(extras.referral_code ? { referral_code: extras.referral_code } : {}),
            },
        });
    }

    onServerStart () {
    }
    onServerPrepareShutdown () {
    }
    onServerShutdown () {
    }
}
