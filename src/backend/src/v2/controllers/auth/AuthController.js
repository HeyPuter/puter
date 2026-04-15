import bcrypt from 'bcrypt';
import { HttpError } from '../../core/http/HttpError.js';
import { verify as verifyOtp, hashRecoveryCode } from '../../services/auth/OTPUtil.js';

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

    get permissionService () { return this.services.permission; }
    get authService () { return this.services.auth; }
    get tokenService () { return this.services.token; }
    get userStore () { return this.stores.user; }
    get groupStore () { return this.stores.group; }

    registerRoutes (router) {

        // ── Login ───────────────────────────────────────────────────

        router.post('/login', {
            subdomain: ['api', ''],
            rateLimit: { scope: 'login', limit: 10, window: 15 * 60_000 },
        }, async (req, res) => {
            const { username, email, password } = req.body;

            if ( ! username && ! email ) {
                throw new HttpError(400, 'Username or email is required.');
            }
            if ( ! password || typeof password !== 'string' ) {
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
            if ( user.username === 'system' && ! this.config.allow_system_login ) {
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
            rateLimit: { scope: 'login-otp', limit: 15, window: 30 * 60_000 },
        }, async (req, res) => {
            const { token, code } = req.body;
            if ( ! token ) throw new HttpError(400, 'token is required.');
            if ( ! code ) throw new HttpError(400, 'code is required.');

            let decoded;
            try { decoded = this.tokenService.verify('otp', token); }
            catch { throw new HttpError(400, 'Invalid token.'); }
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
            rateLimit: { scope: 'login-recovery', limit: 10, window: 60 * 60_000 },
        }, async (req, res) => {
            const { token, code } = req.body;
            if ( ! token ) throw new HttpError(400, 'token is required.');
            if ( ! code ) throw new HttpError(400, 'code is required.');

            let decoded;
            try { decoded = this.tokenService.verify('otp', token); }
            catch { throw new HttpError(400, 'Invalid token.'); }
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

        // ── Logout ──────────────────────────────────────────────────

        router.post('/logout', { subdomain: ['api', ''], requireAuth: true }, async (req, res) => {
            // Clear the session cookie
            res.clearCookie(this.config.cookie_name);

            // Remove the session (fire-and-forget)
            if ( req.token ) {
                this.authService.removeSessionByToken(req.token).catch(() => {});
            }

            // Delete temp users (no password + no email)
            if ( req.actor?.user && ! req.actor.user.email ) {
                const user = await this.userStore.getByUuid(req.actor.user.uuid);
                if ( user && user.password === null && user.email === null ) {
                    this.clients.db.write(
                        'DELETE FROM `user` WHERE `id` = ?',
                        [user.id],
                    ).catch(() => {});
                }
            }

            res.send('logged out');
        });

        // ── Permission grants ───────────────────────────────────────

        router.post('/auth/grant-user-user', { subdomain: 'api', requireUserActor: true }, async (req, res) => {
            const { target_username, permission, extra, meta } = req.body;
            if ( ! target_username || ! permission ) {
                throw new HttpError(400, 'Missing `target_username` or `permission`');
            }
            await this.permissionService.grantUserUserPermission(req.actor, target_username, permission, extra, meta);
            res.json({});
        });

        router.post('/auth/grant-user-app', { subdomain: 'api', requireUserActor: true }, async (req, res) => {
            const { app_uid, permission, extra, meta } = req.body;
            if ( ! app_uid || ! permission ) {
                throw new HttpError(400, 'Missing `app_uid` or `permission`');
            }
            await this.permissionService.grantUserAppPermission(req.actor, app_uid, permission, extra, meta);
            res.json({});
        });

        router.post('/auth/grant-user-group', { subdomain: 'api', requireUserActor: true }, async (req, res) => {
            const { group_uid, permission, extra, meta } = req.body;
            if ( ! group_uid || ! permission ) {
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
            if ( ! target_username || ! permission ) {
                throw new HttpError(400, 'Missing `target_username` or `permission`');
            }
            await this.permissionService.revokeUserUserPermission(req.actor, target_username, permission, meta);
            res.json({});
        });

        router.post('/auth/revoke-user-app', { subdomain: 'api', requireUserActor: true }, async (req, res) => {
            const { app_uid, permission, meta } = req.body;
            if ( ! app_uid || ! permission ) {
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
            if ( ! group_uid || ! permission ) {
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
            if ( ! uuid || typeof uuid !== 'string' ) {
                throw new HttpError(400, 'Missing or invalid `uuid`');
            }
            await this.authService.revokeSession(uuid);
            const sessions = await this.authService.listSessions(req.actor);
            res.json({ sessions });
        });
    }

    // ── Helpers ──────────────────────────────────────────────────────

    async #completeLogin (req, res, user) {
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
                is_temp: (user.password === null && user.email === null),
            },
        });
    }

    onServerStart () {}
    onServerPrepareShutdown () {}
    onServerShutdown () {}
}
