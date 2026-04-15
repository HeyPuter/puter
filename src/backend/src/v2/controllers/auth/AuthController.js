import bcrypt from 'bcrypt';
import { HttpError } from '../../core/http/HttpError.js';
import { antiCsrf } from '../../core/http/middleware/antiCsrf.js';
import { generateCaptcha } from '../../core/http/middleware/captcha.js';
import { hashRecoveryCode, verify as verifyOtp } from '../../services/auth/OTPUtil.js';

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

    onServerStart () {
    }
    onServerPrepareShutdown () {
    }
    onServerShutdown () {
    }
}
