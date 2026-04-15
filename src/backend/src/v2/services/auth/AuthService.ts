import { v4 as uuidv4, v5 as uuidv5 } from 'uuid';
import type { LayerInstances } from '../../types';
import type { puterServices } from '../index';
import type { Actor } from '../../core/actor';
import type { AppRow } from '../../stores/permission/PermissionStore';
import type { UserRow } from '../../stores/user/UserStore';
import { PuterService } from '../types';
import type {
    AccessTokenPayload,
    AnyTokenPayload,
    AppUnderUserTokenPayload,
    SessionRow,
    SessionTokenPayload,
} from './types';

const APP_ORIGIN_UUID_NAMESPACE = '33de3768-8ee0-43e9-9e73-db192b97a5d8';

/**
 * Authentication service for v2.
 *
 * Scope is deliberately narrow at this stage — just `authenticateFromToken`,
 * the one method the auth-probe middleware needs. Session creation, logout,
 * token rotation, 2FA, and the rest of v1's sprawling AuthService will land
 * when we port the auth controller (which will own mint / rotate / revoke).
 *
 * Token verification is wire-compatible with v1: same JWT secret, same
 * compression tables, same FPE key for session-uuid obfuscation in
 * app-under-user tokens. That means a v1-minted token authenticates on v2
 * during the transition.
 */
export class AuthService extends PuterService {
    declare protected services: LayerInstances<typeof puterServices>;

    // ── Public API ──────────────────────────────────────────────────

    /**
     * Resolve an auth token to a v2 Actor.
     *
     * Returns `null` for *any* failure — invalid signature, malformed payload,
     * legacy token shape, missing session, missing user, missing app. The
     * caller (auth probe) never differentiates: it either attaches an actor
     * or leaves `req.actor` undefined for per-route gates to reject.
     *
     * Ports v1 `AuthService.authenticate_from_token` logic branch-for-branch,
     * minus the legacy-token migration path (which runs in v1 until the v2
     * auth controller ships).
     */
    async authenticateFromToken (token: string): Promise<Actor | null> {
        let decoded: AnyTokenPayload;
        try {
            decoded = this.services.token.verify<AnyTokenPayload>('auth', token);
        } catch {
            return null;
        }

        // Legacy v1 tokens (pre-`type` field) aren't supported on v2 — v1
        // still handles those via its `/whoami` migration path.
        if ( ! decoded.type ) return null;

        switch ( decoded.type ) {
            case 'session':
            case 'gui':
                return this.#actorFromSessionToken(decoded);
            case 'app-under-user':
                return this.#actorFromAppUnderUserToken(decoded);
            case 'access-token':
                return this.#actorFromAccessTokenToken(decoded);
            default:
                return null;
        }
    }

    // ── Session lifecycle ────────────────────────────────────────────

    /**
     * Create a session and sign a session JWT + GUI JWT for the user.
     *
     * `meta` is enriched with request metadata (IP, user-agent, etc.)
     * when a request context is available.
     */
    async createSessionToken (
        user: UserRow,
        meta: Record<string, unknown> = {},
    ): Promise<{ session: Record<string, unknown>; token: string; gui_token: string }> {
        const session = await this.stores.session.create(user.id, meta);

        const token = this.services.token.sign('auth', {
            type: 'session',
            version: '0.0.0',
            uuid: session.uuid,
            user_uid: user.uuid,
        });

        const gui_token = this.services.token.sign('auth', {
            type: 'gui',
            version: '0.0.0',
            uuid: session.uuid,
            user_uid: user.uuid,
        });

        return { session, token, gui_token };
    }

    /** Sign a GUI token for an existing session. */
    createGuiToken (user: UserRow, sessionUuid: string): string {
        return this.services.token.sign('auth', {
            type: 'gui',
            version: '0.0.0',
            uuid: sessionUuid,
            user_uid: user.uuid,
        });
    }

    /** Sign a session token for an existing session (upgrade from GUI token). */
    createSessionTokenForSession (user: UserRow, sessionUuid: string): string {
        return this.services.token.sign('auth', {
            type: 'session',
            version: '0.0.0',
            uuid: sessionUuid,
            user_uid: user.uuid,
        });
    }

    /** Remove the session referenced by a session/GUI JWT. */
    async removeSessionByToken (token: string): Promise<void> {
        let decoded: AnyTokenPayload;
        try {
            decoded = this.services.token.verify<AnyTokenPayload>('auth', token);
        } catch {
            return;
        }
        if ( decoded.type !== 'session' && decoded.type !== 'gui' ) return;
        await this.stores.session.removeByUuid((decoded as SessionTokenPayload).uuid);
    }

    /** List all sessions for an actor's user. */
    async listSessions (actor: Actor): Promise<Array<Record<string, unknown>>> {
        if ( ! actor.user?.id ) return [];

        const rows = await this.stores.session.getByUserId(actor.user.id);

        return rows.map((row: Record<string, unknown>) => {
            const meta = (typeof row.meta === 'string' ? JSON.parse(row.meta as string) : row.meta) ?? {};
            const isCurrent = actor.session?.uid === row.uuid;
            return {
                uuid: row.uuid,
                created_at: row.created_at,
                last_activity: row.last_activity,
                current: isCurrent,
                ...meta,
            };
        });
    }

    /** Revoke a specific session by uuid. */
    async revokeSession (uuid: string): Promise<void> {
        await this.stores.session.removeByUuid(uuid);
    }

    // ── App / origin resolution ─────────────────────────────────────

    /**
     * Deterministic app UID from an origin URL.
     * UUIDv5 with a fixed namespace, prefixed with `app-`.
     */
    async appUidFromOrigin (origin: string): Promise<string> {
        const parsed = this.#originFromUrl(origin);
        if ( ! parsed ) throw new Error('Invalid origin URL');
        const uid = uuidv5(parsed, APP_ORIGIN_UUID_NAMESPACE);
        return `app-${uid}`;
    }

    /**
     * Sign an app-under-user token for the given app UID.
     * Requires a user actor in the provided actor.
     */
    getUserAppToken (actor: Actor, appUid: string): string {
        if ( ! actor.user ) throw new Error('Actor must be a user');
        return this.services.token.sign('auth', {
            type: 'app-under-user',
            version: '0.0.0',
            user_uid: actor.user.uuid,
            app_uid: appUid,
            ...(actor.session ? { session: actor.session.uid } : {}),
        });
    }

    // ── Access tokens ───────────────────────────────────────────────

    /**
     * Create an access token with the given permissions.
     *
     * Each permission spec is `[permissionString, extraObject?]`.
     * The token is stored in `access_token_permissions` and a JWT is
     * returned.
     */
    async createAccessToken (
        actor: Actor,
        permissions: Array<[string, Record<string, unknown>?]>,
        options: { expiresIn?: string } = {},
    ): Promise<string> {
        if ( ! actor.user ) throw new Error('Actor must have a user');

        const tokenUid = uuidv4();
        const jwtPayload: Record<string, unknown> = {
            type: 'access-token',
            version: '0.0.0',
            token_uid: tokenUid,
            user_uid: actor.user.uuid,
        };
        if ( actor.app ) {
            jwtPayload.app_uid = actor.app.uid;
        }

        const jwt = this.services.token.sign('auth', jwtPayload, options);

        // Store each permission grant
        const db = this.stores.permission as unknown as { clients: { db: { write: (q: string, p: unknown[]) => Promise<void> } } };
        for ( const spec of permissions ) {
            const [permission, extra] = spec;
            await (db.clients?.db ?? this.clients.db).write(
                'INSERT INTO `access_token_permissions` (`token_uid`, `permission`, `extra`) VALUES (?, ?, ?)',
                [tokenUid, permission, extra ? JSON.stringify(extra) : '{}'],
            );
        }

        return jwt;
    }

    /** Revoke an access token by JWT or token UUID. */
    async revokeAccessToken (tokenOrUuid: string): Promise<void> {
        let tokenUid: string;
        const isJwt = /^[\w-]+\.[\w-]+\.[\w-]+$/.test(tokenOrUuid.trim());
        if ( isJwt ) {
            const decoded = this.services.token.verify<AccessTokenPayload>('auth', tokenOrUuid);
            if ( decoded.type !== 'access-token' || !decoded.token_uid ) {
                throw new Error('Invalid access token');
            }
            tokenUid = decoded.token_uid;
        } else {
            tokenUid = tokenOrUuid;
        }
        await this.clients.db.write(
            'DELETE FROM `access_token_permissions` WHERE `token_uid` = ?',
            [tokenUid],
        );
    }

    // ── Internals ───────────────────────────────────────────────────

    #originFromUrl (url: string): string | null {
        try {
            const parsed = new URL(url);
            return `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ''}`;
        } catch {
            return null;
        }
    }

    async #actorFromSessionToken (decoded: SessionTokenPayload): Promise<Actor | null> {
        const session = await this.stores.session.getByUuid(decoded.uuid);
        if ( ! session ) return null;

        const user = await this.stores.user.getByUuid(decoded.user_uid);
        if ( ! user ) return null;

        return this.#buildUserActor(user, session);
    }

    async #actorFromAppUnderUserToken (decoded: AppUnderUserTokenPayload): Promise<Actor | null> {
        // App tokens may or may not carry a session reference. If present,
        // the token is bound to that session — log out invalidates it.
        let session: SessionRow | null = null;
        if ( decoded.session ) {
            session = await this.stores.session.getByUuid(decoded.session);
            if ( ! session ) return null;
        }

        const user = await this.stores.user.getByUuid(decoded.user_uid);
        if ( ! user ) return null;

        const app = await this.stores.permission.getAppByUid(decoded.app_uid);
        if ( ! app ) return null;

        return this.#buildAppUnderUserActor(user, app, session);
    }

    async #actorFromAccessTokenToken (decoded: AccessTokenPayload): Promise<Actor | null> {
        if ( !decoded.token_uid || !decoded.user_uid ) return null;

        const user = await this.stores.user.getByUuid(decoded.user_uid);
        if ( ! user ) return null;

        // The authorizer is the identity whose permissions the access token
        // can exercise — either a plain user or an app-under-user.
        let authorizer: Actor;
        if ( decoded.app_uid ) {
            const app = await this.stores.permission.getAppByUid(decoded.app_uid);
            if ( ! app ) return null;
            authorizer = this.#buildAppUnderUserActor(user, app, null);
        } else {
            authorizer = this.#buildUserActor(user, null);
        }

        return {
            user: this.#actorUserFromRow(user),
            accessToken: {
                uid: decoded.token_uid,
                issuer: authorizer,
                authorized: null,
            },
        };
    }

    // ── Actor builders ──────────────────────────────────────────────

    #actorUserFromRow (user: UserRow) {
        return {
            uuid: user.uuid,
            id: user.id,
            username: user.username,
            email: user.email ?? null,
            suspended: user.suspended ?? false,
            email_confirmed: user.email_confirmed ?? false,
            requires_email_confirmation: user.requires_email_confirmation ?? false,
        };
    }

    #buildUserActor (user: UserRow, session: SessionRow | null): Actor {
        return {
            user: this.#actorUserFromRow(user),
            session: session ? { uid: session.uuid } : null,
        };
    }

    #buildAppUnderUserActor (user: UserRow, app: AppRow, session: SessionRow | null): Actor {
        return {
            user: this.#actorUserFromRow(user),
            app: {
                uid: app.uid,
                id: app.id,
            },
            session: session ? { uid: session.uuid } : null,
        };
    }
}
