import { HttpError } from '../../core/http/HttpError.js';

/**
 * Auth controller — permission grants/revokes, session management,
 * and permission checks.
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
    get groupStore () { return this.stores.group; }

    registerRoutes (router) {
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
                { uid: group_uid }, // minimal group shape for revoke
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
            // Return updated session list like v1
            const sessions = await this.authService.listSessions(req.actor);
            res.json({ sessions });
        });
    }

    onServerStart () {}
    onServerPrepareShutdown () {}
    onServerShutdown () {}
}
